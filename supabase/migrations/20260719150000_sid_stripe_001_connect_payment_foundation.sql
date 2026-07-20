-- SID-STRIPE-001 — socle Stripe Connect Express + modèle de paiement
-- Migration atomique : projection Connect, bindings Customer, payment_link,
-- identifiants de rapprochement, webhooks robustes, durcissement authorization.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

create type public.stripe_onboarding_status as enum (
  'non_commence',
  'configuration_commencee',
  'informations_requises',
  'verification_en_cours',
  'paiements_actives',
  'paiements_indisponibles',
  'action_requise'
);

comment on type public.stripe_onboarding_status is
  'Projection locale normalisée du compte Connect — jamais source de vérité financière.';

create type public.stripe_customer_binding_status as enum (
  'active',
  'superseded'
);

create type public.payment_link_status as enum (
  'active',
  'revoked'
);

create type public.webhook_processing_status as enum (
  'received',
  'processing',
  'processed',
  'failed_retryable',
  'failed_terminal',
  'ignored'
);

create type public.stripe_connect_provisioning_status as enum (
  'not_started',
  'creating',
  'created',
  'failed_retryable',
  'failed_terminal'
);

create type public.stripe_capability_status as enum (
  'inactive',
  'pending',
  'active'
);

-- ---------------------------------------------------------------------------
-- 2. prestataire — projection Connect + pricing_version
-- ---------------------------------------------------------------------------

alter table public.prestataire
  add column if not exists stripe_account_id text,
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists stripe_payouts_enabled boolean not null default false,
  add column if not exists stripe_details_submitted boolean not null default false,
  add column if not exists stripe_onboarding_status public.stripe_onboarding_status
    not null default 'non_commence',
  add column if not exists stripe_requirements_currently_due jsonb not null default '[]'::jsonb,
  add column if not exists stripe_requirements_pending_verification jsonb not null default '[]'::jsonb,
  add column if not exists stripe_requirements_past_due jsonb not null default '[]'::jsonb,
  add column if not exists stripe_disabled_reason text,
  add column if not exists stripe_status_synced_at timestamptz,
  add column if not exists stripe_sepa_debit_payments_status public.stripe_capability_status
    not null default 'inactive',
  add column if not exists stripe_connect_provisioning_status
    public.stripe_connect_provisioning_status not null default 'not_started',
  add column if not exists stripe_connect_operation_key uuid,
  add column if not exists stripe_connect_idempotency_key text,
  add column if not exists stripe_connect_attempts integer not null default 0,
  add column if not exists stripe_connect_lease_expires_at timestamptz,
  add column if not exists stripe_connect_last_error_code text,
  add column if not exists stripe_connect_provisioning_updated_at timestamptz;

-- Nouveaux comptes seulement : l'historique tarifaire non vide reste intact.
alter table public.prestataire
  alter column pricing_version set default 'early_solo';

alter table public.prestataire
  drop constraint if exists prestataire_pricing_version_allowed;

create unique index if not exists prestataire_stripe_account_id_unique_idx
  on public.prestataire (stripe_account_id)
  where stripe_account_id is not null;

comment on column public.prestataire.stripe_account_id is
  'Compte Connect Express — projection locale ; Stripe reste la source de vérité.';
comment on column public.prestataire.pricing_version is
  'Provenance tarifaire historique conservée ; early_solo est le défaut des nouveaux comptes.';

alter table public.prestataire
  add constraint prestataire_connect_attempts_nonnegative
    check (stripe_connect_attempts >= 0),
  add constraint prestataire_connect_operation_consistency
    check (
      stripe_connect_provisioning_status = 'not_started'
      or (
        stripe_connect_operation_key is not null
        and stripe_connect_idempotency_key is not null
      )
    ),
  add constraint prestataire_connect_created_has_account
    check (
      stripe_connect_provisioning_status <> 'created'
      or stripe_account_id is not null
    );

-- Bloquer toute mutation PostgREST des colonnes Stripe / pricing
create or replace function public.protect_prestataire_sensitive_columns()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if current_user = 'authenticated' then
    if new.email is distinct from old.email
      or new.created_at is distinct from old.created_at
      or new.user_id is distinct from old.user_id
      or new.subscription_status is distinct from old.subscription_status
      or new.pricing_version is distinct from old.pricing_version
      or new.subscription_started_at is distinct from old.subscription_started_at
      or new.early_access_price_locked_until is distinct from old.early_access_price_locked_until
      or new.platform_fee_basis_points is distinct from old.platform_fee_basis_points
      or new.profil_agent_defaut is distinct from old.profil_agent_defaut
      or new.nom is distinct from old.nom
      or new.stripe_account_id is distinct from old.stripe_account_id
      or new.stripe_charges_enabled is distinct from old.stripe_charges_enabled
      or new.stripe_payouts_enabled is distinct from old.stripe_payouts_enabled
      or new.stripe_details_submitted is distinct from old.stripe_details_submitted
      or new.stripe_onboarding_status is distinct from old.stripe_onboarding_status
      or new.stripe_requirements_currently_due is distinct from old.stripe_requirements_currently_due
      or new.stripe_requirements_pending_verification is distinct from old.stripe_requirements_pending_verification
      or new.stripe_requirements_past_due is distinct from old.stripe_requirements_past_due
      or new.stripe_disabled_reason is distinct from old.stripe_disabled_reason
      or new.stripe_status_synced_at is distinct from old.stripe_status_synced_at
      or new.stripe_sepa_debit_payments_status is distinct from old.stripe_sepa_debit_payments_status
      or new.stripe_connect_provisioning_status is distinct from old.stripe_connect_provisioning_status
      or new.stripe_connect_operation_key is distinct from old.stripe_connect_operation_key
      or new.stripe_connect_idempotency_key is distinct from old.stripe_connect_idempotency_key
      or new.stripe_connect_attempts is distinct from old.stripe_connect_attempts
      or new.stripe_connect_lease_expires_at is distinct from old.stripe_connect_lease_expires_at
      or new.stripe_connect_last_error_code is distinct from old.stripe_connect_last_error_code
      or new.stripe_connect_provisioning_updated_at is distinct from old.stripe_connect_provisioning_updated_at
    then
      raise exception 'Modification des champs prestataire interdite via PostgREST'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. creance — ready_for_collection_at
-- ---------------------------------------------------------------------------

alter table public.creance
  add column if not exists ready_for_collection_at timestamptz;

comment on column public.creance.ready_for_collection_at is
  'Signal métier « prêt à communiquer » — renseigné uniquement via commande serveur/RPC.';

-- ---------------------------------------------------------------------------
-- 4. tentative_paiement — checkout session
-- ---------------------------------------------------------------------------

alter table public.tentative_paiement
  add column if not exists stripe_checkout_session_id text;

create unique index if not exists tentative_paiement_stripe_checkout_session_id_unique_idx
  on public.tentative_paiement (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

-- ---------------------------------------------------------------------------
-- 5. payment_authorization — setup + EN_CONFIGURATION nullable
-- ---------------------------------------------------------------------------

alter table public.payment_authorization
  add column if not exists stripe_setup_intent_id text,
  add column if not exists stripe_setup_checkout_session_id text;

alter table public.payment_authorization
  alter column type drop not null;

alter table public.payment_authorization
  alter column stripe_payment_method_id drop not null;

alter table public.payment_authorization
  drop constraint if exists payment_authorization_active_requires_type;

alter table public.payment_authorization
  add constraint payment_authorization_active_requires_type
  check (etat <> 'ACTIVE' or type is not null) not valid;

alter table public.payment_authorization
  drop constraint if exists payment_authorization_active_requires_pm;

alter table public.payment_authorization
  add constraint payment_authorization_active_requires_pm
  check (etat <> 'ACTIVE' or stripe_payment_method_id is not null) not valid;

alter table public.payment_authorization
  drop constraint if exists payment_authorization_active_requires_authorized_at;

alter table public.payment_authorization
  add constraint payment_authorization_active_requires_authorized_at
  check (etat <> 'ACTIVE' or authorized_at is not null) not valid;

alter table public.payment_authorization
  add constraint payment_authorization_active_requires_text_version
  check (
    etat <> 'ACTIVE'
    or nullif(btrim(authorization_text_version), '') is not null
  ) not valid,
  add constraint payment_authorization_active_requires_channel
  check (
    etat <> 'ACTIVE'
    or nullif(btrim(authorization_channel), '') is not null
  ) not valid,
  add constraint payment_authorization_active_not_revoked
  check (etat <> 'ACTIVE' or revoked_at is null) not valid,
  add constraint payment_authorization_revoked_requires_timestamp
  check (etat <> 'REVOQUEE' or revoked_at is not null) not valid;

-- is_default => ACTIVE déjà présent (payment_authorization_default_requires_active)

create unique index if not exists payment_authorization_stripe_setup_intent_id_unique_idx
  on public.payment_authorization (stripe_setup_intent_id)
  where stripe_setup_intent_id is not null;

create unique index if not exists payment_authorization_setup_cs_unique_idx
  on public.payment_authorization (stripe_setup_checkout_session_id)
  where stripe_setup_checkout_session_id is not null;

-- ---------------------------------------------------------------------------
-- 6. stripe_customer_binding
-- ---------------------------------------------------------------------------

create table public.stripe_customer_binding (
  id uuid primary key default gen_random_uuid(),
  prestataire_id uuid not null references public.prestataire (id) on delete restrict,
  client_payeur_id uuid not null references public.client_payeur (id) on delete restrict,
  stripe_account_id text not null,
  stripe_customer_id text not null,
  status public.stripe_customer_binding_status not null default 'active',
  superseded_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint stripe_customer_binding_account_customer_unique
    unique (stripe_account_id, stripe_customer_id),
  constraint stripe_customer_binding_status_superseded_at_ck
    check (
      (status = 'active' and superseded_at is null)
      or (status = 'superseded' and superseded_at is not null)
    )
);

comment on table public.stripe_customer_binding is
  'Customer Stripe scopé au compte Connect — jamais partagé entre prestataires.';

create unique index stripe_customer_binding_active_pair_unique_idx
  on public.stripe_customer_binding (prestataire_id, client_payeur_id)
  where status = 'active';

create or replace function public.enforce_stripe_customer_binding_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_prestataire_id uuid;
begin
  select cp.prestataire_id into v_prestataire_id
  from public.client_payeur cp
  where cp.id = new.client_payeur_id;

  if v_prestataire_id is distinct from new.prestataire_id then
    raise exception 'stripe_customer_binding : client hors scope prestataire';
  end if;

  return new;
end;
$$;

create trigger stripe_customer_binding_scope_check
before insert or update on public.stripe_customer_binding
for each row execute function public.enforce_stripe_customer_binding_scope();

create or replace function public.touch_stripe_customer_binding_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create trigger stripe_customer_binding_touch_updated_at
before update on public.stripe_customer_binding
for each row execute function public.touch_stripe_customer_binding_updated_at();

-- ---------------------------------------------------------------------------
-- 7. payment_link
-- ---------------------------------------------------------------------------

create table public.payment_link (
  id uuid primary key default gen_random_uuid(),
  creance_id uuid not null references public.creance (id) on delete restrict,
  token_hash text not null,
  status public.payment_link_status not null default 'active',
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint payment_link_token_hash_unique unique (token_hash),
  constraint payment_link_status_revoked_at_ck
    check (
      (status = 'active' and revoked_at is null)
      or (status = 'revoked' and revoked_at is not null)
    )
);

comment on table public.payment_link is
  'Lien public opaque — token stocké uniquement en empreinte ; jamais réactivé après revocation.';

create unique index payment_link_active_creance_unique_idx
  on public.payment_link (creance_id)
  where status = 'active';

create or replace function public.prevent_payment_link_reactivation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if old.status = 'revoked' and new.status is distinct from 'revoked' then
    raise exception 'payment_link : révocation irréversible';
  end if;
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create trigger payment_link_no_reactivation
before update on public.payment_link
for each row execute function public.prevent_payment_link_reactivation();

-- ---------------------------------------------------------------------------
-- 8. processed_webhook_event — modèle cible
-- ---------------------------------------------------------------------------

alter table public.processed_webhook_event
  add column if not exists stripe_connected_account_id text,
  add column if not exists received_at timestamptz,
  add column if not exists processing_status public.webhook_processing_status,
  add column if not exists processing_attempts integer,
  add column if not exists last_error_code text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists next_attempt_at timestamptz;

-- Backfill lignes existantes (reset local : souvent vide)
update public.processed_webhook_event
set
  received_at = coalesce(received_at, processed_at, timezone('utc', now())),
  processing_status = coalesce(processing_status, 'processed'),
  processing_attempts = coalesce(processing_attempts, 1)
where received_at is null
   or processing_status is null
   or processing_attempts is null;

alter table public.processed_webhook_event
  alter column received_at set default timezone('utc', now()),
  alter column received_at set not null,
  alter column processing_status set default 'received',
  alter column processing_status set not null,
  alter column processing_attempts set default 0,
  alter column processing_attempts set not null;

alter table public.processed_webhook_event
  alter column processed_at drop not null,
  alter column processed_at drop default;

comment on table public.processed_webhook_event is
  'Acquisition atomique des webhooks Stripe — id = event.id ; pas de SELECT-then-INSERT.';

-- ---------------------------------------------------------------------------
-- 9. RLS + grants — aucune écriture navigateur
-- ---------------------------------------------------------------------------

alter table public.stripe_customer_binding enable row level security;
alter table public.payment_link enable row level security;

revoke all on table public.stripe_customer_binding from anon, authenticated;
revoke all on table public.payment_link from anon, authenticated;
revoke all on table public.processed_webhook_event from anon, authenticated;

grant all on table public.stripe_customer_binding to service_role;
grant all on table public.payment_link to service_role;
grant all on table public.processed_webhook_event to service_role;

-- Lecture authenticated pour payment_link / binding : non nécessaire au MVP lot 1
-- (pas de policy SELECT) — service_role uniquement.

-- ---------------------------------------------------------------------------
-- 10. RPC / commandes métier bornées
-- ---------------------------------------------------------------------------

-- Claim durable du provisioning Connect. Le verrou transactionnel protège la décision ;
-- le lease persistant protège l'appel réseau après le commit.
create or replace function public.claim_current_prestataire_connect_provisioning(
  p_lease_seconds integer default 120
)
returns public.prestataire
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.prestataire;
  v_now timestamptz := timezone('utc', now());
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 600 then
    raise exception 'connect_lease_invalid';
  end if;

  select p.* into v_row
  from public.prestataire p
  where p.user_id = auth.uid()
  for update;

  if not found then
    raise exception 'prestataire_not_found' using errcode = 'P0002';
  end if;

  if v_row.stripe_account_id is not null then
    update public.prestataire p
    set
      stripe_connect_provisioning_status = 'created',
      stripe_connect_lease_expires_at = null,
      stripe_connect_last_error_code = null,
      stripe_connect_provisioning_updated_at = v_now
    where p.id = v_row.id
    returning p.* into v_row;
    return v_row;
  end if;

  if v_row.stripe_connect_provisioning_status = 'failed_terminal' then
    raise exception 'connect_provisioning_terminal_failure';
  end if;

  if v_row.stripe_connect_provisioning_status = 'creating'
    and v_row.stripe_connect_lease_expires_at > v_now
  then
    raise exception 'connect_provisioning_in_progress' using errcode = '55P03';
  end if;

  update public.prestataire p
  set
    stripe_connect_provisioning_status = 'creating',
    stripe_connect_operation_key = coalesce(p.stripe_connect_operation_key, gen_random_uuid()),
    stripe_connect_idempotency_key = coalesce(
      p.stripe_connect_idempotency_key,
      'sidian_connect_' || p.id::text || '_' || gen_random_uuid()::text
    ),
    stripe_connect_attempts = p.stripe_connect_attempts + 1,
    stripe_connect_lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
    stripe_connect_last_error_code = null,
    stripe_connect_provisioning_updated_at = v_now
  where p.id = v_row.id
  returning p.* into v_row;

  return v_row;
end;
$$;

revoke all on function public.claim_current_prestataire_connect_provisioning(integer) from public;
revoke all on function public.claim_current_prestataire_connect_provisioning(integer) from anon;
grant execute on function public.claim_current_prestataire_connect_provisioning(integer) to authenticated;

create or replace function public.complete_prestataire_connect_provisioning(
  p_prestataire_id uuid,
  p_operation_key uuid,
  p_stripe_account_id text
)
returns public.prestataire
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.prestataire;
begin
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
  return v_row;
end;
$$;

revoke all on function public.complete_prestataire_connect_provisioning(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_prestataire_connect_provisioning(uuid, uuid, text) to service_role;

create or replace function public.fail_prestataire_connect_provisioning(
  p_prestataire_id uuid,
  p_operation_key uuid,
  p_retryable boolean,
  p_error_code text
)
returns public.prestataire
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.prestataire;
begin
  update public.prestataire p
  set
    stripe_connect_provisioning_status = case
      when p_retryable then 'failed_retryable'::public.stripe_connect_provisioning_status
      else 'failed_terminal'::public.stripe_connect_provisioning_status
    end,
    stripe_connect_lease_expires_at = null,
    stripe_connect_last_error_code = left(nullif(btrim(p_error_code), ''), 100),
    stripe_connect_provisioning_updated_at = timezone('utc', now())
  where p.id = p_prestataire_id
    and p.stripe_connect_operation_key = p_operation_key
    and p.stripe_connect_provisioning_status = 'creating'
  returning p.* into v_row;

  if not found then
    raise exception 'connect_provisioning_claim_mismatch' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

revoke all on function public.fail_prestataire_connect_provisioning(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.fail_prestataire_connect_provisioning(uuid, uuid, boolean, text) to service_role;

-- Marquer une créance prête à communiquer
create or replace function public.mark_creance_ready_for_collection(p_creance_id uuid)
returns public.creance
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_prestataire_id uuid := public.current_prestataire_id();
  v_row public.creance;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if v_prestataire_id is null then
    raise exception 'prestataire_not_found' using errcode = 'P0002';
  end if;

  update public.creance c
  set
    ready_for_collection_at = coalesce(c.ready_for_collection_at, timezone('utc', now())),
    updated_at = timezone('utc', now())
  where c.id = p_creance_id
    and c.prestataire_id = v_prestataire_id
    and c.archived_at is null
  returning c.* into v_row;

  if not found then
    raise exception 'creance_not_found' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

revoke all on function public.mark_creance_ready_for_collection(uuid) from public;
revoke all on function public.mark_creance_ready_for_collection(uuid) from anon;
grant execute on function public.mark_creance_ready_for_collection(uuid) to authenticated;

-- Remplacement transactionnel binding Customer (service_role / SECURITY DEFINER interne)
create or replace function public.replace_stripe_customer_binding(
  p_prestataire_id uuid,
  p_client_payeur_id uuid,
  p_stripe_customer_id text
)
returns public.stripe_customer_binding
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_new public.stripe_customer_binding;
  v_stripe_account_id text;
begin
  if p_stripe_customer_id is null or length(trim(p_stripe_customer_id)) = 0 then
    raise exception 'stripe_customer_id_required';
  end if;

  select p.stripe_account_id into v_stripe_account_id
  from public.prestataire p
  where p.id = p_prestataire_id
  for update;

  if not found then
    raise exception 'prestataire_not_found' using errcode = 'P0002';
  end if;
  if v_stripe_account_id is null then
    raise exception 'stripe_account_not_configured';
  end if;

  perform 1
  from public.client_payeur cp
  where cp.id = p_client_payeur_id
    and cp.prestataire_id = p_prestataire_id
  for update;
  if not found then
    raise exception 'client_payeur_not_found' using errcode = 'P0002';
  end if;

  update public.stripe_customer_binding b
  set
    status = 'superseded',
    superseded_at = timezone('utc', now())
  where b.prestataire_id = p_prestataire_id
    and b.client_payeur_id = p_client_payeur_id
    and b.status = 'active';

  insert into public.stripe_customer_binding (
    prestataire_id,
    client_payeur_id,
    stripe_account_id,
    stripe_customer_id,
    status
  )
  values (
    p_prestataire_id,
    p_client_payeur_id,
    v_stripe_account_id,
    p_stripe_customer_id,
    'active'
  )
  returning * into v_new;

  return v_new;
end;
$$;

revoke all on function public.replace_stripe_customer_binding(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.replace_stripe_customer_binding(uuid, uuid, text) to service_role;

create or replace function public.revoke_stripe_customer_binding(
  p_prestataire_id uuid,
  p_client_payeur_id uuid
)
returns public.stripe_customer_binding
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.stripe_customer_binding;
begin
  perform 1
  from public.prestataire p
  where p.id = p_prestataire_id
  for update;
  if not found then
    raise exception 'prestataire_not_found' using errcode = 'P0002';
  end if;

  update public.stripe_customer_binding b
  set status = 'superseded', superseded_at = timezone('utc', now())
  where b.prestataire_id = p_prestataire_id
    and b.client_payeur_id = p_client_payeur_id
    and b.status = 'active'
  returning b.* into v_row;
  if not found then
    raise exception 'stripe_customer_binding_not_found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

revoke all on function public.revoke_stripe_customer_binding(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_stripe_customer_binding(uuid, uuid) to service_role;

-- Créer un payment_link (révoque l'actif éventuel, insert nouveau)
create or replace function public.create_payment_link_for_creance(
  p_creance_id uuid,
  p_token_hash text
)
returns public.payment_link
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_new public.payment_link;
begin
  if p_token_hash is null or length(trim(p_token_hash)) < 32 then
    raise exception 'token_hash_invalid';
  end if;

  if not exists (select 1 from public.creance c where c.id = p_creance_id) then
    raise exception 'creance_not_found' using errcode = 'P0002';
  end if;

  update public.payment_link pl
  set
    status = 'revoked',
    revoked_at = timezone('utc', now())
  where pl.creance_id = p_creance_id
    and pl.status = 'active';

  insert into public.payment_link (creance_id, token_hash, status)
  values (p_creance_id, p_token_hash, 'active')
  returning * into v_new;

  return v_new;
end;
$$;

revoke all on function public.create_payment_link_for_creance(uuid, text) from public;
revoke all on function public.create_payment_link_for_creance(uuid, text) from anon;
revoke all on function public.create_payment_link_for_creance(uuid, text) from authenticated;
grant execute on function public.create_payment_link_for_creance(uuid, text) to service_role;

create or replace function public.revoke_payment_link(p_payment_link_id uuid)
returns public.payment_link
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.payment_link;
begin
  update public.payment_link pl
  set
    status = 'revoked',
    revoked_at = coalesce(pl.revoked_at, timezone('utc', now()))
  where pl.id = p_payment_link_id
  returning * into v_row;

  if not found then
    raise exception 'payment_link_not_found' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

revoke all on function public.revoke_payment_link(uuid) from public;
revoke all on function public.revoke_payment_link(uuid) from anon;
revoke all on function public.revoke_payment_link(uuid) from authenticated;
grant execute on function public.revoke_payment_link(uuid) to service_role;

-- Remplacement transactionnel de l'autorisation par défaut
create or replace function public.set_default_payment_authorization(
  p_authorization_id uuid
)
returns public.payment_authorization
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_target public.payment_authorization;
  v_new public.payment_authorization;
begin
  select * into v_target
  from public.payment_authorization
  where id = p_authorization_id
  for update;

  if not found then
    raise exception 'payment_authorization_not_found' using errcode = 'P0002';
  end if;

  if v_target.etat <> 'ACTIVE' then
    raise exception 'payment_authorization_not_active';
  end if;

  update public.payment_authorization
  set is_default = false
  where client_payeur_id = v_target.client_payeur_id
    and prestataire_id = v_target.prestataire_id
    and is_default = true
    and id is distinct from p_authorization_id;

  update public.payment_authorization
  set is_default = true
  where id = p_authorization_id
  returning * into v_new;

  return v_new;
end;
$$;

revoke all on function public.set_default_payment_authorization(uuid) from public;
revoke all on function public.set_default_payment_authorization(uuid) from anon;
revoke all on function public.set_default_payment_authorization(uuid) from authenticated;
grant execute on function public.set_default_payment_authorization(uuid) to service_role;

-- Acquisition/réclamation atomique webhook avec lease et replay.
create or replace function public.claim_stripe_webhook_event(
  p_event_id text,
  p_type text,
  p_stripe_connected_account_id text default null,
  p_lease_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.processed_webhook_event;
  v_now timestamptz := timezone('utc', now());
begin
  if p_event_id is null or btrim(p_event_id) = '' then
    raise exception 'webhook_event_id_required';
  end if;
  if p_lease_seconds < 15 or p_lease_seconds > 600 then
    raise exception 'webhook_lease_invalid';
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
    nullif(trim(p_stripe_connected_account_id), ''),
    timezone('utc', now()),
    'received',
    0
  )
  on conflict (id) do nothing;

  select e.* into v_row
  from public.processed_webhook_event e
  where e.id = p_event_id
  for update;

  if v_row.type is distinct from p_type
    or v_row.stripe_connected_account_id is distinct from nullif(btrim(p_stripe_connected_account_id), '')
  then
    raise exception 'webhook_event_identity_mismatch';
  end if;

  if v_row.processing_status in ('processed', 'ignored', 'failed_terminal') then
    return jsonb_build_object(
      'claimed', false,
      'status', v_row.processing_status::text,
      'terminal', true
    );
  end if;

  if v_row.processing_status = 'processing'
    and v_row.lease_expires_at > v_now
  then
    return jsonb_build_object(
      'claimed', false,
      'status', 'processing',
      'terminal', false
    );
  end if;

  if v_row.processing_status = 'failed_retryable'
    and v_row.next_attempt_at > v_now
  then
    return jsonb_build_object(
      'claimed', false,
      'status', 'failed_retryable',
      'terminal', false
    );
  end if;

  update public.processed_webhook_event e
  set
    processing_status = 'processing',
    processing_attempts = e.processing_attempts + 1,
    lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
    next_attempt_at = null,
    processed_at = null,
    last_error_code = null
  where e.id = p_event_id;

  return jsonb_build_object(
    'claimed', true,
    'status', 'processing',
    'terminal', false,
    'attempt', v_row.processing_attempts + 1
  );
end;
$$;

revoke all on function public.claim_stripe_webhook_event(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_stripe_webhook_event(text, text, text, integer) to service_role;

create or replace function public.mark_stripe_webhook_event_status(
  p_event_id text,
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
begin
  if p_status not in ('processed', 'ignored', 'failed_retryable', 'failed_terminal') then
    raise exception 'webhook_status_transition_invalid';
  end if;
  if p_status = 'failed_retryable'
    and (p_retry_delay_seconds is null or p_retry_delay_seconds < 1 or p_retry_delay_seconds > 86400)
  then
    raise exception 'webhook_retry_delay_invalid';
  end if;

  update public.processed_webhook_event e
  set
    processing_status = p_status,
    processed_at = case
      when p_status in ('processed', 'ignored', 'failed_terminal')
        then timezone('utc', now())
      else null
    end,
    lease_expires_at = null,
    next_attempt_at = case
      when p_status = 'failed_retryable'
        then timezone('utc', now()) + make_interval(secs => p_retry_delay_seconds)
      else null
    end,
    last_error_code = left(nullif(btrim(p_error_code), ''), 100)
  where e.id = p_event_id
    and e.processing_status = 'processing'
  returning * into v_row;

  if not found then
    raise exception 'webhook_event_not_claimed' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

revoke all on function public.mark_stripe_webhook_event_status(
  text, public.webhook_processing_status, text, integer
) from public, anon, authenticated;
grant execute on function public.mark_stripe_webhook_event_status(
  text, public.webhook_processing_status, text, integer
) to service_role;

-- Persistance projection Connect (service_role)
create or replace function public.sync_prestataire_stripe_projection(
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
returns public.prestataire
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.prestataire;
begin
  update public.prestataire p
  set
    stripe_account_id = p_stripe_account_id,
    stripe_charges_enabled = coalesce(p_charges_enabled, false),
    stripe_payouts_enabled = coalesce(p_payouts_enabled, false),
    stripe_details_submitted = coalesce(p_details_submitted, false),
    stripe_sepa_debit_payments_status = coalesce(p_sepa_debit_payments_status, 'inactive'),
    stripe_onboarding_status = p_onboarding_status,
    stripe_requirements_currently_due = coalesce(p_currently_due, '[]'::jsonb),
    stripe_requirements_pending_verification = coalesce(p_pending_verification, '[]'::jsonb),
    stripe_requirements_past_due = coalesce(p_past_due, '[]'::jsonb),
    stripe_disabled_reason = nullif(trim(p_disabled_reason), ''),
    stripe_status_synced_at = timezone('utc', now())
  where p.id = p_prestataire_id
  returning * into v_row;

  if not found then
    raise exception 'prestataire_not_found' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

revoke all on function public.sync_prestataire_stripe_projection(
  uuid, text, boolean, boolean, boolean, public.stripe_capability_status,
  public.stripe_onboarding_status, jsonb, jsonb, jsonb, text
) from public, anon, authenticated;
grant execute on function public.sync_prestataire_stripe_projection(
  uuid, text, boolean, boolean, boolean, public.stripe_capability_status,
  public.stripe_onboarding_status, jsonb, jsonb, jsonb, text
) to service_role;

-- Mettre à jour le helper RLS (sans toucher aux migrations antérieures)
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
      'payment_link'
    )
  order by c.relname;
$$;
