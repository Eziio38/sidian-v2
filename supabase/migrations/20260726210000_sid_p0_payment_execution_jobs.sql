-- SIDIAN P0 Runtime — file de jobs prélèvement auto + claim tentative off-session.
-- Scanners enqueue ; l'exécuteur draine. Aucun débit depuis un webhook entrant.

-- ---------------------------------------------------------------------------
-- 1. Enums + table payment_execution_job
-- ---------------------------------------------------------------------------

create type public.payment_execution_job_source as enum (
  'scanner',
  'agent_tool'
);

create type public.payment_execution_job_status as enum (
  'pending',
  'claimed',
  'succeeded_pending_webhook',
  'failed_terminal',
  'failed_retryable',
  'unknown'
);

create table public.payment_execution_job (
  id uuid primary key default gen_random_uuid(),
  prestataire_id uuid not null
    references public.prestataire (id) on delete restrict,
  creance_id uuid not null
    references public.creance (id) on delete restrict,
  amount_cents bigint not null,
  currency text not null default 'EUR',
  source public.payment_execution_job_source not null,
  idempotency_key text not null,
  status public.payment_execution_job_status not null default 'pending',
  lease_token uuid,
  lease_expires_at timestamptz,
  tentative_paiement_id uuid
    references public.tentative_paiement (id) on delete set null,
  stripe_payment_intent_id text,
  failure_code text,
  correlation_id text,
  attempt_count integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  constraint payment_execution_job_amount_ck check (amount_cents > 0),
  constraint payment_execution_job_currency_ck check (currency = 'EUR'),
  constraint payment_execution_job_idempotency_key_ck check (
    char_length(btrim(idempotency_key)) between 8 and 256
  ),
  constraint payment_execution_job_attempt_count_ck check (attempt_count >= 0)
);

create unique index payment_execution_job_idempotency_key_uidx
  on public.payment_execution_job (idempotency_key);

create index payment_execution_job_drain_idx
  on public.payment_execution_job (status, created_at)
  where status in ('pending', 'failed_retryable', 'unknown', 'claimed');

create index payment_execution_job_creance_idx
  on public.payment_execution_job (creance_id, created_at desc);

alter table public.payment_execution_job enable row level security;
revoke all on table public.payment_execution_job from anon, authenticated;
grant all on table public.payment_execution_job to service_role;

comment on table public.payment_execution_job is
  'File P0 prélèvement auto : scanners/agent enqueue ; exécuteur draine. '
  'succeeded_pending_webhook ≠ payé — webhook payment_intent.* reste SoT.';

-- ---------------------------------------------------------------------------
-- 2. Job RPCs
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_payment_execution_job(
  p_prestataire_id uuid,
  p_creance_id uuid,
  p_amount_cents bigint,
  p_currency text,
  p_source public.payment_execution_job_source,
  p_idempotency_key text,
  p_correlation_id text default null
)
returns public.payment_execution_job
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_existing public.payment_execution_job;
  v_creance public.creance;
  v_new public.payment_execution_job;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'payment_job_amount_invalid' using errcode = '22023';
  end if;
  if nullif(btrim(p_currency), '') is distinct from 'EUR' then
    raise exception 'payment_job_currency_invalid' using errcode = '22023';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'payment_job_idempotency_key_required' using errcode = '22023';
  end if;

  select c.* into v_creance
  from public.creance c
  where c.id = p_creance_id
  for share;
  if not found then
    raise exception 'creance_not_found' using errcode = 'P0002';
  end if;
  if v_creance.prestataire_id is distinct from p_prestataire_id then
    raise exception 'payment_job_tenant_mismatch' using errcode = '22023';
  end if;

  select j.* into v_existing
  from public.payment_execution_job j
  where j.idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_existing.creance_id is distinct from p_creance_id
      or v_existing.prestataire_id is distinct from p_prestataire_id
      or v_existing.amount_cents is distinct from p_amount_cents
    then
      raise exception 'payment_job_idempotency_conflict' using errcode = '23505';
    end if;
    return v_existing;
  end if;

  insert into public.payment_execution_job (
    prestataire_id, creance_id, amount_cents, currency, source,
    idempotency_key, correlation_id
  ) values (
    p_prestataire_id, p_creance_id, p_amount_cents, 'EUR', p_source,
    btrim(p_idempotency_key), nullif(btrim(p_correlation_id), '')
  )
  returning * into v_new;

  return v_new;
end;
$$;

revoke all on function public.enqueue_payment_execution_job(
  uuid, uuid, bigint, text, public.payment_execution_job_source, text, text
) from public, anon, authenticated;
grant execute on function public.enqueue_payment_execution_job(
  uuid, uuid, bigint, text, public.payment_execution_job_source, text, text
) to service_role;

create or replace function public.claim_payment_execution_job(
  p_job_id uuid default null,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.payment_execution_job;
  v_now timestamptz := timezone('utc', now());
  v_lease uuid := gen_random_uuid();
begin
  if p_lease_seconds < 15 or p_lease_seconds > 600 then
    raise exception 'payment_job_lease_invalid' using errcode = '22023';
  end if;

  if p_job_id is not null then
    select j.* into v_job
    from public.payment_execution_job j
    where j.id = p_job_id
    for update;
    if not found then
      return jsonb_build_object('status', 'not_found');
    end if;
  else
    select j.* into v_job
    from public.payment_execution_job j
    where j.status in ('pending', 'failed_retryable', 'unknown')
       or (
         j.status = 'claimed'
         and j.lease_expires_at is not null
         and j.lease_expires_at <= v_now
       )
    order by j.created_at asc
    for update skip locked
    limit 1;
    if not found then
      return jsonb_build_object('status', 'not_found');
    end if;
  end if;

  if v_job.status in ('succeeded_pending_webhook', 'failed_terminal') then
    return jsonb_build_object(
      'status', 'already_terminal',
      'job', to_jsonb(v_job)
    );
  end if;

  if v_job.status = 'claimed'
    and v_job.lease_expires_at is not null
    and v_job.lease_expires_at > v_now
  then
    return jsonb_build_object(
      'status', 'in_progress',
      'job', to_jsonb(v_job)
    );
  end if;

  update public.payment_execution_job j
  set
    status = 'claimed',
    lease_token = v_lease,
    lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
    attempt_count = j.attempt_count + 1,
    updated_at = v_now
  where j.id = v_job.id
  returning j.* into v_job;

  return jsonb_build_object(
    'status', 'claimed',
    'job', to_jsonb(v_job),
    'lease_token', v_lease
  );
end;
$$;

revoke all on function public.claim_payment_execution_job(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_payment_execution_job(uuid, integer)
  to service_role;

create or replace function public.complete_payment_execution_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_failure_code text default null,
  p_tentative_paiement_id uuid default null,
  p_stripe_payment_intent_id text default null
)
returns public.payment_execution_job
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.payment_execution_job;
  v_now timestamptz := timezone('utc', now());
  v_status public.payment_execution_job_status;
begin
  select j.* into v_job
  from public.payment_execution_job j
  where j.id = p_job_id
  for update;
  if not found then
    raise exception 'payment_job_not_found' using errcode = 'P0002';
  end if;
  if v_job.status is distinct from 'claimed'
    or v_job.lease_token is distinct from p_lease_token
    or v_job.lease_expires_at is null
    or v_job.lease_expires_at <= v_now
  then
    raise exception 'payment_job_lease_lost' using errcode = 'P0002';
  end if;

  v_status := p_outcome::public.payment_execution_job_status;
  if v_status not in (
    'succeeded_pending_webhook',
    'failed_terminal',
    'failed_retryable',
    'unknown'
  ) then
    raise exception 'payment_job_outcome_invalid' using errcode = '22023';
  end if;

  update public.payment_execution_job j
  set
    status = v_status,
    lease_token = null,
    lease_expires_at = null,
    failure_code = case
      when v_status = 'succeeded_pending_webhook' then null
      else nullif(btrim(p_failure_code), '')
    end,
    tentative_paiement_id = coalesce(p_tentative_paiement_id, j.tentative_paiement_id),
    stripe_payment_intent_id = coalesce(
      nullif(btrim(p_stripe_payment_intent_id), ''),
      j.stripe_payment_intent_id
    ),
    updated_at = v_now
  where j.id = p_job_id
  returning j.* into v_job;

  return v_job;
end;
$$;

revoke all on function public.complete_payment_execution_job(
  uuid, uuid, text, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.complete_payment_execution_job(
  uuid, uuid, text, text, uuid, text
) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Snapshot checklist + claim / complete tentative off-session
-- ---------------------------------------------------------------------------

create or replace function public.load_automatic_payment_checklist(
  p_creance_id uuid,
  p_prestataire_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_creance public.creance;
  v_paid bigint;
  v_dossier_etat public.dossier_suivi_etat;
  v_auth public.payment_authorization;
  v_attempt public.tentative_paiement;
begin
  select c.* into v_creance
  from public.creance c
  where c.id = p_creance_id
    and c.prestataire_id = p_prestataire_id;
  if not found then
    raise exception 'creance_not_found' using errcode = 'P0002';
  end if;

  select coalesce(sum(p.montant), 0) into v_paid
  from public.paiement p
  where p.creance_id = v_creance.id;

  select d.etat into v_dossier_etat
  from public.dossier_suivi d
  where d.creance_id = v_creance.id;

  select a.* into v_auth
  from public.payment_authorization a
  where a.prestataire_id = v_creance.prestataire_id
    and a.client_payeur_id = v_creance.client_payeur_id
    and a.is_default = true
  order by a.created_at desc
  limit 1;

  select t.* into v_attempt
  from public.tentative_paiement t
  where t.creance_id = v_creance.id
    and t.etat in ('CREEE', 'NECESSITE_ACTION_CLIENT', 'EN_TRAITEMENT')
  limit 1;

  return jsonb_build_object(
    'creance', jsonb_build_object(
      'id', v_creance.id,
      'prestataire_id', v_creance.prestataire_id,
      'client_payeur_id', v_creance.client_payeur_id,
      'etat', v_creance.etat,
      'devise', v_creance.devise,
      'montant', v_creance.montant,
      'archived_at', v_creance.archived_at,
      'amount_paid_cents', v_paid,
      'remaining_cents', v_creance.montant - v_paid
    ),
    'dossier_etat', v_dossier_etat,
    'authorization', case
      when v_auth.id is null then null
      else to_jsonb(v_auth)
    end,
    'active_attempt', case
      when v_attempt.id is null then null
      else jsonb_build_object(
        'id', v_attempt.id,
        'etat', v_attempt.etat,
        'source', v_attempt.source,
        'stripe_payment_intent_id', v_attempt.stripe_payment_intent_id
      )
    end
  );
end;
$$;

revoke all on function public.load_automatic_payment_checklist(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.load_automatic_payment_checklist(uuid, uuid)
  to service_role;

create or replace function public.claim_automatic_payment_attempt(
  p_creance_id uuid,
  p_prestataire_id uuid,
  p_amount_cents bigint,
  p_authorization_id uuid,
  p_stripe_account_id text,
  p_stripe_customer_id text,
  p_idempotency_key text,
  p_lease_seconds integer default 120,
  p_guard_version text default 'sidian-auto-payment-guard-v1'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_creance public.creance;
  v_existing public.tentative_paiement;
  v_new public.tentative_paiement;
  v_now timestamptz := timezone('utc', now());
  v_lease uuid := gen_random_uuid();
  v_paid bigint;
  v_remaining bigint;
begin
  if p_lease_seconds < 15 or p_lease_seconds > 600 then
    raise exception 'automatic_lease_invalid' using errcode = '22023';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'automatic_idempotency_key_required' using errcode = '22023';
  end if;
  if p_guard_version is distinct from 'sidian-auto-payment-guard-v1' then
    return jsonb_build_object(
      'status', 'rejected',
      'code', 'automatic_payment_guard_required'
    );
  end if;

  select c.* into v_creance
  from public.creance c
  where c.id = p_creance_id
  for update;
  if not found or v_creance.prestataire_id is distinct from p_prestataire_id then
    return jsonb_build_object('status', 'rejected', 'code', 'creance_not_found');
  end if;
  if v_creance.archived_at is not null
    or v_creance.etat not in ('OUVERTE', 'PARTIELLEMENT_REGLEE')
    or v_creance.devise is distinct from 'EUR'
  then
    return jsonb_build_object('status', 'rejected', 'code', 'invalid_creance_state');
  end if;

  perform 1
  from public.prestataire p
  where p.id = v_creance.prestataire_id
    and p.stripe_account_id = nullif(btrim(p_stripe_account_id), '');
  if not found then
    return jsonb_build_object('status', 'rejected', 'code', 'stripe_account_scope_mismatch');
  end if;

  select coalesce(sum(pmt.montant), 0) into v_paid
  from public.paiement pmt
  where pmt.creance_id = v_creance.id;
  v_remaining := v_creance.montant - v_paid;
  if p_amount_cents is distinct from v_remaining or v_remaining <= 0 then
    return jsonb_build_object('status', 'rejected', 'code', 'amount_exceeds_remaining');
  end if;

  select t.* into v_existing
  from public.tentative_paiement t
  where t.creance_id = v_creance.id
    and t.etat in ('CREEE', 'NECESSITE_ACTION_CLIENT', 'EN_TRAITEMENT')
  for update;

  if found then
    if v_existing.stripe_payment_intent_id is not null then
      return jsonb_build_object(
        'status', 'already_created',
        'tentative_id', v_existing.id,
        'stripe_payment_intent_id', v_existing.stripe_payment_intent_id,
        'montant', v_existing.montant
      );
    end if;
    if v_existing.checkout_provisioning_status = 'creating'
      and v_existing.checkout_lease_expires_at is not null
      and v_existing.checkout_lease_expires_at > v_now
    then
      return jsonb_build_object(
        'status', 'in_progress',
        'tentative_id', v_existing.id
      );
    end if;

    -- Reprise : réutilise la clé d'idempotence Stripe persistée.
    update public.tentative_paiement t
    set
      checkout_provisioning_status = 'creating',
      checkout_lease_token = v_lease,
      checkout_lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      checkout_provisioning_attempts = t.checkout_provisioning_attempts + 1,
      checkout_provisioning_error_code = null,
      montant = v_remaining,
      payment_authorization_id = p_authorization_id,
      automatic_execution_guard_version = 'sidian-auto-payment-guard-v1',
      stripe_account_id = nullif(btrim(p_stripe_account_id), ''),
      stripe_customer_id = nullif(btrim(p_stripe_customer_id), ''),
      stripe_checkout_idempotency_key = coalesce(
        t.stripe_checkout_idempotency_key,
        nullif(btrim(p_idempotency_key), '')
      )
    where t.id = v_existing.id
    returning t.* into v_new;

    return jsonb_build_object(
      'status', 'reclaimed',
      'tentative_id', v_new.id,
      'lease_token', v_new.checkout_lease_token,
      'montant', v_new.montant,
      'idempotency_key', v_new.stripe_checkout_idempotency_key,
      'authorization_id', v_new.payment_authorization_id,
      'stripe_account_id', v_new.stripe_account_id,
      'stripe_customer_id', v_new.stripe_customer_id
    );
  end if;

  begin
    insert into public.tentative_paiement (
      creance_id,
      montant,
      moyen,
      source,
      etat,
      payment_authorization_id,
      automatic_execution_guard_version,
      stripe_account_id,
      stripe_customer_id,
      stripe_checkout_idempotency_key,
      checkout_provisioning_status,
      checkout_lease_token,
      checkout_lease_expires_at,
      checkout_provisioning_attempts,
      checkout_operation_key
    ) values (
      v_creance.id,
      v_remaining,
      'carte',
      'prelevement_auto',
      'CREEE',
      p_authorization_id,
      'sidian-auto-payment-guard-v1',
      nullif(btrim(p_stripe_account_id), ''),
      nullif(btrim(p_stripe_customer_id), ''),
      nullif(btrim(p_idempotency_key), ''),
      'creating',
      v_lease,
      v_now + make_interval(secs => p_lease_seconds),
      1,
      gen_random_uuid()
    )
    returning * into v_new;
  exception
    when others then
      return jsonb_build_object(
        'status', 'rejected',
        'code', sqlerrm
      );
  end;

  return jsonb_build_object(
    'status', 'claimed',
    'tentative_id', v_new.id,
    'lease_token', v_new.checkout_lease_token,
    'montant', v_new.montant,
    'idempotency_key', v_new.stripe_checkout_idempotency_key,
    'authorization_id', v_new.payment_authorization_id,
    'stripe_account_id', v_new.stripe_account_id,
    'stripe_customer_id', v_new.stripe_customer_id
  );
end;
$$;

revoke all on function public.claim_automatic_payment_attempt(
  uuid, uuid, bigint, uuid, text, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.claim_automatic_payment_attempt(
  uuid, uuid, bigint, uuid, text, text, text, integer, text
) to service_role;

create or replace function public.complete_automatic_payment_attempt(
  p_tentative_id uuid,
  p_lease_token uuid,
  p_stripe_payment_intent_id text,
  p_stripe_account_id text,
  p_stripe_customer_id text,
  p_application_fee_amount bigint,
  p_local_etat public.tentative_paiement_etat
)
returns public.tentative_paiement
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.tentative_paiement;
  v_now timestamptz := timezone('utc', now());
begin
  -- Jamais RÉUSSIE / ÉCHOUÉE terminale de confirmation fonds ici — webhook SoT.
  if p_local_etat not in ('CREEE', 'NECESSITE_ACTION_CLIENT', 'EN_TRAITEMENT') then
    raise exception 'automatic_local_etat_forbidden' using errcode = '22023';
  end if;
  if nullif(btrim(p_stripe_payment_intent_id), '') is null then
    raise exception 'stripe_payment_intent_id_required' using errcode = '22023';
  end if;

  select t.* into v_row
  from public.tentative_paiement t
  where t.id = p_tentative_id
  for update;
  if not found then
    raise exception 'tentative_not_found' using errcode = 'P0002';
  end if;
  if v_row.source is distinct from 'prelevement_auto'
    or v_row.checkout_provisioning_status is distinct from 'creating'
    or v_row.checkout_lease_token is distinct from p_lease_token
    or v_row.checkout_lease_expires_at is null
    or v_row.checkout_lease_expires_at <= v_now
  then
    raise exception 'automatic_lease_lost' using errcode = 'P0002';
  end if;
  if v_row.stripe_account_id is distinct from nullif(btrim(p_stripe_account_id), '') then
    raise exception 'stripe_account_scope_mismatch' using errcode = '22023';
  end if;

  update public.tentative_paiement t
  set
    checkout_provisioning_status = 'created',
    checkout_lease_token = null,
    checkout_lease_expires_at = null,
    checkout_provisioning_error_code = null,
    stripe_payment_intent_id = nullif(btrim(p_stripe_payment_intent_id), ''),
    stripe_customer_id = nullif(btrim(p_stripe_customer_id), ''),
    application_fee_amount = p_application_fee_amount,
    etat = p_local_etat
  where t.id = p_tentative_id
  returning t.* into v_row;

  return v_row;
end;
$$;

revoke all on function public.complete_automatic_payment_attempt(
  uuid, uuid, text, text, text, bigint, public.tentative_paiement_etat
) from public, anon, authenticated;
grant execute on function public.complete_automatic_payment_attempt(
  uuid, uuid, text, text, text, bigint, public.tentative_paiement_etat
) to service_role;

create or replace function public.fail_automatic_payment_attempt(
  p_tentative_id uuid,
  p_lease_token uuid,
  p_retryable boolean,
  p_error_code text
)
returns public.tentative_paiement
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.tentative_paiement;
  v_now timestamptz := timezone('utc', now());
begin
  select t.* into v_row
  from public.tentative_paiement t
  where t.id = p_tentative_id
  for update;
  if not found then
    raise exception 'tentative_not_found' using errcode = 'P0002';
  end if;
  if v_row.source is distinct from 'prelevement_auto'
    or v_row.checkout_provisioning_status is distinct from 'creating'
    or v_row.checkout_lease_token is distinct from p_lease_token
    or v_row.checkout_lease_expires_at is null
    or v_row.checkout_lease_expires_at <= v_now
  then
    raise exception 'automatic_lease_lost' using errcode = 'P0002';
  end if;

  if p_retryable then
    -- Garde la tentative non terminale pour reprise (même clé Stripe).
    update public.tentative_paiement t
    set
      checkout_provisioning_status = 'failed_retryable',
      checkout_lease_token = null,
      checkout_lease_expires_at = null,
      checkout_provisioning_error_code = left(nullif(btrim(p_error_code), ''), 100)
    where t.id = p_tentative_id
    returning t.* into v_row;
  else
    update public.tentative_paiement t
    set
      checkout_provisioning_status = 'failed_terminal',
      checkout_lease_token = null,
      checkout_lease_expires_at = null,
      checkout_provisioning_error_code = left(nullif(btrim(p_error_code), ''), 100),
      etat = 'ECHOUEE',
      echec_code = left(nullif(btrim(p_error_code), ''), 100)
    where t.id = p_tentative_id
    returning t.* into v_row;
  end if;

  return v_row;
end;
$$;

revoke all on function public.fail_automatic_payment_attempt(
  uuid, uuid, boolean, text
) from public, anon, authenticated;
grant execute on function public.fail_automatic_payment_attempt(
  uuid, uuid, boolean, text
) to service_role;
