-- SID-STRIPE-002-A — ouverture transactionnelle, socle Checkout et rate limiting.

-- ---------------------------------------------------------------------------
-- 1. Tentatives Checkout : provisioning, snapshots et invariants concurrents
-- ---------------------------------------------------------------------------

create type public.stripe_checkout_provisioning_status as enum (
  'not_started',
  'creating',
  'created',
  'failed_retryable',
  'failed_terminal'
);

alter table public.tentative_paiement
  alter column moyen drop not null,
  add column payment_link_id uuid
    references public.payment_link (id) on delete restrict,
  add column checkout_operation_key uuid,
  add column stripe_checkout_idempotency_key text,
  add column checkout_provisioning_status
    public.stripe_checkout_provisioning_status not null default 'not_started',
  add column checkout_lease_token uuid,
  add column checkout_lease_expires_at timestamptz,
  add column checkout_provisioning_attempts integer not null default 0,
  add column checkout_provisioning_error_code text,
  add column stripe_account_id text,
  add column stripe_customer_id text,
  add column stripe_checkout_session_expires_at timestamptz,
  add column application_fee_amount bigint;

alter table public.tentative_paiement
  add constraint tentative_checkout_provisioning_attempts_nonnegative_ck
    check (checkout_provisioning_attempts >= 0),
  add constraint tentative_checkout_application_fee_nonnegative_ck
    check (application_fee_amount is null or application_fee_amount >= 0),
  add constraint tentative_checkout_technical_ids_not_blank_ck
    check (
      (stripe_checkout_session_id is null
        or nullif(btrim(stripe_checkout_session_id), '') is not null)
      and (stripe_payment_intent_id is null
        or nullif(btrim(stripe_payment_intent_id), '') is not null)
      and (stripe_checkout_idempotency_key is null
        or nullif(btrim(stripe_checkout_idempotency_key), '') is not null)
      and (checkout_provisioning_error_code is null
        or nullif(btrim(checkout_provisioning_error_code), '') is not null)
    ),
  add constraint tentative_checkout_stripe_snapshots_not_blank_ck
    check (
      (stripe_account_id is null
        or nullif(btrim(stripe_account_id), '') is not null)
      and (stripe_customer_id is null
        or nullif(btrim(stripe_customer_id), '') is not null)
    ),
  add constraint tentative_checkout_customer_requires_account_ck
    check (stripe_customer_id is null or stripe_account_id is not null),
  add constraint tentative_checkout_session_expiry_requires_session_ck
    check (
      stripe_checkout_session_expires_at is null
      or stripe_checkout_session_id is not null
    ),
  add constraint tentative_checkout_lease_consistency_ck
    check (
      (
        checkout_provisioning_status = 'creating'
        and checkout_lease_token is not null
        and checkout_lease_expires_at is not null
      )
      or (
        checkout_provisioning_status <> 'creating'
        and checkout_lease_token is null
        and checkout_lease_expires_at is null
      )
    );

create unique index tentative_paiement_nonterminal_creance_unique_idx
  on public.tentative_paiement (creance_id)
  where etat in ('CREEE', 'NECESSITE_ACTION_CLIENT', 'EN_TRAITEMENT');

create unique index tentative_paiement_checkout_operation_key_unique_idx
  on public.tentative_paiement (checkout_operation_key)
  where checkout_operation_key is not null;

create unique index tentative_paiement_checkout_idempotency_key_unique_idx
  on public.tentative_paiement (stripe_checkout_idempotency_key)
  where stripe_checkout_idempotency_key is not null;

create unique index tentative_paiement_payment_intent_unique_idx
  on public.tentative_paiement (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create index tentative_paiement_payment_link_idx
  on public.tentative_paiement (payment_link_id)
  where payment_link_id is not null;

create index tentative_paiement_checkout_claim_idx
  on public.tentative_paiement (
    checkout_provisioning_status,
    checkout_lease_expires_at
  )
  where checkout_provisioning_status in ('creating', 'failed_retryable');

create or replace function public.enforce_tentative_payment_link_creance_match()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.payment_link_id is not null
    and not exists (
      select 1
      from public.payment_link pl
      where pl.id = new.payment_link_id
        and pl.creance_id = new.creance_id
    )
  then
    raise exception 'tentative_payment_link_creance_mismatch'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_tentative_payment_link_creance_match()
  from public, anon, authenticated, service_role;

create trigger tentative_payment_link_creance_match
before insert or update of payment_link_id, creance_id
on public.tentative_paiement
for each row execute function public.enforce_tentative_payment_link_creance_match();

comment on column public.tentative_paiement.application_fee_amount is
  'Commission figée en centimes pour la future Session Checkout ; nullable avant provisioning.';

-- ---------------------------------------------------------------------------
-- 2. Ouverture transactionnelle et génération exclusive du token côté base
-- ---------------------------------------------------------------------------

-- Cette ancienne primitive acceptait un hash choisi par l'appelant. La conserver
-- rendrait la garantie de génération serveur directement contournable.
revoke all on function public.create_payment_link_for_creance(uuid, text)
  from public, anon, authenticated, service_role;
drop function public.create_payment_link_for_creance(uuid, text);

-- ready_for_collection_at fait désormais partie de la commande d'ouverture.
revoke all on function public.mark_creance_ready_for_collection(uuid)
  from public, anon, authenticated, service_role;
drop function public.mark_creance_ready_for_collection(uuid);

create or replace function public.open_payment_receivable(p_creance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_prestataire_id uuid;
  v_creance public.creance;
  v_link public.payment_link;
  v_now timestamptz := timezone('utc', now());
  v_raw_token text;
  v_token_hash text;
  v_opened boolean := false;
  v_link_created boolean := false;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  v_prestataire_id := public.current_prestataire_id();
  if v_prestataire_id is null then
    raise exception 'prestataire_not_found' using errcode = 'P0002';
  end if;

  select c.* into v_creance
  from public.creance c
  where c.id = p_creance_id
    and c.prestataire_id = v_prestataire_id
  for update;

  if not found then
    raise exception 'creance_not_found' using errcode = 'P0002';
  end if;
  if v_creance.archived_at is not null then
    raise exception 'payment_receivable_archived' using errcode = '22023';
  end if;
  if v_creance.etat not in ('BROUILLON', 'OUVERTE') then
    raise exception 'payment_receivable_not_payable' using errcode = '22023';
  end if;

  if v_creance.etat = 'BROUILLON' then
    update public.creance c
    set
      etat = 'OUVERTE',
      ready_for_collection_at = coalesce(c.ready_for_collection_at, v_now),
      updated_at = v_now
    where c.id = v_creance.id
    returning c.* into v_creance;
    v_opened := true;

    insert into public.audit_log (
      prestataire_id,
      actor_type,
      action,
      entity_type,
      entity_id,
      metadata
    )
    values (
      v_prestataire_id,
      'human',
      'PAYMENT_RECEIVABLE_OPENED',
      'creance',
      v_creance.id,
      jsonb_build_object('from_state', 'BROUILLON', 'to_state', 'OUVERTE')
    );
  elsif v_creance.ready_for_collection_at is null then
    update public.creance c
    set ready_for_collection_at = v_now, updated_at = v_now
    where c.id = v_creance.id
    returning c.* into v_creance;
  end if;

  select pl.* into v_link
  from public.payment_link pl
  where pl.creance_id = v_creance.id
    and pl.status = 'active'
  for update;

  if not found then
    v_raw_token := replace(
      replace(
        rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='),
        '+',
        '-'
      ),
      '/',
      '_'
    );
    v_token_hash := encode(
      extensions.digest(convert_to(v_raw_token, 'UTF8'), 'sha256'),
      'hex'
    );

    insert into public.payment_link (creance_id, token_hash, status)
    values (v_creance.id, v_token_hash, 'active')
    returning * into v_link;
    v_link_created := true;

    insert into public.audit_log (
      prestataire_id,
      actor_type,
      action,
      entity_type,
      entity_id,
      metadata
    )
    values (
      v_prestataire_id,
      'human',
      'PAYMENT_LINK_CREATED',
      'creance',
      v_creance.id,
      jsonb_build_object('payment_link_id', v_link.id)
    );
  end if;

  return jsonb_build_object(
    'creance_id', v_creance.id,
    'creance_state', v_creance.etat::text,
    'ready_for_collection_at', v_creance.ready_for_collection_at,
    'opened', v_opened,
    'payment_link_id', v_link.id,
    'payment_link_created', v_link_created,
    'raw_token_available', v_link_created,
    'raw_token', case when v_link_created then v_raw_token else null end,
    'result', case
      when v_link_created then 'payment_link_created'
      else 'payment_link_already_exists_token_unavailable'
    end
  );
end;
$$;

comment on function public.open_payment_receivable(uuid) is
  'Ouvre une créance du tenant et crée au plus un lien. Le token brut est émis une seule fois et jamais récupérable.';

revoke all on function public.open_payment_receivable(uuid)
  from public, anon, service_role;
grant execute on function public.open_payment_receivable(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Rate limiting persistant privé (sujets déjà pseudonymisés côté serveur)
-- ---------------------------------------------------------------------------

create type public.public_rate_limit_category as enum (
  'link_resolution_ip',
  'link_resolution_token',
  'checkout_creation_ip',
  'checkout_new_operation_link'
);

create table public.public_rate_limit_event (
  id uuid primary key default gen_random_uuid(),
  category public.public_rate_limit_category not null,
  subject_hash text not null,
  occurred_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  constraint public_rate_limit_subject_hash_ck
    check (subject_hash ~ '^[0-9a-f]{64}$'),
  constraint public_rate_limit_expiry_ck check (expires_at > occurred_at)
);

create index public_rate_limit_lookup_idx
  on public.public_rate_limit_event (category, subject_hash, occurred_at);

create index public_rate_limit_expiry_idx
  on public.public_rate_limit_event (expires_at);

alter table public.public_rate_limit_event enable row level security;
revoke all on table public.public_rate_limit_event
  from public, anon, authenticated, service_role;

comment on table public.public_rate_limit_event is
  'Événements privés de quota public. subject_hash est un pseudonyme serveur ; aucune IP ni token brut.';

create or replace function public.consume_public_rate_limit(
  p_category public.public_rate_limit_category,
  p_subject_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_window interval := interval '10 minutes';
  v_limit integer;
  v_count integer;
  v_reset_at timestamptz;
begin
  if p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'rate_limit_subject_invalid' using errcode = '22023';
  end if;

  v_limit := case p_category
    when 'link_resolution_ip' then 30
    when 'link_resolution_token' then 60
    when 'checkout_creation_ip' then 5
    when 'checkout_new_operation_link' then 3
  end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_category::text || ':' || p_subject_hash, 0)
  );

  delete from public.public_rate_limit_event e
  where e.category = p_category
    and e.subject_hash = p_subject_hash
    and e.expires_at <= v_now;

  select count(*)::integer, min(e.expires_at)
    into v_count, v_reset_at
  from public.public_rate_limit_event e
  where e.category = p_category
    and e.subject_hash = p_subject_hash
    and e.expires_at > v_now;

  if v_count >= v_limit then
    return jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'reset_at', v_reset_at
    );
  end if;

  insert into public.public_rate_limit_event (
    category,
    subject_hash,
    occurred_at,
    expires_at
  )
  values (p_category, p_subject_hash, v_now, v_now + v_window);

  v_count := v_count + 1;
  v_reset_at := coalesce(v_reset_at, v_now + v_window);

  return jsonb_build_object(
    'allowed', true,
    'remaining', v_limit - v_count,
    'reset_at', v_reset_at
  );
end;
$$;

revoke all on function public.consume_public_rate_limit(
  public.public_rate_limit_category, text
) from public, anon, authenticated;
grant execute on function public.consume_public_rate_limit(
  public.public_rate_limit_category, text
) to service_role;

create or replace function public.purge_expired_public_rate_limits(
  p_batch_size integer default 1000
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_deleted integer;
begin
  if p_batch_size < 1 or p_batch_size > 10000 then
    raise exception 'rate_limit_purge_batch_invalid' using errcode = '22023';
  end if;

  with expired as (
    select e.id
    from public.public_rate_limit_event e
    where e.expires_at <= timezone('utc', now())
    order by e.expires_at
    limit p_batch_size
    for update skip locked
  )
  delete from public.public_rate_limit_event e
  using expired
  where e.id = expired.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_expired_public_rate_limits(integer)
  from public, anon, authenticated;
grant execute on function public.purge_expired_public_rate_limits(integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Inventaire RLS de diagnostic
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
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
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
      'stripe_connect_audit_outbox',
      'public_rate_limit_event'
    )
  order by c.relname;
$$;
