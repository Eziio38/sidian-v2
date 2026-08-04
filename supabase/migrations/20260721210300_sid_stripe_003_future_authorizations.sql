-- SID-STRIPE-003 — autorisations de paiement futures via Checkout setup.
--
-- Migration additive. Invariants :
--   * le token public est opaque ; seul son SHA-256 est conservé ;
--   * une proposition est liée à la relation client × prestataire, jamais au
--     seul résultat financier du premier paiement ;
--   * la Session setup réutilise exactement le compte Connect et le Customer
--     du Checkout de paiement source ;
--   * toute transition issue d'un webhook est fencée par le claim courant ;
--   * ACTIVE n'est atteint que sur setup_intent.succeeded vérifié ;
--   * aucun prélèvement SEPA off-session n'est autorisé tant que la stratégie
--     de prénotification Stripe réelle n'a pas été validée (fail-closed).

-- ---------------------------------------------------------------------------
-- 1. Projection durable du parcours setup et backstop off-session
-- ---------------------------------------------------------------------------
--
-- Stratégie legacy fail-closed (SID-STRIPE-003) :
-- * aucune fabrication d'identifiants Stripe ;
-- * les lignes pré-003 sans snapshots complets sont marquées
--   legacy_incomplete = true, retirées de is_default, et passées en
--   SUSPENDUE (si encore exploitables) avec suspension_reason =
--   'legacy_incomplete_projection' ;
-- * elles restent historisées, identifiables, et refusées par le garde
--   off-session ;
-- * les nouvelles autorisations (legacy_incomplete = false) restent soumises
--   aux contraintes strictes de snapshots / mandat.

alter table public.payment_authorization
  add column source_tentative_paiement_id uuid
    references public.tentative_paiement (id) on delete restrict,
  add column reconsidered_from_authorization_id uuid
    references public.payment_authorization (id) on delete restrict,
  add column public_token_hash text,
  add column public_token_expires_at timestamptz,
  add column stripe_account_id text,
  add column stripe_customer_id text,
  add column accepted_at timestamptz,
  add column stripe_setup_idempotency_key text,
  add column setup_operation_key uuid,
  add column setup_provisioning_status text not null default 'idle',
  add column setup_lease_token uuid,
  add column setup_lease_expires_at timestamptz,
  add column setup_provisioning_attempts integer not null default 0,
  add column setup_provisioning_error_code text,
  add column stripe_setup_session_expires_at timestamptz,
  add column stripe_mandate_status text,
  add column suspension_reason text,
  add column proposal_neutralized_at timestamptz,
  add column resume_as_default boolean not null default false,
  add column legacy_incomplete boolean not null default false;

comment on column public.payment_authorization.legacy_incomplete is
  'Projection pré-SID-STRIPE-003 sans preuves setup complètes. Jamais utilisable '
  'en off-session ; ne doit jamais être effacé sans nouveau parcours setup.';

-- Neutralisation explicite des projections historiques incompatibles avec les
-- invariants setup. Aucun identifiant Stripe n'est inventé.
update public.payment_authorization a
set
  legacy_incomplete = true,
  is_default = false,
  resume_as_default = false,
  etat = case
    when a.etat in ('ACTIVE', 'EN_CONFIGURATION', 'PROPOSEE')
      then 'SUSPENDUE'::public.payment_authorization_etat
    else a.etat
  end,
  suspension_reason = case
    when a.etat in ('ACTIVE', 'EN_CONFIGURATION', 'PROPOSEE')
      or a.etat = 'SUSPENDUE'
      then 'legacy_incomplete_projection'
    else a.suspension_reason
  end
where a.etat in (
    'EN_CONFIGURATION', 'ACTIVE', 'SUSPENDUE', 'REVOQUEE', 'PROPOSEE'
  )
  and (
    a.source_tentative_paiement_id is null
    or nullif(btrim(a.stripe_account_id), '') is null
    or nullif(btrim(a.stripe_customer_id), '') is null
    or a.accepted_at is null
    or nullif(btrim(a.stripe_setup_idempotency_key), '') is null
    or a.setup_operation_key is null
    or (
      a.type = 'sepa_core_mandate'
      and a.etat = 'ACTIVE'
      and (
        nullif(btrim(a.stripe_mandate_id), '') is null
        or a.stripe_mandate_status is distinct from 'active'
      )
    )
  );

alter table public.payment_authorization
  add constraint payment_authorization_public_token_hash_ck
    check (
      public_token_hash is null
      or public_token_hash ~ '^[0-9a-f]{64}$'
    ) not valid,
  add constraint payment_authorization_public_token_pair_ck
    check (
      (public_token_hash is null and public_token_expires_at is null)
      or (public_token_hash is not null and public_token_expires_at is not null)
    ) not valid,
  add constraint payment_authorization_setup_status_ck
    check (
      setup_provisioning_status in (
        'idle', 'creating', 'created', 'failed_retryable', 'failed_terminal'
      )
    ) not valid,
  add constraint payment_authorization_setup_attempts_nonnegative_ck
    check (setup_provisioning_attempts >= 0) not valid,
  add constraint payment_authorization_setup_lease_consistency_ck
    check (
      (
        setup_provisioning_status = 'creating'
        and setup_lease_token is not null
        and setup_lease_expires_at is not null
      )
      or (
        setup_provisioning_status <> 'creating'
        and setup_lease_token is null
        and setup_lease_expires_at is null
      )
    ) not valid,
  add constraint payment_authorization_setup_created_requires_session_ck
    check (
      setup_provisioning_status <> 'created'
      or stripe_setup_checkout_session_id is not null
    ) not valid,
  add constraint payment_authorization_setup_expiry_requires_session_ck
    check (
      stripe_setup_session_expires_at is null
      or stripe_setup_checkout_session_id is not null
    ) not valid,
  add constraint payment_authorization_setup_snapshots_not_blank_ck
    check (
      (stripe_account_id is null or nullif(btrim(stripe_account_id), '') is not null)
      and (stripe_customer_id is null or nullif(btrim(stripe_customer_id), '') is not null)
      and (stripe_setup_idempotency_key is null
        or nullif(btrim(stripe_setup_idempotency_key), '') is not null)
      and (setup_provisioning_error_code is null
        or nullif(btrim(setup_provisioning_error_code), '') is not null)
      and (stripe_mandate_status is null
        or stripe_mandate_status in ('active', 'pending', 'inactive'))
    ) not valid,
  add constraint payment_authorization_legacy_incomplete_ck
    check (
      legacy_incomplete = false
      or (
        is_default = false
        and resume_as_default = false
        and etat in ('SUSPENDUE', 'REVOQUEE', 'EXPIREE', 'REFUSEE')
        and (
          etat <> 'SUSPENDUE'
          or suspension_reason = 'legacy_incomplete_projection'
        )
      )
    ) not valid,
  add constraint payment_authorization_configured_requires_snapshots_ck
    check (
      legacy_incomplete = true
      or etat not in ('EN_CONFIGURATION', 'ACTIVE', 'SUSPENDUE', 'REVOQUEE')
      or (
        source_tentative_paiement_id is not null
        and stripe_account_id is not null
        and stripe_customer_id is not null
        and accepted_at is not null
        and stripe_setup_idempotency_key is not null
        and setup_operation_key is not null
      )
    ) not valid,
  add constraint payment_authorization_suspension_reason_state_ck
    check (
      suspension_reason is null
      or etat = 'SUSPENDUE'
    ) not valid,
  add constraint payment_authorization_reconsideration_not_self_ck
    check (
      reconsidered_from_authorization_id is null
      or reconsidered_from_authorization_id <> id
    ) not valid,
  add constraint payment_authorization_active_sepa_requires_mandate_ck
    check (
      legacy_incomplete = true
      or etat <> 'ACTIVE'
      or type <> 'sepa_core_mandate'
      or (
        nullif(btrim(stripe_mandate_id), '') is not null
        and stripe_mandate_status = 'active'
      )
    ) not valid;

-- Validation immédiate. Les lignes legacy ont déjà été neutralisées ; toute
-- autre incompatibilité interrompt la migration (fail-closed).
alter table public.payment_authorization
  validate constraint payment_authorization_public_token_hash_ck,
  validate constraint payment_authorization_public_token_pair_ck,
  validate constraint payment_authorization_setup_status_ck,
  validate constraint payment_authorization_setup_attempts_nonnegative_ck,
  validate constraint payment_authorization_setup_lease_consistency_ck,
  validate constraint payment_authorization_setup_created_requires_session_ck,
  validate constraint payment_authorization_setup_expiry_requires_session_ck,
  validate constraint payment_authorization_setup_snapshots_not_blank_ck,
  validate constraint payment_authorization_legacy_incomplete_ck,
  validate constraint payment_authorization_configured_requires_snapshots_ck,
  validate constraint payment_authorization_suspension_reason_state_ck,
  validate constraint payment_authorization_reconsideration_not_self_ck,
  validate constraint payment_authorization_active_sepa_requires_mandate_ck;

create unique index payment_authorization_source_tentative_unique_idx
  on public.payment_authorization (source_tentative_paiement_id)
  where source_tentative_paiement_id is not null
    and etat in ('PROPOSEE', 'EN_CONFIGURATION', 'ACTIVE', 'SUSPENDUE');

create unique index payment_authorization_reconsidered_from_unique_idx
  on public.payment_authorization (reconsidered_from_authorization_id)
  where reconsidered_from_authorization_id is not null;

create unique index payment_authorization_public_token_hash_unique_idx
  on public.payment_authorization (public_token_hash)
  where public_token_hash is not null;

create unique index payment_authorization_setup_operation_unique_idx
  on public.payment_authorization (setup_operation_key)
  where setup_operation_key is not null;

create unique index payment_authorization_setup_idempotency_unique_idx
  on public.payment_authorization (stripe_setup_idempotency_key)
  where stripe_setup_idempotency_key is not null;

create index payment_authorization_setup_claim_idx
  on public.payment_authorization (
    setup_provisioning_status,
    setup_lease_expires_at
  )
  where setup_provisioning_status in ('creating', 'failed_retryable');

alter table public.tentative_paiement
  add column payment_authorization_id uuid
    references public.payment_authorization (id) on delete restrict,
  add column automatic_execution_guard_version text;

alter table public.tentative_paiement
  add constraint tentative_automatic_authorization_required_ck
    check (
      source <> 'prelevement_auto'
      or (
        payment_authorization_id is not null
        and nullif(btrim(automatic_execution_guard_version), '') is not null
      )
    ) not valid;

alter table public.tentative_paiement
  validate constraint tentative_automatic_authorization_required_ck;

create index tentative_paiement_authorization_idx
  on public.tentative_paiement (payment_authorization_id)
  where payment_authorization_id is not null;

comment on column public.payment_authorization.public_token_hash is
  'SHA-256 du token public opaque. Le token brut n est jamais stocké ni journalisé.';
comment on column public.payment_authorization.authorization_text_version is
  'Version exacte du texte Sidian accepté avant ouverture de Checkout setup.';
comment on column public.tentative_paiement.automatic_execution_guard_version is
  'Version du garde déterministe ayant autorisé une tentative off-session. Jamais fournie par le navigateur.';

-- Backstop de table : même un INSERT service_role direct ne peut pas créer une
-- tentative automatique sans autorisation active/default et garde métier. Le
-- SEPA reste entièrement fermé tant que la prénotification réelle n'est pas
-- validée dans la configuration Stripe cible (03 §5.3).
create or replace function public.enforce_automatic_payment_attempt_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_creance public.creance;
  v_authorization public.payment_authorization;
  v_dossier_etat public.dossier_suivi_etat;
  v_paid bigint;
begin
  if new.source <> 'prelevement_auto' then
    return new;
  end if;

  if new.payment_authorization_id is null
    or new.automatic_execution_guard_version is distinct from
      'sidian-auto-payment-guard-v1'
  then
    raise exception 'automatic_payment_guard_required' using errcode = '23514';
  end if;

  select c.* into v_creance
  from public.creance c
  where c.id = new.creance_id;
  if not found
    or v_creance.devise is distinct from 'EUR'
    or v_creance.etat not in ('OUVERTE', 'PARTIELLEMENT_REGLEE')
    or v_creance.archived_at is not null
  then
    raise exception 'automatic_payment_receivable_ineligible' using errcode = '23514';
  end if;

  select a.* into v_authorization
  from public.payment_authorization a
  where a.id = new.payment_authorization_id;
  if not found
    or v_authorization.prestataire_id is distinct from v_creance.prestataire_id
    or v_authorization.client_payeur_id is distinct from v_creance.client_payeur_id
    or v_authorization.etat <> 'ACTIVE'
    or v_authorization.is_default is not true
    or v_authorization.legacy_incomplete is not false
    or nullif(btrim(v_authorization.stripe_account_id), '') is null
    or nullif(btrim(v_authorization.stripe_customer_id), '') is null
    or nullif(btrim(v_authorization.stripe_payment_method_id), '') is null
    or v_authorization.accepted_at is null
    or v_authorization.authorized_at is null
    or nullif(btrim(v_authorization.authorization_text_version), '') is null
    or nullif(btrim(v_authorization.authorization_channel), '') is null
    or not exists (
      select 1
      from public.prestataire p
      where p.id = v_authorization.prestataire_id
        and p.stripe_account_id = v_authorization.stripe_account_id
    )
    or not exists (
      select 1
      from public.stripe_customer_binding b
      where b.prestataire_id = v_authorization.prestataire_id
        and b.client_payeur_id = v_authorization.client_payeur_id
        and b.stripe_account_id = v_authorization.stripe_account_id
        and b.stripe_customer_id = v_authorization.stripe_customer_id
        and b.status = 'active'
    )
  then
    raise exception 'automatic_payment_authorization_ineligible' using errcode = '23514';
  end if;

  if v_authorization.type = 'sepa_core_mandate' then
    raise exception 'sepa_prenotification_validation_required' using errcode = '23514';
  end if;
  if v_authorization.type <> 'card_off_session' or new.moyen <> 'carte' then
    raise exception 'automatic_payment_rail_mismatch' using errcode = '23514';
  end if;

  select d.etat into v_dossier_etat
  from public.dossier_suivi d
  where d.creance_id = v_creance.id;
  if v_dossier_etat in ('PAUSE_LITIGE', 'ESCALADE_HUMAINE') then
    raise exception 'automatic_payment_followup_blocked' using errcode = '23514';
  end if;

  select coalesce(sum(p.montant), 0) into v_paid
  from public.paiement p
  where p.creance_id = v_creance.id;
  if new.montant <= 0 or new.montant > v_creance.montant - v_paid then
    raise exception 'automatic_payment_amount_invalid' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_automatic_payment_attempt_guard()
  from public, anon, authenticated, service_role;

-- Refuse de promouvoir une projection legacy incomplète en défaut exploitable.
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

  if v_target.etat <> 'ACTIVE'
    or v_target.legacy_incomplete is not false
  then
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

revoke all on function public.set_default_payment_authorization(uuid)
  from public, anon, authenticated;
grant execute on function public.set_default_payment_authorization(uuid)
  to service_role;

create trigger tentative_automatic_payment_guard
before insert or update of
  source, payment_authorization_id, automatic_execution_guard_version,
  creance_id, montant, moyen
on public.tentative_paiement
for each row execute function public.enforce_automatic_payment_attempt_guard();

-- Étend le contrôle de scope de l'audit à payment_authorization.
create or replace function public.enforce_audit_log_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_prestataire_id uuid;
begin
  if new.entity_id is null then
    return new;
  end if;

  case new.entity_type
    when 'creance' then
      select c.prestataire_id into v_prestataire_id
      from public.creance c where c.id = new.entity_id;
    when 'client_payeur' then
      select cp.prestataire_id into v_prestataire_id
      from public.client_payeur cp where cp.id = new.entity_id;
    when 'conversation' then
      select conv.prestataire_id into v_prestataire_id
      from public.conversation conv where conv.id = new.entity_id;
    when 'approval_request' then
      select ar.prestataire_id into v_prestataire_id
      from public.approval_request ar where ar.id = new.entity_id;
    when 'payment_authorization' then
      select pa.prestataire_id into v_prestataire_id
      from public.payment_authorization pa where pa.id = new.entity_id;
    else
      return new;
  end case;

  if v_prestataire_id is not null
    and v_prestataire_id is distinct from new.prestataire_id
  then
    raise exception 'audit_log.prestataire_id incohérent avec entity_id';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Proposition publique et provisioning Checkout setup
-- ---------------------------------------------------------------------------

create or replace function public.prepare_payment_authorization_proposal(
  p_tentative_id uuid,
  p_stripe_account_id text,
  p_stripe_customer_id text,
  p_public_token_hash text,
  p_public_token_expires_at timestamptz,
  p_authorization_text_version text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_creance_id uuid;
  v_tentative public.tentative_paiement;
  v_creance public.creance;
  v_existing public.payment_authorization;
  v_now timestamptz := timezone('utc', now());
begin
  if p_tentative_id is null
    or nullif(btrim(p_stripe_account_id), '') is null
    or nullif(btrim(p_stripe_customer_id), '') is null
    or p_public_token_hash !~ '^[0-9a-f]{64}$'
    or p_public_token_expires_at is null
    or p_public_token_expires_at <= v_now + interval '15 minutes'
    or p_public_token_expires_at > v_now + interval '30 days'
    or nullif(btrim(p_authorization_text_version), '') is null
  then
    raise exception 'payment_authorization_proposal_invalid' using errcode = '22023';
  end if;

  select t.creance_id into v_creance_id
  from public.tentative_paiement t
  where t.id = p_tentative_id;
  if not found then
    raise exception 'payment_tentative_not_found' using errcode = 'P0002';
  end if;

  -- Ordre de verrou commun au paiement : créance puis tentative.
  select c.* into v_creance
  from public.creance c
  where c.id = v_creance_id
  for update;

  select t.* into v_tentative
  from public.tentative_paiement t
  where t.id = p_tentative_id
  for update;
  if not found
    or v_tentative.source <> 'lien_agent'
    or v_tentative.stripe_account_id is distinct from nullif(btrim(p_stripe_account_id), '')
    or v_tentative.checkout_provisioning_status not in ('creating', 'created')
  then
    raise exception 'payment_authorization_source_invalid' using errcode = '22023';
  end if;

  if v_creance.devise is distinct from 'EUR' then
    raise exception 'payment_currency_not_supported' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.prestataire p
    where p.id = v_creance.prestataire_id
      and p.stripe_account_id = nullif(btrim(p_stripe_account_id), '')
  ) then
    raise exception 'stripe_account_scope_mismatch' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.stripe_customer_binding b
    where b.prestataire_id = v_creance.prestataire_id
      and b.client_payeur_id = v_creance.client_payeur_id
      and b.stripe_account_id = nullif(btrim(p_stripe_account_id), '')
      and b.stripe_customer_id = nullif(btrim(p_stripe_customer_id), '')
      and b.status = 'active'
  ) then
    raise exception 'stripe_customer_scope_mismatch' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_creance.prestataire_id::text || ':' || v_creance.client_payeur_id::text,
      0
    )
  );

  select a.* into v_existing
  from public.payment_authorization a
  where a.source_tentative_paiement_id = v_tentative.id
    and a.public_token_hash = p_public_token_hash
  for update;
  if found then
    if v_existing.public_token_hash is distinct from p_public_token_hash
      or v_existing.stripe_account_id is distinct from p_stripe_account_id
      or v_existing.stripe_customer_id is distinct from p_stripe_customer_id
      or v_existing.authorization_text_version is distinct from
        nullif(btrim(p_authorization_text_version), '')
    then
      raise exception 'payment_authorization_proposal_identity_mismatch'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'status', 'proposed',
      'authorization_id', v_existing.id,
      'token_expires_at', v_existing.public_token_expires_at
    );
  end if;

  -- Proposition unique pour la relation. Une autorisation/refus antérieur ne
  -- provoque jamais un nouveau popup automatique à chaque paiement.
  if exists (
    select 1 from public.payment_authorization a
    where a.prestataire_id = v_creance.prestataire_id
      and a.client_payeur_id = v_creance.client_payeur_id
      and a.proposal_neutralized_at is null
  ) then
    return jsonb_build_object('status', 'not_offered');
  end if;

  insert into public.payment_authorization (
    client_payeur_id,
    prestataire_id,
    etat,
    is_default,
    source_tentative_paiement_id,
    public_token_hash,
    public_token_expires_at,
    stripe_account_id,
    stripe_customer_id,
    authorization_text_version,
    setup_operation_key,
    stripe_setup_idempotency_key
  )
  values (
    v_creance.client_payeur_id,
    v_creance.prestataire_id,
    'PROPOSEE',
    false,
    v_tentative.id,
    p_public_token_hash,
    p_public_token_expires_at,
    nullif(btrim(p_stripe_account_id), ''),
    nullif(btrim(p_stripe_customer_id), ''),
    nullif(btrim(p_authorization_text_version), ''),
    gen_random_uuid(),
    'sidian_setup_' || replace(gen_random_uuid()::text, '-', '')
  )
  returning * into v_existing;

  insert into public.audit_log (
    prestataire_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    v_existing.prestataire_id,
    'system',
    'PAYMENT_AUTHORIZATION_PROPOSED',
    'payment_authorization',
    v_existing.id,
    jsonb_build_object(
      'source_tentative_id', v_tentative.id,
      'authorization_text_version', v_existing.authorization_text_version,
      'token_expires_at', v_existing.public_token_expires_at
    )
  );

  return jsonb_build_object(
    'status', 'proposed',
    'authorization_id', v_existing.id,
    'token_expires_at', v_existing.public_token_expires_at
  );
end;
$$;

-- Neutralise uniquement une proposition dont le détenteur du lease Checkout
-- prouve qu'elle n'a jamais été intégrée à une Session Stripe. La ligne et son
-- audit sont conservés, mais elle ne bloque plus une proposition ultérieure.
create or replace function public.neutralize_unexposed_authorization_proposal(
  p_tentative_id uuid,
  p_checkout_lease_token uuid,
  p_public_token_hash text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_creance_id uuid;
  v_tentative public.tentative_paiement;
  v_creance public.creance;
  v_row public.payment_authorization;
  v_neutralized boolean := false;
begin
  select t.creance_id into v_creance_id
  from public.tentative_paiement t
  where t.id = p_tentative_id;
  if not found then
    raise exception 'payment_tentative_not_found' using errcode = 'P0002';
  end if;

  select c.* into v_creance
  from public.creance c
  where c.id = v_creance_id
  for update;
  select t.* into v_tentative
  from public.tentative_paiement t
  where t.id = p_tentative_id
  for update;

  if v_tentative.checkout_provisioning_status <> 'creating'
    or v_tentative.checkout_lease_token is distinct from p_checkout_lease_token
    or v_tentative.checkout_lease_expires_at <= timezone('utc', now())
    or v_tentative.stripe_checkout_session_id is not null
  then
    raise exception 'checkout_lease_lost' using errcode = 'P0002';
  end if;

  select a.* into v_row
  from public.payment_authorization a
  where a.source_tentative_paiement_id = v_tentative.id
    and a.public_token_hash = p_public_token_hash
  for update;
  if found and v_row.proposal_neutralized_at is null then
    if v_row.etat <> 'PROPOSEE'
      or v_row.accepted_at is not null
      or v_row.setup_provisioning_status <> 'idle'
      or v_row.stripe_setup_checkout_session_id is not null
      or v_row.stripe_setup_intent_id is not null
    then
      raise exception 'authorization_proposal_already_exposed' using errcode = '22023';
    end if;
    update public.payment_authorization a
    set
      etat = 'EXPIREE',
      public_token_expires_at = timezone('utc', now()),
      proposal_neutralized_at = timezone('utc', now()),
      is_default = false
    where a.id = v_row.id;
    v_neutralized := true;
  end if;

  if not exists (
    select 1 from public.audit_log l
    where l.prestataire_id = v_creance.prestataire_id
      and l.action = 'PAYMENT_AUTHORIZATION_PROPOSAL_UNAVAILABLE'
      and l.metadata ->> 'source_tentative_id' = v_tentative.id::text
      and l.metadata ->> 'reason' = left(
        coalesce(nullif(btrim(p_reason), ''), 'proposal_unavailable'), 100
      )
  ) then
    insert into public.audit_log (
      prestataire_id, actor_type, action, entity_type, entity_id, metadata
    ) values (
      v_creance.prestataire_id,
      'system',
      'PAYMENT_AUTHORIZATION_PROPOSAL_UNAVAILABLE',
      'creance',
      v_creance.id,
      jsonb_build_object(
        'source_tentative_id', v_tentative.id,
        'reason', left(
          coalesce(nullif(btrim(p_reason), ''), 'proposal_unavailable'), 100
        ),
        'proposal_neutralized', v_neutralized
      )
    );
  end if;

  return jsonb_build_object('neutralized', v_neutralized);
end;
$$;

comment on function public.prepare_payment_authorization_proposal(
  uuid, text, text, text, timestamptz, text
) is
  'Prépare de façon idempotente l unique proposition post-Checkout. Le token brut reste exclusivement côté serveur.';

create or replace function public.resolve_payment_authorization_public(
  p_public_token_hash text,
  p_source_checkout_session_id text,
  p_setup_checkout_session_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row record;
begin
  if p_public_token_hash !~ '^[0-9a-f]{64}$'
    or nullif(btrim(p_source_checkout_session_id), '') is null
  then
    return jsonb_build_object('found', false);
  end if;

  select
    a.id,
    a.etat,
    a.public_token_expires_at,
    a.authorization_text_version,
    a.stripe_setup_checkout_session_id,
    a.setup_provisioning_status,
    p.nom as prestataire_nom,
    t.etat as initial_payment_state
  into v_row
  from public.payment_authorization a
  join public.tentative_paiement t
    on t.id = a.source_tentative_paiement_id
  join public.prestataire p on p.id = a.prestataire_id
  where a.public_token_hash = p_public_token_hash
    and t.stripe_checkout_session_id = nullif(btrim(p_source_checkout_session_id), '')
    and (
      p_setup_checkout_session_id is null
      or a.stripe_setup_checkout_session_id =
        nullif(btrim(p_setup_checkout_session_id), '')
    );
  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'etat', v_row.etat,
    'expired', v_row.public_token_expires_at <= timezone('utc', now()),
    'authorization_text_version', v_row.authorization_text_version,
    'prestataire_nom', v_row.prestataire_nom,
    'initial_payment_state', v_row.initial_payment_state,
    'setup_provisioning_status', v_row.setup_provisioning_status
  );
end;
$$;

-- Contexte interne nécessaire à la revérification live Stripe. Il n'est jamais
-- renvoyé au navigateur et reste service_role uniquement.
create or replace function public.resolve_payment_authorization_setup_context(
  p_public_token_hash text,
  p_source_checkout_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row record;
begin
  if p_public_token_hash !~ '^[0-9a-f]{64}$'
    or nullif(btrim(p_source_checkout_session_id), '') is null
  then
    return jsonb_build_object('found', false);
  end if;

  select
    a.id as authorization_id,
    a.etat,
    a.public_token_expires_at,
    a.stripe_account_id,
    a.stripe_customer_id,
    a.authorization_text_version,
    a.stripe_setup_checkout_session_id,
    a.setup_provisioning_status,
    a.prestataire_id,
    a.client_payeur_id,
    t.stripe_checkout_session_id as source_checkout_session_id
  into v_row
  from public.payment_authorization a
  join public.tentative_paiement t
    on t.id = a.source_tentative_paiement_id
  join public.prestataire p
    on p.id = a.prestataire_id
   and p.stripe_account_id = a.stripe_account_id
  join public.stripe_customer_binding b
    on b.prestataire_id = a.prestataire_id
   and b.client_payeur_id = a.client_payeur_id
   and b.stripe_account_id = a.stripe_account_id
   and b.stripe_customer_id = a.stripe_customer_id
   and b.status = 'active'
  where a.public_token_hash = p_public_token_hash
    and t.stripe_checkout_session_id = nullif(btrim(p_source_checkout_session_id), '');
  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'authorization_id', v_row.authorization_id,
    'etat', v_row.etat,
    'expired', v_row.public_token_expires_at <= timezone('utc', now()),
    'stripe_account_id', v_row.stripe_account_id,
    'stripe_customer_id', v_row.stripe_customer_id,
    'authorization_text_version', v_row.authorization_text_version,
    'source_checkout_session_id', v_row.source_checkout_session_id,
    'stripe_setup_checkout_session_id', v_row.stripe_setup_checkout_session_id,
    'setup_provisioning_status', v_row.setup_provisioning_status,
    'prestataire_id', v_row.prestataire_id,
    'client_payeur_id', v_row.client_payeur_id
  );
end;
$$;

create or replace function public.claim_payment_authorization_setup(
  p_public_token_hash text,
  p_source_checkout_session_id text,
  p_stripe_account_id text,
  p_stripe_customer_id text,
  p_authorization_text_version text,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.payment_authorization;
  v_now timestamptz := timezone('utc', now());
  v_lease uuid;
begin
  if p_lease_seconds < 15 or p_lease_seconds > 600 then
    raise exception 'authorization_setup_lease_invalid' using errcode = '22023';
  end if;

  select a.* into v_row
  from public.payment_authorization a
  join public.tentative_paiement t
    on t.id = a.source_tentative_paiement_id
  where a.public_token_hash = p_public_token_hash
    and t.stripe_checkout_session_id = nullif(btrim(p_source_checkout_session_id), '')
  for update of a;
  if not found then
    raise exception 'payment_authorization_not_found' using errcode = 'P0002';
  end if;
  if v_row.public_token_expires_at <= v_now then
    raise exception 'payment_authorization_token_expired' using errcode = '22023';
  end if;
  if v_row.stripe_account_id is distinct from nullif(btrim(p_stripe_account_id), '')
    or v_row.stripe_customer_id is distinct from nullif(btrim(p_stripe_customer_id), '')
    or v_row.authorization_text_version is distinct from
      nullif(btrim(p_authorization_text_version), '')
  then
    raise exception 'payment_authorization_scope_mismatch' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.prestataire p
    where p.id = v_row.prestataire_id
      and p.stripe_account_id = v_row.stripe_account_id
  ) or not exists (
    select 1 from public.stripe_customer_binding b
    where b.prestataire_id = v_row.prestataire_id
      and b.client_payeur_id = v_row.client_payeur_id
      and b.stripe_account_id = v_row.stripe_account_id
      and b.stripe_customer_id = v_row.stripe_customer_id
      and b.status = 'active'
  ) then
    raise exception 'payment_authorization_scope_mismatch' using errcode = '22023';
  end if;

  if v_row.setup_provisioning_status = 'created'
    and v_row.stripe_setup_checkout_session_id is not null
  then
    return jsonb_build_object(
      'status', 'already_created',
      'authorization_id', v_row.id,
      'stripe_account_id', v_row.stripe_account_id,
      'stripe_customer_id', v_row.stripe_customer_id,
      'stripe_setup_checkout_session_id', v_row.stripe_setup_checkout_session_id,
      'idempotency_key', v_row.stripe_setup_idempotency_key
    );
  end if;

  if v_row.etat not in ('PROPOSEE', 'EN_CONFIGURATION')
    or v_row.setup_provisioning_status = 'failed_terminal'
  then
    raise exception 'payment_authorization_not_configurable' using errcode = '22023';
  end if;

  if v_row.setup_provisioning_status = 'creating'
    and v_row.setup_lease_expires_at > v_now
  then
    return jsonb_build_object(
      'status', 'in_progress',
      'authorization_id', v_row.id,
      'lease_expires_at', v_row.setup_lease_expires_at
    );
  end if;

  v_lease := gen_random_uuid();
  update public.payment_authorization a
  set
    etat = 'EN_CONFIGURATION',
    accepted_at = coalesce(a.accepted_at, v_now),
    authorization_channel = coalesce(a.authorization_channel, 'public_checkout_return'),
    setup_provisioning_status = 'creating',
    setup_lease_token = v_lease,
    setup_lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
    setup_provisioning_attempts = a.setup_provisioning_attempts + 1,
    setup_provisioning_error_code = null
  where a.id = v_row.id
  returning * into v_row;

  if v_row.setup_provisioning_attempts = 1 then
    insert into public.audit_log (
      prestataire_id, actor_type, action, entity_type, entity_id, metadata
    ) values (
      v_row.prestataire_id,
      'human',
      'PAYMENT_AUTHORIZATION_ACCEPTED',
      'payment_authorization',
      v_row.id,
      jsonb_build_object(
        'authorization_text_version', v_row.authorization_text_version,
        'authorization_channel', v_row.authorization_channel
      )
    );
  end if;

  return jsonb_build_object(
    'status', case when v_row.setup_provisioning_attempts = 1 then 'claimed' else 'reclaimed' end,
    'authorization_id', v_row.id,
    'stripe_account_id', v_row.stripe_account_id,
    'stripe_customer_id', v_row.stripe_customer_id,
    'idempotency_key', v_row.stripe_setup_idempotency_key,
    'operation_key', v_row.setup_operation_key,
    'lease_token', v_row.setup_lease_token,
    'lease_expires_at', v_row.setup_lease_expires_at,
    'attempt', v_row.setup_provisioning_attempts
  );
end;
$$;

create or replace function public.complete_payment_authorization_setup(
  p_authorization_id uuid,
  p_lease_token uuid,
  p_stripe_account_id text,
  p_stripe_customer_id text,
  p_stripe_setup_checkout_session_id text,
  p_stripe_setup_intent_id text,
  p_session_expires_at timestamptz
)
returns public.payment_authorization
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.payment_authorization;
begin
  select a.* into v_row
  from public.payment_authorization a
  where a.id = p_authorization_id
  for update;
  if not found then
    raise exception 'payment_authorization_not_found' using errcode = 'P0002';
  end if;
  if v_row.setup_provisioning_status <> 'creating'
    or v_row.setup_lease_token is distinct from p_lease_token
    or v_row.setup_lease_expires_at <= timezone('utc', now())
  then
    raise exception 'authorization_setup_lease_lost' using errcode = 'P0002';
  end if;
  if v_row.stripe_account_id is distinct from nullif(btrim(p_stripe_account_id), '')
    or v_row.stripe_customer_id is distinct from nullif(btrim(p_stripe_customer_id), '')
    or nullif(btrim(p_stripe_setup_checkout_session_id), '') is null
  then
    raise exception 'payment_authorization_scope_mismatch' using errcode = '22023';
  end if;
  if p_session_expires_at is null
    or p_session_expires_at <= timezone('utc', now())
    or p_session_expires_at > timezone('utc', now()) + interval '24 hours'
  then
    raise exception 'authorization_setup_session_expiry_invalid'
      using errcode = '22023';
  end if;

  update public.payment_authorization a
  set
    stripe_setup_checkout_session_id =
      nullif(btrim(p_stripe_setup_checkout_session_id), ''),
    stripe_setup_intent_id = coalesce(
      a.stripe_setup_intent_id,
      nullif(btrim(p_stripe_setup_intent_id), '')
    ),
    stripe_setup_session_expires_at = p_session_expires_at,
    setup_provisioning_status = 'created',
    setup_lease_token = null,
    setup_lease_expires_at = null,
    setup_provisioning_error_code = null
  where a.id = v_row.id
  returning * into v_row;

  insert into public.audit_log (
    prestataire_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    v_row.prestataire_id,
    'system',
    'PAYMENT_AUTHORIZATION_SETUP_CREATED',
    'payment_authorization',
    v_row.id,
    jsonb_build_object(
      'setup_checkout_session_id', v_row.stripe_setup_checkout_session_id,
      'setup_intent_id', v_row.stripe_setup_intent_id,
      'setup_session_expires_at', v_row.stripe_setup_session_expires_at
    )
  );
  return v_row;
end;
$$;

create or replace function public.fail_payment_authorization_setup(
  p_authorization_id uuid,
  p_lease_token uuid,
  p_retryable boolean,
  p_error_code text
)
returns public.payment_authorization
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.payment_authorization;
begin
  update public.payment_authorization a
  set
    setup_provisioning_status = case
      when p_retryable then 'failed_retryable' else 'failed_terminal'
    end,
    setup_lease_token = null,
    setup_lease_expires_at = null,
    setup_provisioning_error_code = left(
      coalesce(nullif(btrim(p_error_code), ''), 'authorization_setup_failed'),
      100
    )
  where a.id = p_authorization_id
    and a.setup_provisioning_status = 'creating'
    and a.setup_lease_token = p_lease_token
    and a.setup_lease_expires_at > timezone('utc', now())
  returning * into v_row;
  if not found then
    raise exception 'authorization_setup_lease_lost' using errcode = 'P0002';
  end if;

  insert into public.audit_log (
    prestataire_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    v_row.prestataire_id,
    'system',
    'PAYMENT_AUTHORIZATION_SETUP_PROVISIONING_FAILED',
    'payment_authorization',
    v_row.id,
    jsonb_build_object(
      'retryable', p_retryable,
      'error_code', v_row.setup_provisioning_error_code,
      'attempt', v_row.setup_provisioning_attempts
    )
  );
  return v_row;
end;
$$;

-- Une Session ouverte ne doit jamais être réexposée si les capacités live du
-- compte ont changé depuis sa création. Après expiration confirmée chez Stripe,
-- cette primitive invalide l'opération et fait tourner les clés ; le prochain
-- claim créera une Session avec le nouvel ensemble exact de rails.
create or replace function public.invalidate_payment_authorization_setup_session(
  p_authorization_id uuid,
  p_stripe_setup_checkout_session_id text,
  p_reason text
)
returns public.payment_authorization
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.payment_authorization;
begin
  select a.* into v_row
  from public.payment_authorization a
  where a.id = p_authorization_id
  for update;
  if not found then
    raise exception 'payment_authorization_not_found' using errcode = 'P0002';
  end if;
  if v_row.etat <> 'EN_CONFIGURATION'
    or v_row.setup_provisioning_status <> 'created'
    or v_row.stripe_setup_checkout_session_id is distinct from
      nullif(btrim(p_stripe_setup_checkout_session_id), '')
  then
    raise exception 'authorization_setup_identity_mismatch' using errcode = '22023';
  end if;

  update public.payment_authorization a
  set
    stripe_setup_checkout_session_id = null,
    stripe_setup_intent_id = null,
    stripe_setup_session_expires_at = null,
    setup_operation_key = gen_random_uuid(),
    stripe_setup_idempotency_key =
      'sidian_setup_' || replace(gen_random_uuid()::text, '-', ''),
    setup_provisioning_status = 'failed_retryable',
    setup_provisioning_error_code = left(
      coalesce(nullif(btrim(p_reason), ''), 'setup_capabilities_changed'),
      100
    )
  where a.id = v_row.id
  returning * into v_row;

  insert into public.audit_log (
    prestataire_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    v_row.prestataire_id,
    'system',
    'PAYMENT_AUTHORIZATION_SETUP_INVALIDATED',
    'payment_authorization',
    v_row.id,
    jsonb_build_object(
      'reason', v_row.setup_provisioning_error_code,
      'expired_setup_checkout_session_id',
        nullif(btrim(p_stripe_setup_checkout_session_id), '')
    )
  );
  return v_row;
end;
$$;

create or replace function public.decline_payment_authorization_proposal(
  p_public_token_hash text,
  p_source_checkout_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.payment_authorization;
begin
  select a.* into v_row
  from public.payment_authorization a
  join public.tentative_paiement t on t.id = a.source_tentative_paiement_id
  where a.public_token_hash = p_public_token_hash
    and t.stripe_checkout_session_id = nullif(btrim(p_source_checkout_session_id), '')
  for update of a;
  if not found then
    return jsonb_build_object('declined', false, 'reason', 'not_found');
  end if;
  if v_row.public_token_expires_at <= timezone('utc', now()) then
    return jsonb_build_object('declined', false, 'reason', 'expired');
  end if;
  if v_row.etat = 'REFUSEE' then
    return jsonb_build_object('declined', true, 'replayed', true);
  end if;
  if v_row.etat <> 'PROPOSEE' then
    return jsonb_build_object('declined', false, 'reason', 'not_proposed');
  end if;

  update public.payment_authorization
  set etat = 'REFUSEE', is_default = false
  where id = v_row.id;
  insert into public.audit_log (
    prestataire_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    v_row.prestataire_id,
    'human',
    'PAYMENT_AUTHORIZATION_DECLINED',
    'payment_authorization',
    v_row.id,
    jsonb_build_object('channel', 'public_checkout_return')
  );
  return jsonb_build_object('declined', true, 'replayed', false);
end;
$$;

-- Option discrète permanente après un refus. Chaque changement d'avis crée
-- une nouvelle ligne PROPOSEE : la ligne REFUSEE et son historique restent
-- immuables. La lecture de contexte reste strictement interne.
create or replace function public.resolve_authorization_reconsideration_context(
  p_payment_link_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row record;
begin
  if p_payment_link_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('found', false);
  end if;
  select
    a.id as authorization_id,
    a.stripe_account_id,
    a.stripe_customer_id,
    a.authorization_text_version,
    a.prestataire_id,
    a.client_payeur_id,
    t.stripe_checkout_session_id as source_checkout_session_id
  into v_row
  from public.payment_link pl
  join public.creance c on c.id = pl.creance_id
  join public.payment_authorization a
    on a.prestataire_id = c.prestataire_id
   and a.client_payeur_id = c.client_payeur_id
   and a.etat = 'REFUSEE'
   and a.proposal_neutralized_at is null
  join public.tentative_paiement t
    on t.id = a.source_tentative_paiement_id
   and t.stripe_checkout_session_id is not null
  join public.prestataire p
    on p.id = a.prestataire_id
   and p.stripe_account_id = a.stripe_account_id
  join public.stripe_customer_binding b
    on b.prestataire_id = a.prestataire_id
   and b.client_payeur_id = a.client_payeur_id
   and b.stripe_account_id = a.stripe_account_id
   and b.stripe_customer_id = a.stripe_customer_id
   and b.status = 'active'
  where pl.token_hash = p_payment_link_token_hash
    and pl.status = 'active'
    and not exists (
      select 1
      from public.payment_authorization active_authorization
      where active_authorization.prestataire_id = a.prestataire_id
        and active_authorization.client_payeur_id = a.client_payeur_id
        and active_authorization.proposal_neutralized_at is null
        and active_authorization.etat in (
          'PROPOSEE', 'EN_CONFIGURATION', 'ACTIVE', 'SUSPENDUE'
        )
    )
    and not exists (
      select 1
      from public.payment_authorization child_authorization
      where child_authorization.reconsidered_from_authorization_id = a.id
    )
  order by a.created_at desc, a.id desc
  limit 1;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object(
    'found', true,
    'authorization_id', v_row.authorization_id,
    'stripe_account_id', v_row.stripe_account_id,
    'stripe_customer_id', v_row.stripe_customer_id,
    'authorization_text_version', v_row.authorization_text_version,
    'prestataire_id', v_row.prestataire_id,
    'client_payeur_id', v_row.client_payeur_id,
    'source_checkout_session_id', v_row.source_checkout_session_id
  );
end;
$$;

create or replace function public.prepare_reconsidered_authorization_proposal(
  p_payment_link_token_hash text,
  p_refused_authorization_id uuid,
  p_stripe_account_id text,
  p_stripe_customer_id text,
  p_public_token_hash text,
  p_public_token_expires_at timestamptz,
  p_authorization_text_version text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_link public.payment_link;
  v_creance public.creance;
  v_refused public.payment_authorization;
  v_created public.payment_authorization;
  v_source_session_id text;
  v_now timestamptz := timezone('utc', now());
begin
  if p_payment_link_token_hash !~ '^[0-9a-f]{64}$'
    or p_public_token_hash !~ '^[0-9a-f]{64}$'
    or p_public_token_expires_at <= v_now + interval '15 minutes'
    or p_public_token_expires_at > v_now + interval '30 days'
    or nullif(btrim(p_authorization_text_version), '') is null
  then
    raise exception 'payment_authorization_proposal_invalid' using errcode = '22023';
  end if;

  select pl.* into v_link
  from public.payment_link pl
  where pl.token_hash = p_payment_link_token_hash
    and pl.status = 'active';
  if not found then
    raise exception 'payment_link_not_active' using errcode = 'P0002';
  end if;
  select c.* into v_creance
  from public.creance c
  where c.id = v_link.creance_id
  for update;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_creance.prestataire_id::text || ':' || v_creance.client_payeur_id::text,
      0
    )
  );
  select a.*
    into v_refused
  from public.payment_authorization a
  join public.tentative_paiement t on t.id = a.source_tentative_paiement_id
  where a.id = p_refused_authorization_id
    and a.prestataire_id = v_creance.prestataire_id
    and a.client_payeur_id = v_creance.client_payeur_id
    and a.etat = 'REFUSEE'
    and a.proposal_neutralized_at is null
    and t.stripe_checkout_session_id is not null
  order by a.created_at desc
  limit 1
  for update of a;
  if not found then
    raise exception 'payment_authorization_reconsideration_unavailable'
      using errcode = 'P0002';
  end if;
  select t.stripe_checkout_session_id
    into v_source_session_id
  from public.tentative_paiement t
  where t.id = v_refused.source_tentative_paiement_id;
  if v_refused.stripe_account_id is distinct from nullif(btrim(p_stripe_account_id), '')
    or v_refused.stripe_customer_id is distinct from nullif(btrim(p_stripe_customer_id), '')
    or v_refused.authorization_text_version is distinct from
      nullif(btrim(p_authorization_text_version), '')
    or not exists (
      select 1 from public.prestataire p
      where p.id = v_refused.prestataire_id
        and p.stripe_account_id = v_refused.stripe_account_id
    )
    or not exists (
      select 1 from public.stripe_customer_binding b
      where b.prestataire_id = v_refused.prestataire_id
        and b.client_payeur_id = v_refused.client_payeur_id
        and b.stripe_account_id = v_refused.stripe_account_id
        and b.stripe_customer_id = v_refused.stripe_customer_id
        and b.status = 'active'
    )
  then
    raise exception 'payment_authorization_scope_mismatch' using errcode = '22023';
  end if;
  -- Le lock relationnel sérialise les doubles clics. Un retry du même cycle
  -- retrouve exclusivement l'enfant déjà créé et exige la même identité.
  select a.* into v_created
  from public.payment_authorization a
  where a.reconsidered_from_authorization_id = v_refused.id
  for update;
  if found then
    if v_created.etat <> 'PROPOSEE'
      or v_created.public_token_hash is distinct from p_public_token_hash
      or v_created.stripe_account_id is distinct from v_refused.stripe_account_id
      or v_created.stripe_customer_id is distinct from v_refused.stripe_customer_id
      or v_created.authorization_text_version is distinct from
        nullif(btrim(p_authorization_text_version), '')
    then
      raise exception 'payment_authorization_proposal_identity_mismatch'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'status', 'proposed',
      'authorization_id', v_created.id,
      'source_checkout_session_id', v_source_session_id,
      'replayed', true
    );
  end if;

  if exists (
    select 1
    from public.payment_authorization a
    where a.prestataire_id = v_refused.prestataire_id
      and a.client_payeur_id = v_refused.client_payeur_id
      and a.proposal_neutralized_at is null
      and a.etat in ('PROPOSEE', 'EN_CONFIGURATION', 'ACTIVE', 'SUSPENDUE')
  ) then
    raise exception 'payment_authorization_reconsideration_unavailable'
      using errcode = 'P0002';
  end if;
  if v_refused.accepted_at is not null
    or v_refused.stripe_setup_checkout_session_id is not null
    or v_refused.stripe_setup_intent_id is not null
  then
    raise exception 'payment_authorization_reconsideration_unsafe'
      using errcode = '22023';
  end if;

  insert into public.payment_authorization (
    client_payeur_id,
    prestataire_id,
    etat,
    is_default,
    source_tentative_paiement_id,
    reconsidered_from_authorization_id,
    public_token_hash,
    public_token_expires_at,
    stripe_account_id,
    stripe_customer_id,
    authorization_text_version,
    setup_operation_key,
    stripe_setup_idempotency_key
  ) values (
    v_refused.client_payeur_id,
    v_refused.prestataire_id,
    'PROPOSEE',
    false,
    v_refused.source_tentative_paiement_id,
    v_refused.id,
    p_public_token_hash,
    p_public_token_expires_at,
    v_refused.stripe_account_id,
    v_refused.stripe_customer_id,
    nullif(btrim(p_authorization_text_version), ''),
    gen_random_uuid(),
    'sidian_setup_' || replace(gen_random_uuid()::text, '-', '')
  )
  returning * into v_created;

  insert into public.audit_log (
    prestataire_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    v_created.prestataire_id,
    'human',
    'PAYMENT_AUTHORIZATION_RECONSIDERED',
    'payment_authorization',
    v_created.id,
    jsonb_build_object(
      'channel', 'public_payment_link',
      'previous_authorization_id', v_refused.id,
      'authorization_text_version', v_created.authorization_text_version,
      'token_expires_at', v_created.public_token_expires_at
    )
  );
  return jsonb_build_object(
    'status', 'proposed',
    'authorization_id', v_created.id,
    'source_checkout_session_id', v_source_session_id,
    'replayed', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Effets webhook setup fencés, transactionnels et idempotents
-- ---------------------------------------------------------------------------

create or replace function public.resolve_setup_authorization(
  p_setup_intent_id text,
  p_authorization_id uuid,
  p_connected_account_id text,
  p_customer_id text,
  p_authorization_text_version text
)
returns public.payment_authorization
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_by_intent public.payment_authorization;
  v_by_metadata public.payment_authorization;
begin
  if nullif(btrim(p_setup_intent_id), '') is null
    or p_authorization_id is null
    or nullif(btrim(p_authorization_text_version), '') is null
  then
    raise exception 'setup_authorization_object_invalid' using errcode = '22023';
  end if;

  select a.* into v_by_intent
  from public.payment_authorization a
  join public.prestataire p on p.id = a.prestataire_id
  where a.stripe_setup_intent_id = nullif(btrim(p_setup_intent_id), '')
    and a.stripe_account_id = nullif(btrim(p_connected_account_id), '')
    and p.stripe_account_id = nullif(btrim(p_connected_account_id), '')
    and a.stripe_customer_id = nullif(btrim(p_customer_id), '');

  select a.* into v_by_metadata
  from public.payment_authorization a
  join public.prestataire p on p.id = a.prestataire_id
  where a.id = p_authorization_id
    and a.stripe_account_id = nullif(btrim(p_connected_account_id), '')
    and p.stripe_account_id = nullif(btrim(p_connected_account_id), '')
    and a.stripe_customer_id = nullif(btrim(p_customer_id), '');

  if v_by_intent.id is null or v_by_metadata.id is null then
    raise exception 'setup_authorization_unresolved' using errcode = 'P0002';
  end if;
  if v_by_intent.id <> v_by_metadata.id
    or v_by_metadata.stripe_setup_intent_id is distinct from
      nullif(btrim(p_setup_intent_id), '')
    or v_by_metadata.authorization_text_version is distinct from
      nullif(btrim(p_authorization_text_version), '')
    or v_by_metadata.etat <> 'EN_CONFIGURATION'
    or v_by_metadata.setup_provisioning_status <> 'created'
    or v_by_metadata.stripe_setup_checkout_session_id is null
  then
    raise exception 'setup_authorization_object_mismatch' using errcode = '22023';
  end if;
  return v_by_metadata;
end;
$$;

revoke all on function public.resolve_setup_authorization(text, uuid, text, text, text)
  from public, anon, authenticated, service_role;

create or replace function public.apply_checkout_session_completed_setup(
  p_stripe_event_id text,
  p_processing_attempt integer,
  p_lease_token uuid,
  p_connected_account_id text,
  p_checkout_session_id text,
  p_setup_intent_id text,
  p_customer_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.payment_authorization;
  v_effect_new boolean;
begin
  perform public.assert_stripe_webhook_lease(
    p_stripe_event_id, p_processing_attempt, p_lease_token,
    'checkout.session.completed', p_connected_account_id
  );

  select a.* into v_row
  from public.payment_authorization a
  join public.prestataire p on p.id = a.prestataire_id
  where a.stripe_setup_checkout_session_id =
      nullif(btrim(p_checkout_session_id), '')
    and a.stripe_account_id = nullif(btrim(p_connected_account_id), '')
    and p.stripe_account_id = nullif(btrim(p_connected_account_id), '')
  for update of a;
  if not found then
    raise exception 'setup_authorization_unresolved' using errcode = 'P0002';
  end if;
  if v_row.stripe_customer_id is distinct from nullif(btrim(p_customer_id), '')
    or (
      v_row.stripe_setup_intent_id is not null
      and v_row.stripe_setup_intent_id is distinct from
        nullif(btrim(p_setup_intent_id), '')
    )
  then
    raise exception 'setup_authorization_object_mismatch' using errcode = '22023';
  end if;

  insert into public.stripe_webhook_effect (
    stripe_event_id, stripe_object_id, effect_type
  ) values (
    p_stripe_event_id, p_checkout_session_id, 'checkout.session.completed.setup'
  ) on conflict do nothing;
  v_effect_new := found;
  if not v_effect_new then
    return jsonb_build_object('applied', false, 'reason', 'already_applied');
  end if;

  update public.payment_authorization a
  set stripe_setup_intent_id = coalesce(
    a.stripe_setup_intent_id,
    nullif(btrim(p_setup_intent_id), '')
  )
  where a.id = v_row.id
  returning * into v_row;

  insert into public.audit_log (
    prestataire_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    v_row.prestataire_id,
    'external_integration',
    'PAYMENT_AUTHORIZATION_SETUP_COMPLETED',
    'payment_authorization',
    v_row.id,
    jsonb_build_object(
      'stripe_event_id', p_stripe_event_id,
      'setup_checkout_session_id', p_checkout_session_id,
      'setup_intent_id', v_row.stripe_setup_intent_id
    )
  );
  return jsonb_build_object('applied', true, 'authorization_id', v_row.id);
end;
$$;

create or replace function public.apply_checkout_session_expired_setup(
  p_stripe_event_id text,
  p_processing_attempt integer,
  p_lease_token uuid,
  p_connected_account_id text,
  p_checkout_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.payment_authorization;
  v_effect_new boolean;
begin
  perform public.assert_stripe_webhook_lease(
    p_stripe_event_id, p_processing_attempt, p_lease_token,
    'checkout.session.expired', p_connected_account_id
  );
  select a.* into v_row
  from public.payment_authorization a
  join public.prestataire p on p.id = a.prestataire_id
  where a.stripe_setup_checkout_session_id =
      nullif(btrim(p_checkout_session_id), '')
    and a.stripe_account_id = nullif(btrim(p_connected_account_id), '')
    and p.stripe_account_id = nullif(btrim(p_connected_account_id), '')
  for update of a;
  if not found then
    raise exception 'setup_authorization_unresolved' using errcode = 'P0002';
  end if;

  insert into public.stripe_webhook_effect (
    stripe_event_id, stripe_object_id, effect_type
  ) values (
    p_stripe_event_id, p_checkout_session_id, 'checkout.session.expired.setup'
  ) on conflict do nothing;
  v_effect_new := found;
  if not v_effect_new then
    return jsonb_build_object('applied', false, 'reason', 'already_applied');
  end if;

  update public.payment_authorization a
  set
    etat = 'EXPIREE',
    is_default = false,
    resume_as_default = false,
    suspension_reason = null
  where a.id = v_row.id
    and a.etat = 'EN_CONFIGURATION';
  insert into public.audit_log (
    prestataire_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    v_row.prestataire_id,
    'external_integration',
    'PAYMENT_AUTHORIZATION_SETUP_EXPIRED',
    'payment_authorization',
    v_row.id,
    jsonb_build_object(
      'stripe_event_id', p_stripe_event_id,
      'setup_checkout_session_id', p_checkout_session_id
    )
  );
  return jsonb_build_object('applied', true, 'authorization_id', v_row.id);
end;
$$;

create or replace function public.apply_setup_intent_succeeded_authorization(
  p_stripe_event_id text,
  p_processing_attempt integer,
  p_lease_token uuid,
  p_connected_account_id text,
  p_setup_intent_id text,
  p_authorization_id uuid,
  p_authorization_text_version text,
  p_customer_id text,
  p_payment_method_id text,
  p_payment_method_type text,
  p_mandate_id text,
  p_mandate_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.payment_authorization;
  v_effect_new boolean;
  v_type public.payment_authorization_type;
begin
  perform public.assert_stripe_webhook_lease(
    p_stripe_event_id, p_processing_attempt, p_lease_token,
    'setup_intent.succeeded', p_connected_account_id
  );
  if nullif(btrim(p_setup_intent_id), '') is null
    or nullif(btrim(p_payment_method_id), '') is null
  then
    raise exception 'setup_authorization_object_invalid' using errcode = '22023';
  end if;
  if p_payment_method_type = 'card' then
    v_type := 'card_off_session';
  elsif p_payment_method_type = 'sepa_debit' then
    v_type := 'sepa_core_mandate';
    if nullif(btrim(p_mandate_id), '') is null
      or p_mandate_status is distinct from 'active'
    then
      raise exception 'setup_authorization_mandate_invalid' using errcode = '22023';
    end if;
  else
    raise exception 'setup_authorization_rail_invalid' using errcode = '22023';
  end if;

  insert into public.stripe_webhook_effect (
    stripe_event_id, stripe_object_id, effect_type
  ) values (
    p_stripe_event_id, p_setup_intent_id, 'setup_intent.succeeded.authorization'
  ) on conflict do nothing;
  v_effect_new := found;
  if not v_effect_new then
    return jsonb_build_object('applied', false, 'reason', 'already_applied');
  end if;

  v_row := public.resolve_setup_authorization(
    p_setup_intent_id,
    p_authorization_id,
    p_connected_account_id,
    p_customer_id,
    p_authorization_text_version
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_row.prestataire_id::text || ':' || v_row.client_payeur_id::text,
      0
    )
  );
  perform 1
  from public.payment_authorization a
  where a.prestataire_id = v_row.prestataire_id
    and a.client_payeur_id = v_row.client_payeur_id
  order by a.id
  for update;

  select a.* into v_row
  from public.payment_authorization a
  where a.id = v_row.id;
  if v_row.etat <> 'EN_CONFIGURATION'
    or v_row.legacy_incomplete is not false
    or v_row.setup_provisioning_status <> 'created'
    or v_row.stripe_setup_checkout_session_id is null
    or v_row.authorization_text_version is distinct from
      nullif(btrim(p_authorization_text_version), '')
  then
    raise exception 'payment_authorization_not_configurable' using errcode = '22023';
  end if;

  update public.payment_authorization a
  set is_default = false
  where a.prestataire_id = v_row.prestataire_id
    and a.client_payeur_id = v_row.client_payeur_id
    and a.id <> v_row.id
    and a.is_default = true;

  update public.payment_authorization a
  set
    type = v_type,
    stripe_setup_intent_id = nullif(btrim(p_setup_intent_id), ''),
    stripe_payment_method_id = nullif(btrim(p_payment_method_id), ''),
    stripe_mandate_id = case
      when v_type = 'sepa_core_mandate' then nullif(btrim(p_mandate_id), '')
      else null
    end,
    stripe_mandate_status = case
      when v_type = 'sepa_core_mandate' then p_mandate_status
      else null
    end,
    etat = 'ACTIVE',
    is_default = true,
    legacy_incomplete = false,
    authorized_at = coalesce(a.authorized_at, timezone('utc', now())),
    revoked_at = null,
    resume_as_default = false,
    suspension_reason = null,
    setup_provisioning_error_code = null
  where a.id = v_row.id
  returning * into v_row;

  insert into public.audit_log (
    prestataire_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    v_row.prestataire_id,
    'external_integration',
    'PAYMENT_AUTHORIZATION_ACTIVATED',
    'payment_authorization',
    v_row.id,
    jsonb_build_object(
      'stripe_event_id', p_stripe_event_id,
      'setup_intent_id', p_setup_intent_id,
      'payment_method_type', p_payment_method_type,
      'authorization_text_version', v_row.authorization_text_version,
      'authorization_channel', v_row.authorization_channel
    )
  );
  return jsonb_build_object(
    'applied', true,
    'authorization_id', v_row.id,
    'state', v_row.etat,
    'is_default', v_row.is_default
  );
end;
$$;

create or replace function public.apply_setup_intent_failed_authorization(
  p_stripe_event_id text,
  p_processing_attempt integer,
  p_lease_token uuid,
  p_connected_account_id text,
  p_setup_intent_id text,
  p_authorization_id uuid,
  p_authorization_text_version text,
  p_customer_id text,
  p_failure_code text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.payment_authorization;
  v_effect_new boolean;
begin
  perform public.assert_stripe_webhook_lease(
    p_stripe_event_id, p_processing_attempt, p_lease_token,
    'setup_intent.setup_failed', p_connected_account_id
  );
  v_row := public.resolve_setup_authorization(
    p_setup_intent_id,
    p_authorization_id,
    p_connected_account_id,
    p_customer_id,
    p_authorization_text_version
  );

  insert into public.stripe_webhook_effect (
    stripe_event_id, stripe_object_id, effect_type
  ) values (
    p_stripe_event_id, p_setup_intent_id, 'setup_intent.failed.authorization'
  ) on conflict do nothing;
  v_effect_new := found;
  if not v_effect_new then
    return jsonb_build_object('applied', false, 'reason', 'already_applied');
  end if;

  update public.payment_authorization a
  set
    stripe_setup_intent_id = coalesce(
      a.stripe_setup_intent_id,
      nullif(btrim(p_setup_intent_id), '')
    ),
    setup_provisioning_error_code = left(
      coalesce(nullif(btrim(p_failure_code), ''), 'setup_failed'),
      100
    )
  where a.id = v_row.id
  returning * into v_row;

  insert into public.audit_log (
    prestataire_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    v_row.prestataire_id,
    'external_integration',
    'PAYMENT_AUTHORIZATION_SETUP_FAILED',
    'payment_authorization',
    v_row.id,
    jsonb_build_object(
      'stripe_event_id', p_stripe_event_id,
      'setup_intent_id', p_setup_intent_id,
      'error_code', v_row.setup_provisioning_error_code
    )
  );
  return jsonb_build_object('applied', true, 'authorization_id', v_row.id);
end;
$$;

create or replace function public.apply_payment_method_detached_authorization(
  p_stripe_event_id text,
  p_processing_attempt integer,
  p_lease_token uuid,
  p_connected_account_id text,
  p_payment_method_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_effect_new boolean;
  v_count integer := 0;
  v_row record;
  v_locked public.payment_authorization;
begin
  perform public.assert_stripe_webhook_lease(
    p_stripe_event_id, p_processing_attempt, p_lease_token,
    'payment_method.detached', p_connected_account_id
  );
  if not exists (
    select 1 from public.prestataire p
    where p.stripe_account_id = nullif(btrim(p_connected_account_id), '')
  ) then
    raise exception 'stripe_account_scope_mismatch' using errcode = '22023';
  end if;

  insert into public.stripe_webhook_effect (
    stripe_event_id, stripe_object_id, effect_type
  ) values (
    p_stripe_event_id, p_payment_method_id, 'payment_method.detached.authorization'
  ) on conflict do nothing;
  v_effect_new := found;
  if not v_effect_new then
    return jsonb_build_object('applied', false, 'reason', 'already_applied');
  end if;

  for v_row in
    select a.id, a.prestataire_id, a.client_payeur_id
    from public.payment_authorization a
    where a.stripe_account_id = nullif(btrim(p_connected_account_id), '')
      and a.stripe_payment_method_id = nullif(btrim(p_payment_method_id), '')
      and a.etat = 'ACTIVE'
    order by a.prestataire_id, a.client_payeur_id, a.id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        v_row.prestataire_id::text || ':' || v_row.client_payeur_id::text,
        0
      )
    );
    select a.* into v_locked
    from public.payment_authorization a
    where a.id = v_row.id
      and a.etat = 'ACTIVE'
    for update;
    if not found then
      continue;
    end if;
    update public.payment_authorization a
    set
      etat = 'SUSPENDUE',
      resume_as_default = a.resume_as_default or a.is_default,
      suspension_reason = 'payment_method_detached',
      is_default = false
    where a.id = v_row.id;
    insert into public.audit_log (
      prestataire_id, actor_type, action, entity_type, entity_id, metadata
    ) values (
      v_row.prestataire_id,
      'external_integration',
      'PAYMENT_AUTHORIZATION_SUSPENDED',
      'payment_authorization',
      v_row.id,
      jsonb_build_object(
        'stripe_event_id', p_stripe_event_id,
        'reason', 'payment_method_detached'
      )
    );
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('applied', true, 'authorization_count', v_count);
end;
$$;

create or replace function public.apply_mandate_updated_authorization(
  p_stripe_event_id text,
  p_processing_attempt integer,
  p_lease_token uuid,
  p_connected_account_id text,
  p_mandate_id text,
  p_mandate_status text,
  p_payment_method_id text,
  p_customer_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.payment_authorization;
  v_effect_new boolean;
  v_restore_default boolean;
begin
  perform public.assert_stripe_webhook_lease(
    p_stripe_event_id, p_processing_attempt, p_lease_token,
    'mandate.updated', p_connected_account_id
  );
  if p_mandate_status not in ('active', 'pending', 'inactive') then
    raise exception 'mandate_status_invalid' using errcode = '22023';
  end if;

  select a.* into v_row
  from public.payment_authorization a
  join public.prestataire p on p.id = a.prestataire_id
  where a.stripe_mandate_id = nullif(btrim(p_mandate_id), '')
    and a.stripe_payment_method_id = nullif(btrim(p_payment_method_id), '')
    and a.stripe_customer_id = nullif(btrim(p_customer_id), '')
    and a.stripe_account_id = nullif(btrim(p_connected_account_id), '')
    and p.stripe_account_id = nullif(btrim(p_connected_account_id), '');
  if not found then
    raise exception 'mandate_authorization_unresolved' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_row.prestataire_id::text || ':' || v_row.client_payeur_id::text,
      0
    )
  );

  select a.* into v_row
  from public.payment_authorization a
  join public.prestataire p on p.id = a.prestataire_id
  where a.id = v_row.id
    and a.stripe_mandate_id = nullif(btrim(p_mandate_id), '')
    and a.stripe_payment_method_id = nullif(btrim(p_payment_method_id), '')
    and a.stripe_customer_id = nullif(btrim(p_customer_id), '')
    and a.stripe_account_id = nullif(btrim(p_connected_account_id), '')
    and p.stripe_account_id = nullif(btrim(p_connected_account_id), '')
  for update of a;
  if not found then
    raise exception 'mandate_authorization_unresolved' using errcode = 'P0002';
  end if;

  insert into public.stripe_webhook_effect (
    stripe_event_id, stripe_object_id, effect_type
  ) values (
    p_stripe_event_id, p_mandate_id, 'mandate.updated.authorization'
  ) on conflict do nothing;
  v_effect_new := found;
  if not v_effect_new then
    return jsonb_build_object('applied', false, 'reason', 'already_applied');
  end if;

  if v_row.etat not in ('ACTIVE', 'SUSPENDUE') then
    return jsonb_build_object(
      'applied', true,
      'authorization_id', v_row.id,
      'state', v_row.etat,
      'is_default', v_row.is_default,
      'reason', 'authorization_state_terminal_noop'
    );
  end if;

  if p_mandate_status = 'inactive' then
    update public.payment_authorization a
    set
      stripe_mandate_status = 'inactive',
      etat = 'REVOQUEE',
      is_default = false,
      resume_as_default = false,
      suspension_reason = null,
      revoked_at = coalesce(a.revoked_at, timezone('utc', now()))
    where a.id = v_row.id
      and a.etat in ('ACTIVE', 'SUSPENDUE')
    returning * into v_row;
  elsif p_mandate_status = 'pending' then
    update public.payment_authorization a
    set
      stripe_mandate_status = 'pending',
      resume_as_default = a.resume_as_default or a.is_default,
      etat = 'SUSPENDUE',
      suspension_reason = case
        when a.suspension_reason = 'charge_dispute_created'
          then a.suspension_reason
        else 'mandate_pending'
      end,
      is_default = false
    where a.id = v_row.id
      and a.etat in ('ACTIVE', 'SUSPENDUE')
    returning * into v_row;
  else
    v_restore_default := v_row.resume_as_default and not exists (
      select 1 from public.payment_authorization a
      where a.prestataire_id = v_row.prestataire_id
        and a.client_payeur_id = v_row.client_payeur_id
        and a.id <> v_row.id
        and a.is_default = true
    );
    if v_row.legacy_incomplete
      or (
        v_row.etat = 'SUSPENDUE'
        and v_row.suspension_reason = 'charge_dispute_created'
      )
    then
      -- Les projections legacy restent non exploitables ; un litige en cours
      -- ne réactive jamais non plus une autorisation suspendue pour dispute.
      update public.payment_authorization a
      set stripe_mandate_status = 'active'
      where a.id = v_row.id
      returning * into v_row;
    else
      update public.payment_authorization a
      set
        stripe_mandate_status = 'active',
        etat = case when a.etat = 'SUSPENDUE' then 'ACTIVE' else a.etat end,
        is_default = case
          when a.etat = 'SUSPENDUE' then v_restore_default else a.is_default
        end,
        resume_as_default = false,
        suspension_reason = null
      where a.id = v_row.id
        and a.etat in ('ACTIVE', 'SUSPENDUE')
      returning * into v_row;
    end if;
  end if;

  insert into public.audit_log (
    prestataire_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    v_row.prestataire_id,
    'external_integration',
    case
      when p_mandate_status = 'inactive' then 'PAYMENT_AUTHORIZATION_REVOKED'
      when p_mandate_status = 'pending' then 'PAYMENT_AUTHORIZATION_SUSPENDED'
      else 'PAYMENT_AUTHORIZATION_MANDATE_VALIDATED'
    end,
    'payment_authorization',
    v_row.id,
    jsonb_build_object(
      'stripe_event_id', p_stripe_event_id,
      'reason', 'mandate_updated',
      'mandate_status', p_mandate_status
    )
  );
  return jsonb_build_object(
    'applied', true,
    'authorization_id', v_row.id,
    'state', v_row.etat,
    'is_default', v_row.is_default
  );
end;
$$;

-- Une dispute rattachée suspend uniquement l'autorisation issue de la
-- tentative litigieuse (ou explicitement utilisée par une tentative auto).
-- Aucun paiement, tentative, créance ou dossier n'est réécrit ici.
create or replace function public.suspend_payment_authorization_for_dispute(
  p_stripe_event_id text,
  p_processing_attempt integer,
  p_lease_token uuid,
  p_connected_account_id text,
  p_dispute_id text,
  p_payment_intent_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tentative public.tentative_paiement;
  v_creance public.creance;
  v_authorization public.payment_authorization;
  v_authorization_id uuid;
  v_effect_new boolean;
begin
  perform public.assert_stripe_webhook_lease(
    p_stripe_event_id, p_processing_attempt, p_lease_token,
    'charge.dispute.created', p_connected_account_id
  );
  if nullif(btrim(p_dispute_id), '') is null then
    raise exception 'stripe_dispute_object_invalid' using errcode = '22023';
  end if;

  insert into public.stripe_webhook_effect (
    stripe_event_id, stripe_object_id, effect_type
  ) values (
    p_stripe_event_id,
    p_dispute_id,
    'charge.dispute.created.authorization_suspend'
  ) on conflict do nothing;
  v_effect_new := found;
  if not v_effect_new then
    return jsonb_build_object('applied', false, 'reason', 'already_applied');
  end if;

  select t.* into v_tentative
  from public.tentative_paiement t
  where t.stripe_payment_intent_id = nullif(btrim(p_payment_intent_id), '');
  if not found then
    if not exists (
      select 1 from public.prestataire p
      where p.stripe_account_id = nullif(btrim(p_connected_account_id), '')
    ) then
      raise exception 'stripe_account_scope_mismatch' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'applied', true,
      'authorization_suspended', false,
      'reason', 'tentative_unresolved'
    );
  end if;

  select c.* into v_creance
  from public.creance c
  join public.prestataire p on p.id = c.prestataire_id
  where c.id = v_tentative.creance_id
    and p.stripe_account_id = nullif(btrim(p_connected_account_id), '');
  if not found then
    raise exception 'webhook_tentative_scope_mismatch';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_creance.prestataire_id::text || ':' ||
        v_creance.client_payeur_id::text,
      0
    )
  );

  -- Priorité à l'autorisation explicitement portée par une tentative auto ou
  -- issue de la tentative source, mais uniquement si elle est encore la
  -- valeur ACTIVE/default de la relation. Sinon, fallback strict sur l'unique
  -- ACTIVE/default courant de la relation client × prestataire.
  if v_tentative.payment_authorization_id is not null then
    select a.id into v_authorization_id
    from public.payment_authorization a
    where a.id = v_tentative.payment_authorization_id
      and a.prestataire_id = v_creance.prestataire_id
      and a.client_payeur_id = v_creance.client_payeur_id
      and a.etat = 'ACTIVE'
      and a.is_default = true;
  end if;
  if v_authorization_id is null then
    select a.id into v_authorization_id
    from public.payment_authorization a
    where a.source_tentative_paiement_id = v_tentative.id
      and a.prestataire_id = v_creance.prestataire_id
      and a.client_payeur_id = v_creance.client_payeur_id
      and a.etat = 'ACTIVE'
      and a.is_default = true
    order by a.created_at desc, a.id desc
    limit 1;
  end if;
  if v_authorization_id is null then
    select a.id into v_authorization_id
    from public.payment_authorization a
    where a.prestataire_id = v_creance.prestataire_id
      and a.client_payeur_id = v_creance.client_payeur_id
      and a.etat = 'ACTIVE'
      and a.is_default = true;
  end if;
  if v_authorization_id is null then
    return jsonb_build_object(
      'applied', true,
      'authorization_suspended', false,
      'reason', 'authorization_unresolved'
    );
  end if;

  select a.* into v_authorization
  from public.payment_authorization a
  where a.id = v_authorization_id
    and a.prestataire_id = v_creance.prestataire_id
    and a.client_payeur_id = v_creance.client_payeur_id
    and a.etat = 'ACTIVE'
    and a.is_default = true
  for update;
  if not found then
    return jsonb_build_object(
      'applied', true,
      'authorization_suspended', false,
      'reason', 'authorization_changed_concurrently'
    );
  end if;

  update public.payment_authorization a
  set
    etat = 'SUSPENDUE',
    resume_as_default = a.resume_as_default or a.is_default,
    is_default = false,
    suspension_reason = 'charge_dispute_created'
  where a.id = v_authorization.id
  returning * into v_authorization;

  insert into public.audit_log (
    prestataire_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    v_authorization.prestataire_id,
    'external_integration',
    'PAYMENT_AUTHORIZATION_SUSPENDED',
    'payment_authorization',
    v_authorization.id,
    jsonb_build_object(
      'stripe_event_id', p_stripe_event_id,
      'dispute_id', p_dispute_id,
      'stripe_payment_intent_id', nullif(btrim(p_payment_intent_id), ''),
      'tentative_id', v_tentative.id,
      'reason', 'charge_dispute_created'
    )
  );
  return jsonb_build_object(
    'applied', true,
    'authorization_id', v_authorization.id,
    'authorization_suspended', true
  );
end;
$$;

-- Wrapper transactionnel : la trace/approval de dispute (redéfinie de façon
-- additive par 210500) et la suspension ci-dessus réussissent ou échouent
-- ensemble. Chaque sous-effet garde sa propre clé idempotente.
create or replace function public.apply_charge_dispute_created_effects(
  p_stripe_event_id text,
  p_processing_attempt integer,
  p_lease_token uuid,
  p_connected_account_id text,
  p_dispute_id text,
  p_payment_intent_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_record jsonb;
  v_authorization jsonb;
begin
  v_record := public.record_charge_dispute_opened(
    p_stripe_event_id,
    p_processing_attempt,
    p_lease_token,
    p_connected_account_id,
    p_dispute_id,
    p_payment_intent_id,
    p_reason
  );
  v_authorization := public.suspend_payment_authorization_for_dispute(
    p_stripe_event_id,
    p_processing_attempt,
    p_lease_token,
    p_connected_account_id,
    p_dispute_id,
    p_payment_intent_id
  );
  return jsonb_build_object(
    'record', v_record,
    'authorization', v_authorization
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. ACL minimales — toutes les écritures restent serveur uniquement
-- ---------------------------------------------------------------------------

revoke all on function public.prepare_payment_authorization_proposal(
  uuid, text, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.prepare_payment_authorization_proposal(
  uuid, text, text, text, timestamptz, text
) to service_role;

revoke all on function public.neutralize_unexposed_authorization_proposal(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.neutralize_unexposed_authorization_proposal(
  uuid, uuid, text, text
) to service_role;

revoke all on function public.resolve_payment_authorization_public(
  text, text, text
) from public, anon, authenticated;
grant execute on function public.resolve_payment_authorization_public(
  text, text, text
) to service_role;

revoke all on function public.resolve_payment_authorization_setup_context(
  text, text
) from public, anon, authenticated;
grant execute on function public.resolve_payment_authorization_setup_context(
  text, text
) to service_role;

revoke all on function public.claim_payment_authorization_setup(
  text, text, text, text, text, integer
) from public, anon, authenticated;
grant execute on function public.claim_payment_authorization_setup(
  text, text, text, text, text, integer
) to service_role;

revoke all on function public.complete_payment_authorization_setup(
  uuid, uuid, text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_payment_authorization_setup(
  uuid, uuid, text, text, text, text, timestamptz
) to service_role;

revoke all on function public.fail_payment_authorization_setup(
  uuid, uuid, boolean, text
) from public, anon, authenticated;
grant execute on function public.fail_payment_authorization_setup(
  uuid, uuid, boolean, text
) to service_role;

revoke all on function public.invalidate_payment_authorization_setup_session(
  uuid, text, text
) from public, anon, authenticated;
grant execute on function public.invalidate_payment_authorization_setup_session(
  uuid, text, text
) to service_role;

revoke all on function public.decline_payment_authorization_proposal(text, text)
  from public, anon, authenticated;
grant execute on function public.decline_payment_authorization_proposal(text, text)
  to service_role;

revoke all on function public.resolve_authorization_reconsideration_context(text)
  from public, anon, authenticated;
grant execute on function public.resolve_authorization_reconsideration_context(text)
  to service_role;

revoke all on function public.prepare_reconsidered_authorization_proposal(
  text, uuid, text, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.prepare_reconsidered_authorization_proposal(
  text, uuid, text, text, text, timestamptz, text
) to service_role;

revoke all on function public.apply_checkout_session_completed_setup(
  text, integer, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.apply_checkout_session_completed_setup(
  text, integer, uuid, text, text, text, text
) to service_role;

revoke all on function public.apply_checkout_session_expired_setup(
  text, integer, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.apply_checkout_session_expired_setup(
  text, integer, uuid, text, text
) to service_role;

revoke all on function public.apply_setup_intent_succeeded_authorization(
  text, integer, uuid, text, text, uuid, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.apply_setup_intent_succeeded_authorization(
  text, integer, uuid, text, text, uuid, text, text, text, text, text, text
) to service_role;

revoke all on function public.apply_setup_intent_failed_authorization(
  text, integer, uuid, text, text, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.apply_setup_intent_failed_authorization(
  text, integer, uuid, text, text, uuid, text, text, text
) to service_role;

revoke all on function public.apply_payment_method_detached_authorization(
  text, integer, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.apply_payment_method_detached_authorization(
  text, integer, uuid, text, text
) to service_role;

revoke all on function public.apply_mandate_updated_authorization(
  text, integer, uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.apply_mandate_updated_authorization(
  text, integer, uuid, text, text, text, text, text
) to service_role;

revoke all on function public.suspend_payment_authorization_for_dispute(
  text, integer, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.suspend_payment_authorization_for_dispute(
  text, integer, uuid, text, text, text
) to service_role;

revoke all on function public.apply_charge_dispute_created_effects(
  text, integer, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.apply_charge_dispute_created_effects(
  text, integer, uuid, text, text, text, text
) to service_role;

-- Le rôle navigateur garde uniquement la lecture RLS préexistante sur
-- payment_authorization. Aucune table Stripe technique n'est rendue writable.
