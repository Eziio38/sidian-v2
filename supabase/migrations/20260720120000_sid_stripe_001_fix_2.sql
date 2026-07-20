-- SID-STRIPE-001-FIX-2 — fencing webhook, effets idempotents,
-- reconciliation Connect et audit durable.

-- ---------------------------------------------------------------------------
-- 1. Fencing webhook strict et retries bornes
-- ---------------------------------------------------------------------------

alter table public.processed_webhook_event
  add column if not exists lease_token uuid;

comment on column public.processed_webhook_event.lease_token is
  'Token non reutilisable du claim courant. Toute transition exige token + tentative.';

drop function if exists public.claim_stripe_webhook_event(text, text, text, integer);
drop function if exists public.mark_stripe_webhook_event_status(
  text, public.webhook_processing_status, text, integer
);

create or replace function public.claim_stripe_webhook_event(
  p_event_id text,
  p_type text,
  p_stripe_connected_account_id text default null,
  p_lease_seconds integer default 60,
  p_max_attempts integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.processed_webhook_event;
  v_now timestamptz := timezone('utc', now());
  v_token uuid;
begin
  if p_event_id is null or btrim(p_event_id) = '' then
    raise exception 'webhook_event_id_required';
  end if;
  if p_lease_seconds < 15 or p_lease_seconds > 600 then
    raise exception 'webhook_lease_invalid';
  end if;
  if p_max_attempts < 1 or p_max_attempts > 100 then
    raise exception 'webhook_max_attempts_invalid';
  end if;

  insert into public.processed_webhook_event (
    id,
    type,
    stripe_connected_account_id,
    received_at,
    processing_status,
    processing_attempts
  )
  values (
    p_event_id,
    p_type,
    nullif(btrim(p_stripe_connected_account_id), ''),
    v_now,
    'received',
    0
  )
  on conflict (id) do nothing;

  select e.* into v_row
  from public.processed_webhook_event e
  where e.id = p_event_id
  for update;

  if v_row.type is distinct from p_type
    or v_row.stripe_connected_account_id is distinct from
      nullif(btrim(p_stripe_connected_account_id), '')
  then
    raise exception 'webhook_event_identity_mismatch';
  end if;

  if v_row.processing_status in ('processed', 'ignored', 'failed_terminal') then
    return jsonb_build_object(
      'claimed', false,
      'status', v_row.processing_status::text,
      'terminal', true,
      'attempt', v_row.processing_attempts
    );
  end if;

  if v_row.processing_status = 'processing'
    and v_row.lease_expires_at > v_now
  then
    return jsonb_build_object(
      'claimed', false,
      'status', 'processing',
      'terminal', false,
      'attempt', v_row.processing_attempts
    );
  end if;

  if v_row.processing_status = 'failed_retryable'
    and v_row.next_attempt_at > v_now
  then
    return jsonb_build_object(
      'claimed', false,
      'status', 'failed_retryable',
      'terminal', false,
      'attempt', v_row.processing_attempts
    );
  end if;

  if v_row.processing_attempts >= p_max_attempts then
    update public.processed_webhook_event e
    set
      processing_status = 'failed_terminal',
      processed_at = v_now,
      lease_expires_at = null,
      lease_token = null,
      next_attempt_at = null,
      last_error_code = 'webhook_max_attempts_exceeded'
    where e.id = p_event_id;

    return jsonb_build_object(
      'claimed', false,
      'status', 'failed_terminal',
      'terminal', true,
      'attempt', v_row.processing_attempts,
      'reason', 'webhook_max_attempts_exceeded'
    );
  end if;

  v_token := gen_random_uuid();
  update public.processed_webhook_event e
  set
    processing_status = 'processing',
    processing_attempts = e.processing_attempts + 1,
    lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
    lease_token = v_token,
    next_attempt_at = null,
    processed_at = null,
    last_error_code = null
  where e.id = p_event_id;

  return jsonb_build_object(
    'claimed', true,
    'status', 'processing',
    'terminal', false,
    'attempt', v_row.processing_attempts + 1,
    'lease_token', v_token::text
  );
end;
$$;

revoke all on function public.claim_stripe_webhook_event(
  text, text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.claim_stripe_webhook_event(
  text, text, text, integer, integer
) to service_role;

create or replace function public.renew_stripe_webhook_event_lease(
  p_event_id text,
  p_lease_token uuid,
  p_attempt integer,
  p_lease_seconds integer default 60
)
returns public.processed_webhook_event
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.processed_webhook_event;
  v_now timestamptz := timezone('utc', now());
begin
  if p_lease_seconds < 15 or p_lease_seconds > 600 then
    raise exception 'webhook_lease_invalid';
  end if;

  update public.processed_webhook_event e
  set lease_expires_at = v_now + make_interval(secs => p_lease_seconds)
  where e.id = p_event_id
    and e.processing_status = 'processing'
    and e.lease_token = p_lease_token
    and e.processing_attempts = p_attempt
    and e.lease_expires_at > v_now
  returning e.* into v_row;

  if not found then
    raise exception 'webhook_lease_lost' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

revoke all on function public.renew_stripe_webhook_event_lease(
  text, uuid, integer, integer
) from public, anon, authenticated;
grant execute on function public.renew_stripe_webhook_event_lease(
  text, uuid, integer, integer
) to service_role;

create or replace function public.mark_stripe_webhook_event_status(
  p_event_id text,
  p_lease_token uuid,
  p_attempt integer,
  p_status public.webhook_processing_status,
  p_error_code text default null,
  p_retry_delay_seconds integer default null
)
returns public.processed_webhook_event
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.processed_webhook_event;
  v_now timestamptz := timezone('utc', now());
begin
  if p_status not in ('processed', 'ignored', 'failed_retryable', 'failed_terminal') then
    raise exception 'webhook_status_transition_invalid';
  end if;
  if p_status = 'failed_retryable'
    and (p_retry_delay_seconds is null or p_retry_delay_seconds < 1
      or p_retry_delay_seconds > 86400)
  then
    raise exception 'webhook_retry_delay_invalid';
  end if;

  update public.processed_webhook_event e
  set
    processing_status = p_status,
    processed_at = case
      when p_status in ('processed', 'ignored', 'failed_terminal') then v_now
      else null
    end,
    lease_expires_at = null,
    lease_token = null,
    next_attempt_at = case
      when p_status = 'failed_retryable'
        then v_now + make_interval(secs => p_retry_delay_seconds)
      else null
    end,
    last_error_code = left(nullif(btrim(p_error_code), ''), 100)
  where e.id = p_event_id
    and e.processing_status = 'processing'
    and e.lease_token = p_lease_token
    and e.processing_attempts = p_attempt
    and e.lease_expires_at > v_now
  returning e.* into v_row;

  if not found then
    raise exception 'webhook_lease_lost' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

revoke all on function public.mark_stripe_webhook_event_status(
  text, uuid, integer, public.webhook_processing_status, text, integer
) from public, anon, authenticated;
grant execute on function public.mark_stripe_webhook_event_status(
  text, uuid, integer, public.webhook_processing_status, text, integer
) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Effets webhook metier idempotents
-- ---------------------------------------------------------------------------

create table public.stripe_webhook_effect (
  stripe_event_id text not null,
  stripe_object_id text not null,
  effect_type text not null,
  applied_at timestamptz not null default timezone('utc', now()),
  primary key (stripe_event_id, stripe_object_id, effect_type),
  constraint stripe_webhook_effect_values_not_blank check (
    nullif(btrim(stripe_event_id), '') is not null
    and nullif(btrim(stripe_object_id), '') is not null
    and nullif(btrim(effect_type), '') is not null
  )
);

alter table public.stripe_webhook_effect enable row level security;
revoke all on table public.stripe_webhook_effect from anon, authenticated;
grant all on table public.stripe_webhook_effect to service_role;

comment on table public.stripe_webhook_effect is
  'Registre transactionnel des effets metier Stripe, distinct du claim technique.';

create or replace function public.apply_account_updated_projection(
  p_stripe_event_id text,
  p_stripe_object_id text,
  p_prestataire_id uuid,
  p_stripe_account_id text,
  p_charges_enabled boolean,
  p_payouts_enabled boolean,
  p_details_submitted boolean,
  p_sepa_debit_payments_status public.stripe_capability_status,
  p_onboarding_status public.stripe_onboarding_status,
  p_currently_due jsonb,
  p_pending_verification jsonb,
  p_past_due jsonb,
  p_disabled_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_inserted boolean := false;
begin
  if p_stripe_object_id is distinct from p_stripe_account_id then
    raise exception 'webhook_account_object_mismatch';
  end if;
  if not exists (
    select 1
    from public.prestataire p
    where p.id = p_prestataire_id
      and p.stripe_account_id = p_stripe_account_id
  ) then
    raise exception 'webhook_prestataire_scope_mismatch';
  end if;

  insert into public.stripe_webhook_effect (
    stripe_event_id,
    stripe_object_id,
    effect_type
  )
  values (p_stripe_event_id, p_stripe_object_id, 'account.updated.projection')
  on conflict do nothing;
  v_inserted := found;

  if v_inserted then
    update public.prestataire p
    set
      stripe_charges_enabled = coalesce(p_charges_enabled, false),
      stripe_payouts_enabled = coalesce(p_payouts_enabled, false),
      stripe_details_submitted = coalesce(p_details_submitted, false),
      stripe_sepa_debit_payments_status = coalesce(
        p_sepa_debit_payments_status,
        'inactive'
      ),
      stripe_onboarding_status = p_onboarding_status,
      stripe_requirements_currently_due = coalesce(p_currently_due, '[]'::jsonb),
      stripe_requirements_pending_verification = coalesce(
        p_pending_verification,
        '[]'::jsonb
      ),
      stripe_requirements_past_due = coalesce(p_past_due, '[]'::jsonb),
      stripe_disabled_reason = nullif(btrim(p_disabled_reason), ''),
      stripe_status_synced_at = timezone('utc', now())
    where p.id = p_prestataire_id
      and p.stripe_account_id = p_stripe_account_id;

    if not found then
      raise exception 'webhook_prestataire_scope_mismatch';
    end if;
  end if;

  return jsonb_build_object(
    'applied', v_inserted,
    'effect_type', 'account.updated.projection'
  );
end;
$$;

revoke all on function public.apply_account_updated_projection(
  text, text, uuid, text, boolean, boolean, boolean,
  public.stripe_capability_status, public.stripe_onboarding_status,
  jsonb, jsonb, jsonb, text
) from public, anon, authenticated;
grant execute on function public.apply_account_updated_projection(
  text, text, uuid, text, boolean, boolean, boolean,
  public.stripe_capability_status, public.stripe_onboarding_status,
  jsonb, jsonb, jsonb, text
) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Audit Connect durable et idempotent
-- ---------------------------------------------------------------------------

create type public.stripe_connect_audit_outbox_status as enum (
  'pending',
  'delivered'
);

create table public.stripe_connect_audit_outbox (
  id uuid primary key default gen_random_uuid(),
  prestataire_id uuid not null references public.prestataire (id) on delete restrict,
  operation_key uuid not null unique,
  stripe_account_id text not null,
  action text not null,
  status public.stripe_connect_audit_outbox_status not null default 'pending',
  created_at timestamptz not null default timezone('utc', now()),
  delivered_at timestamptz,
  constraint stripe_connect_audit_outbox_action_ck check (
    action in (
      'stripe.connect.account_created',
      'stripe.connect.account_reconciled'
    )
  ),
  constraint stripe_connect_audit_outbox_delivery_ck check (
    (status = 'pending' and delivered_at is null)
    or (status = 'delivered' and delivered_at is not null)
  )
);

alter table public.stripe_connect_audit_outbox enable row level security;
revoke all on table public.stripe_connect_audit_outbox from anon, authenticated;
grant all on table public.stripe_connect_audit_outbox to service_role;

comment on table public.stripe_connect_audit_outbox is
  'Preuve durable creee dans la transaction de finalisation Connect, livree vers audit_log.';

drop function if exists public.complete_prestataire_connect_provisioning(uuid, uuid, text);

create or replace function public.complete_prestataire_connect_provisioning(
  p_prestataire_id uuid,
  p_operation_key uuid,
  p_stripe_account_id text,
  p_audit_action text
)
returns public.prestataire
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.prestataire;
begin
  if p_audit_action not in (
    'stripe.connect.account_created',
    'stripe.connect.account_reconciled'
  ) then
    raise exception 'connect_audit_action_invalid';
  end if;

  update public.prestataire p
  set
    stripe_account_id = p_stripe_account_id,
    stripe_connect_provisioning_status = 'created',
    stripe_connect_lease_expires_at = null,
    stripe_connect_last_error_code = null,
    stripe_connect_provisioning_updated_at = timezone('utc', now())
  where p.id = p_prestataire_id
    and p.stripe_connect_operation_key = p_operation_key
    and p.stripe_connect_provisioning_status = 'creating'
  returning p.* into v_row;

  if not found then
    raise exception 'connect_provisioning_claim_mismatch' using errcode = 'P0002';
  end if;

  insert into public.stripe_connect_audit_outbox (
    prestataire_id,
    operation_key,
    stripe_account_id,
    action
  )
  values (
    p_prestataire_id,
    p_operation_key,
    p_stripe_account_id,
    p_audit_action
  )
  on conflict (operation_key) do update
  set stripe_account_id = excluded.stripe_account_id
  where public.stripe_connect_audit_outbox.prestataire_id = excluded.prestataire_id
    and public.stripe_connect_audit_outbox.stripe_account_id = excluded.stripe_account_id
    and public.stripe_connect_audit_outbox.action = excluded.action;

  if not found then
    raise exception 'connect_audit_outbox_identity_mismatch';
  end if;
  return v_row;
end;
$$;

revoke all on function public.complete_prestataire_connect_provisioning(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.complete_prestataire_connect_provisioning(
  uuid, uuid, text, text
) to service_role;

create or replace function public.flush_stripe_connect_audit_outbox(
  p_prestataire_id uuid,
  p_operation_key uuid
)
returns public.stripe_connect_audit_outbox
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.stripe_connect_audit_outbox;
begin
  select o.* into v_row
  from public.stripe_connect_audit_outbox o
  where o.prestataire_id = p_prestataire_id
    and o.operation_key = p_operation_key
  for update;

  if not found then
    raise exception 'connect_audit_outbox_not_found' using errcode = 'P0002';
  end if;
  if v_row.status = 'delivered' then
    return v_row;
  end if;

  insert into public.audit_log (
    prestataire_id,
    actor_type,
    actor_provider,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_row.prestataire_id,
    'system',
    'stripe',
    v_row.action,
    'prestataire',
    v_row.prestataire_id,
    jsonb_build_object(
      'stripe_account_id', v_row.stripe_account_id,
      'operation_key', v_row.operation_key
    )
  );

  update public.stripe_connect_audit_outbox o
  set
    status = 'delivered',
    delivered_at = timezone('utc', now())
  where o.id = v_row.id
  returning o.* into v_row;

  return v_row;
end;
$$;

revoke all on function public.flush_stripe_connect_audit_outbox(
  uuid, uuid
) from public, anon, authenticated;
grant execute on function public.flush_stripe_connect_audit_outbox(
  uuid, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Autorisation : revoked_at reserve a REVOQUEE
-- ---------------------------------------------------------------------------

alter table public.payment_authorization
  add constraint payment_authorization_revoked_at_only_for_revoked
  check (revoked_at is null or etat = 'REVOQUEE') not valid;

-- ---------------------------------------------------------------------------
-- 5. Inventaire RLS de diagnostic
-- ---------------------------------------------------------------------------

create or replace function public.sidian_assert_rls_enabled()
returns table(table_name text, rls_enabled boolean)
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    c.relname::text as table_name,
    c.relrowsecurity as rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in (
      'prestataire',
      'client_payeur',
      'creance',
      'tentative_paiement',
      'paiement',
      'payment_authorization',
      'dossier_suivi',
      'regle',
      'conversation',
      'message',
      'approval_request',
      'audit_log',
      'processed_webhook_event',
      'stripe_customer_binding',
      'payment_link',
      'stripe_webhook_effect',
      'stripe_connect_audit_outbox'
    )
  order by c.relname;
$$;
