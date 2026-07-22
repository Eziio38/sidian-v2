-- SID-PROD-004 — réconciliation Stripe live, sûre et auditable.
--
-- Cette migration ne crée aucun nouveau chemin financier autonome : une
-- observation Stripe live validée par le serveur est appliquée au moyen des
-- primitives financières webhook existantes, sous un lease explicitement
-- namespacé `reconciliation:*`. Les observations ambiguës sont dédupliquées
-- vers audit_log + approval_request et ne modifient ni paiement ni créance.

-- ---------------------------------------------------------------------------
-- 1. Registre privé des cas nécessitant une intervention humaine
-- ---------------------------------------------------------------------------

create table public.payment_reconciliation_issue (
  id uuid primary key default gen_random_uuid(),
  prestataire_id uuid not null
    references public.prestataire (id) on delete restrict,
  creance_id uuid not null
    references public.creance (id) on delete restrict,
  tentative_paiement_id uuid
    references public.tentative_paiement (id) on delete restrict,
  reconciliation_key text not null unique,
  reason text not null,
  approval_request_id uuid unique
    references public.approval_request (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  constraint payment_reconciliation_issue_key_ck check (
    reconciliation_key ~ '^[0-9a-f]{64}$'
  ),
  constraint payment_reconciliation_issue_reason_ck check (
    reason in (
      'account_identity_mismatch',
      'customer_identity_mismatch',
      'local_financial_state_mismatch',
      'payment_intent_identity_mismatch',
      'payment_intent_status_ambiguous',
      'session_identity_mismatch',
      'stripe_amount_mismatch',
      'stripe_currency_mismatch',
      'stripe_object_missing',
      'stripe_projection_mismatch',
      'too_many_attempts'
    )
  )
);

comment on table public.payment_reconciliation_issue is
  'Cas de réconciliation Stripe ambigus, sans effet financier automatique ; une ligne par empreinte d’observation.';

alter table public.payment_reconciliation_issue enable row level security;
revoke all on table public.payment_reconciliation_issue
  from public, anon, authenticated, service_role;
grant select on table public.payment_reconciliation_issue to service_role;

create or replace function public.enforce_payment_reconciliation_issue_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.creance c
    where c.id = new.creance_id
      and c.prestataire_id = new.prestataire_id
  ) then
    raise exception 'payment_reconciliation_scope_mismatch'
      using errcode = '23514';
  end if;

  if new.tentative_paiement_id is not null
    and not exists (
      select 1
      from public.tentative_paiement t
      where t.id = new.tentative_paiement_id
        and t.creance_id = new.creance_id
    )
  then
    raise exception 'payment_reconciliation_attempt_scope_mismatch'
      using errcode = '23514';
  end if;

  if new.approval_request_id is not null
    and not exists (
      select 1
      from public.approval_request ar
      where ar.id = new.approval_request_id
        and ar.prestataire_id = new.prestataire_id
        and ar.creance_id = new.creance_id
    )
  then
    raise exception 'payment_reconciliation_approval_scope_mismatch'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_payment_reconciliation_issue_scope()
  from public, anon, authenticated, service_role;

create trigger payment_reconciliation_issue_scope
before insert or update on public.payment_reconciliation_issue
for each row execute function public.enforce_payment_reconciliation_issue_scope();

-- ---------------------------------------------------------------------------
-- 2. Cas ambigu : garde-fou humain durable et idempotent
-- ---------------------------------------------------------------------------

create or replace function public.register_payment_reconciliation_human_required(
  p_requester_user_id uuid,
  p_creance_id uuid,
  p_tentative_id uuid,
  p_reconciliation_key text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_creance public.creance;
  v_tentative public.tentative_paiement;
  v_prestataire_id uuid;
  v_issue public.payment_reconciliation_issue;
  v_approval_id uuid;
begin
  if p_requester_user_id is null or p_creance_id is null then
    raise exception 'payment_reconciliation_scope_mismatch'
      using errcode = '22023';
  end if;
  if coalesce(p_reconciliation_key, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'payment_reconciliation_key_invalid'
      using errcode = '22023';
  end if;
  if p_reason is null or p_reason not in (
    'account_identity_mismatch',
    'customer_identity_mismatch',
    'local_financial_state_mismatch',
    'payment_intent_identity_mismatch',
    'payment_intent_status_ambiguous',
    'session_identity_mismatch',
    'stripe_amount_mismatch',
    'stripe_currency_mismatch',
    'stripe_object_missing',
    'stripe_projection_mismatch',
    'too_many_attempts'
  ) then
    raise exception 'payment_reconciliation_reason_invalid'
      using errcode = '22023';
  end if;

  -- Autorisation avant le premier verrou. L’identité vient de la session
  -- serveur, jamais du formulaire ; elle est revérifiée sous verrou ensuite.
  select p.id into v_prestataire_id
  from public.prestataire p
  join public.creance c on c.prestataire_id = p.id
  where p.user_id = p_requester_user_id
    and c.id = p_creance_id;
  if not found then
    raise exception 'payment_reconciliation_scope_mismatch'
      using errcode = '42501';
  end if;

  -- Ordre partagé des verrous financiers : créance, puis tentative.
  select c.* into v_creance
  from public.creance c
  where c.id = p_creance_id
    and c.prestataire_id = v_prestataire_id
  for update;
  if not found then
    raise exception 'payment_reconciliation_scope_mismatch'
      using errcode = '42501';
  end if;

  if p_tentative_id is not null then
    select t.* into v_tentative
    from public.tentative_paiement t
    where t.id = p_tentative_id
      and t.creance_id = v_creance.id
    for update;
    if not found then
      raise exception 'payment_reconciliation_attempt_scope_mismatch'
        using errcode = '42501';
    end if;
  end if;

  insert into public.payment_reconciliation_issue (
    prestataire_id,
    creance_id,
    tentative_paiement_id,
    reconciliation_key,
    reason
  )
  values (
    v_prestataire_id,
    v_creance.id,
    p_tentative_id,
    p_reconciliation_key,
    p_reason
  )
  on conflict (reconciliation_key) do nothing
  returning * into v_issue;

  if v_issue.id is null then
    select pri.* into v_issue
    from public.payment_reconciliation_issue pri
    where pri.reconciliation_key = p_reconciliation_key;

    if v_issue.prestataire_id is distinct from v_prestataire_id
      or v_issue.creance_id is distinct from v_creance.id
      or v_issue.tentative_paiement_id is distinct from p_tentative_id
      or v_issue.reason is distinct from p_reason
    then
      raise exception 'payment_reconciliation_key_collision'
        using errcode = '23505';
    end if;

    return jsonb_build_object(
      'outcome', 'human_required',
      'created', false
    );
  end if;

  insert into public.approval_request (
    prestataire_id,
    creance_id,
    type,
    requested_by_actor_type,
    payload,
    status
  )
  values (
    v_prestataire_id,
    v_creance.id,
    'autre',
    'system',
    jsonb_build_object(
      'reason', p_reason,
      'reconciliation_key', p_reconciliation_key,
      'source', 'stripe_live_reconciliation'
    ),
    'pending'
  )
  returning id into v_approval_id;

  update public.payment_reconciliation_issue pri
  set approval_request_id = v_approval_id
  where pri.id = v_issue.id;

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
    'system',
    'PAYMENT_RECONCILIATION_HUMAN_REQUIRED',
    'creance',
    v_creance.id,
    jsonb_build_object(
      'reason', p_reason,
      'reconciliation_key', p_reconciliation_key,
      'source', 'stripe_live_reconciliation'
    )
  );

  return jsonb_build_object(
    'outcome', 'human_required',
    'created', true
  );
end;
$$;

comment on function public.register_payment_reconciliation_human_required(
  uuid, uuid, uuid, text, text
) is
  'Enregistre une observation Stripe live ambiguë sans effet financier, avec audit et approval idempotents.';

revoke all on function public.register_payment_reconciliation_human_required(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.register_payment_reconciliation_human_required(
  uuid, uuid, uuid, text, text
) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Observation sûre : réutilisation des primitives financières fencées
-- ---------------------------------------------------------------------------

create or replace function public.apply_safe_eur_payment_reconciliation(
  p_requester_user_id uuid,
  p_creance_id uuid,
  p_tentative_id uuid,
  p_effect_type text,
  p_sidian_environment text,
  p_observation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_creance public.creance;
  v_tentative public.tentative_paiement;
  v_payment public.paiement;
  v_prestataire_id uuid;
  v_client_payeur_id uuid;
  v_account_id text;
  v_event_material text;
  v_event_hash text;
  v_event_id text;
  v_claim jsonb;
  v_attempt integer;
  v_lease_token uuid;
  v_effect jsonb;
  v_moyen public.tentative_paiement_moyen;
  v_amount_received bigint;
  v_already_current boolean := false;
begin
  if p_requester_user_id is null
    or p_creance_id is null
    or p_tentative_id is null
  then
    raise exception 'payment_reconciliation_scope_mismatch'
      using errcode = '22023';
  end if;
  if p_effect_type is null or p_effect_type not in (
    'checkout.session.completed',
    'payment_intent.processing',
    'payment_intent.succeeded'
  ) then
    raise exception 'payment_reconciliation_effect_invalid'
      using errcode = '22023';
  end if;
  if p_sidian_environment is null
    or p_sidian_environment not in ('local', 'staging', 'production')
  then
    raise exception 'payment_reconciliation_environment_invalid'
      using errcode = '22023';
  end if;
  if p_observation is null or jsonb_typeof(p_observation) <> 'object' then
    raise exception 'payment_reconciliation_observation_invalid'
      using errcode = '22023';
  end if;

  -- Contrôle de scope sans verrou, puis revérification sous verrou après le
  -- fence. Une autre organisation ne peut ni appliquer ni sonder un effet.
  select p.id into v_prestataire_id
  from public.prestataire p
  join public.creance c on c.prestataire_id = p.id
  where p.user_id = p_requester_user_id
    and c.id = p_creance_id;
  if not found then
    raise exception 'payment_reconciliation_scope_mismatch'
      using errcode = '42501';
  end if;

  -- Cet identifiant ne prétend pas être un evt_* Stripe. Il inclut la forme
  -- canonique jsonb de l’observation et ne peut donc pas collisionner avec un
  -- vrai webhook ou une observation différente.
  v_event_material := concat_ws(
    '|',
    'stripe_live_reconciliation_v1',
    p_effect_type,
    p_creance_id::text,
    p_tentative_id::text,
    p_sidian_environment,
    p_observation::text
  );
  v_event_hash := encode(
    extensions.digest(convert_to(v_event_material, 'UTF8'), 'sha256'),
    'hex'
  );
  v_event_id := 'reconciliation:'
    || replace(p_effect_type, '.', '_')
    || ':' || v_event_hash;

  v_claim := public.claim_stripe_webhook_event(
    v_event_id,
    p_effect_type,
    p_observation ->> 'account_id',
    60,
    8
  );

  if coalesce((v_claim ->> 'claimed')::boolean, false) is false then
    if coalesce((v_claim ->> 'terminal')::boolean, false) then
      return jsonb_build_object(
        'outcome', 'up_to_date',
        'effect_type', p_effect_type,
        'observation_source', 'stripe_live'
      );
    end if;
    return jsonb_build_object(
      'outcome', 'retry',
      'effect_type', p_effect_type,
      'observation_source', 'stripe_live'
    );
  end if;

  v_attempt := (v_claim ->> 'attempt')::integer;
  v_lease_token := (v_claim ->> 'lease_token')::uuid;

  -- Ordre de verrouillage identique aux primitives existantes : le fence
  -- d’événement est déjà acquis, puis créance → tentative → paiement.
  select c.* into v_creance
  from public.creance c
  where c.id = p_creance_id
    and c.prestataire_id = v_prestataire_id
  for update;
  if not found then
    raise exception 'payment_reconciliation_scope_mismatch'
      using errcode = '42501';
  end if;

  select c.client_payeur_id, p.stripe_account_id
  into v_client_payeur_id, v_account_id
  from public.creance c
  join public.prestataire p on p.id = c.prestataire_id
  where c.id = v_creance.id
    and p.user_id = p_requester_user_id;

  select t.* into v_tentative
  from public.tentative_paiement t
  where t.id = p_tentative_id
    and t.creance_id = v_creance.id
  for update;
  if not found then
    raise exception 'payment_reconciliation_attempt_scope_mismatch'
      using errcode = '42501';
  end if;

  if v_creance.devise is distinct from 'EUR'
    or lower(coalesce(p_observation ->> 'session_currency', '')) <> 'eur'
    or lower(coalesce(p_observation ->> 'payment_intent_currency', '')) <> 'eur'
  then
    raise exception 'payment_reconciliation_currency_mismatch'
      using errcode = '22023';
  end if;

  if nullif(btrim(v_account_id), '') is null
    or v_tentative.stripe_account_id is distinct from v_account_id
    or (p_observation ->> 'account_id') is distinct from v_account_id
    or (p_observation ->> 'account_metadata_prestataire_id')
      is distinct from v_prestataire_id::text
    or (p_observation ->> 'account_metadata_environment')
      is distinct from p_sidian_environment
  then
    raise exception 'payment_reconciliation_account_identity_mismatch'
      using errcode = '22023';
  end if;

  if v_tentative.source is distinct from 'lien_agent'
    or nullif(btrim(v_tentative.stripe_checkout_session_id), '') is null
    or (p_observation ->> 'session_id')
      is distinct from v_tentative.stripe_checkout_session_id
    or (p_observation ->> 'session_mode') is distinct from 'payment'
    or (p_observation ->> 'session_client_reference_id')
      is distinct from v_tentative.id::text
    or (p_observation ->> 'session_metadata_tentative_id')
      is distinct from v_tentative.id::text
    or (p_observation ->> 'session_metadata_creance_id')
      is distinct from v_creance.id::text
    or (p_observation ->> 'session_amount_total') is null
    or (p_observation ->> 'session_amount_total')::bigint
      is distinct from v_tentative.montant
  then
    raise exception 'payment_reconciliation_session_identity_mismatch'
      using errcode = '22023';
  end if;

  if nullif(btrim(p_observation ->> 'payment_intent_id'), '') is null
    or (p_observation ->> 'session_payment_intent_id')
      is distinct from (p_observation ->> 'payment_intent_id')
    or (v_tentative.stripe_payment_intent_id is not null
      and v_tentative.stripe_payment_intent_id
        is distinct from (p_observation ->> 'payment_intent_id'))
    or (p_observation ->> 'payment_intent_metadata_tentative_id')
      is distinct from v_tentative.id::text
    or (p_observation ->> 'payment_intent_metadata_creance_id')
      is distinct from v_creance.id::text
    or (p_observation ->> 'payment_intent_amount') is null
    or (p_observation ->> 'payment_intent_amount')::bigint
      is distinct from v_tentative.montant
    or (p_observation ->> 'payment_intent_application_fee_amount') is null
    or (p_observation ->> 'payment_intent_application_fee_amount')::bigint
      is distinct from coalesce(v_tentative.application_fee_amount, 0)
  then
    raise exception 'payment_reconciliation_payment_intent_identity_mismatch'
      using errcode = '22023';
  end if;

  if nullif(btrim(p_observation ->> 'customer_id'), '') is null
    or (p_observation ->> 'session_customer_id')
      is distinct from (p_observation ->> 'customer_id')
    or (p_observation ->> 'payment_intent_customer_id')
      is distinct from (p_observation ->> 'customer_id')
    or (v_tentative.stripe_customer_id is not null
      and v_tentative.stripe_customer_id
        is distinct from (p_observation ->> 'customer_id'))
    or coalesce((p_observation ->> 'customer_deleted')::boolean, true)
    or (p_observation ->> 'customer_metadata_prestataire_id')
      is distinct from v_prestataire_id::text
    or (p_observation ->> 'customer_metadata_client_payeur_id')
      is distinct from v_client_payeur_id::text
    or (p_observation ->> 'customer_metadata_environment')
      is distinct from p_sidian_environment
  then
    raise exception 'payment_reconciliation_customer_identity_mismatch'
      using errcode = '22023';
  end if;

  if (p_observation ->> 'moyen') = 'carte' then
    v_moyen := 'carte';
  elsif (p_observation ->> 'moyen') = 'sepa_core' then
    v_moyen := 'sepa_core';
  else
    raise exception 'payment_reconciliation_payment_method_ambiguous'
      using errcode = '22023';
  end if;
  if v_tentative.moyen is not null
    and v_tentative.moyen is distinct from v_moyen
  then
    raise exception 'payment_reconciliation_payment_method_mismatch'
      using errcode = '22023';
  end if;

  if p_effect_type = 'checkout.session.completed' then
    if (p_observation ->> 'session_status') is distinct from 'complete'
      or (p_observation ->> 'payment_intent_status') is null
      or (p_observation ->> 'payment_intent_status') not in ('processing', 'succeeded')
    then
      raise exception 'payment_reconciliation_status_ambiguous'
        using errcode = '22023';
    end if;

    v_already_current :=
      v_tentative.stripe_payment_intent_id
        is not distinct from (p_observation ->> 'payment_intent_id')
      and v_tentative.stripe_customer_id
        is not distinct from (p_observation ->> 'customer_id');

    if not v_already_current then
      v_effect := public.apply_checkout_session_completed_payment(
        v_event_id,
        v_attempt,
        v_lease_token,
        v_account_id,
        p_observation ->> 'session_id',
        p_observation ->> 'payment_intent_id',
        p_observation ->> 'customer_id'
      );
    end if;
  elsif p_effect_type = 'payment_intent.processing' then
    if (p_observation ->> 'session_status') is distinct from 'complete'
      or (p_observation ->> 'session_payment_status') is distinct from 'unpaid'
      or (p_observation ->> 'payment_intent_status') is distinct from 'processing'
      or v_tentative.etat not in (
        'CREEE', 'NECESSITE_ACTION_CLIENT', 'EN_TRAITEMENT'
      )
    then
      raise exception 'payment_reconciliation_status_ambiguous'
        using errcode = '22023';
    end if;

    v_already_current := v_tentative.etat = 'EN_TRAITEMENT';
    if not v_already_current then
      v_effect := public.apply_payment_intent_processing(
        v_event_id,
        v_attempt,
        v_lease_token,
        v_account_id,
        p_observation ->> 'payment_intent_id',
        v_tentative.id,
        v_moyen
      );
    end if;
  else
    v_amount_received := (p_observation ->> 'payment_intent_amount_received')::bigint;
    if (p_observation ->> 'session_status') is distinct from 'complete'
      or (p_observation ->> 'session_payment_status') is distinct from 'paid'
      or (p_observation ->> 'payment_intent_status') is distinct from 'succeeded'
      or v_amount_received is distinct from v_tentative.montant
    then
      raise exception 'payment_reconciliation_status_ambiguous'
        using errcode = '22023';
    end if;

    select pmt.* into v_payment
    from public.paiement pmt
    where pmt.tentative_paiement_id = v_tentative.id
    for update;

    if v_payment.id is not null
      and (
        v_payment.creance_id is distinct from v_creance.id
        or v_payment.montant is distinct from v_amount_received
        or v_payment.source is distinct from 'lien_agent'
      )
    then
      raise exception 'payment_reconciliation_local_payment_mismatch'
        using errcode = '22023';
    end if;

    v_already_current :=
      v_tentative.etat = 'REUSSIE' and v_payment.id is not null;
    if not v_already_current then
      v_effect := public.apply_eur_payment_intent_succeeded(
        v_event_id,
        v_attempt,
        v_lease_token,
        v_account_id,
        p_observation ->> 'payment_intent_id',
        v_tentative.id,
        v_amount_received,
        'eur',
        v_moyen
      );
    end if;
  end if;

  perform public.mark_stripe_webhook_event_status(
    v_event_id,
    v_lease_token,
    v_attempt,
    'processed'
  );

  if not v_already_current then
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
      'system',
      'PAYMENT_RECONCILIATION_REPAIR_APPLIED',
      'creance',
      v_creance.id,
      jsonb_build_object(
        'effect_type', p_effect_type,
        'observation_key', v_event_hash,
        'source', 'stripe_live_reconciliation'
      )
    );
  end if;

  return jsonb_build_object(
    'outcome', case when v_already_current then 'up_to_date' else 'repaired' end,
    'effect_type', p_effect_type,
    'observation_source', 'stripe_live'
  );
end;
$$;

comment on function public.apply_safe_eur_payment_reconciliation(
  uuid, uuid, uuid, text, text, jsonb
) is
  'Valide une observation Stripe live EUR puis réutilise une primitive financière existante sous un fence reconciliation:*.';

revoke all on function public.apply_safe_eur_payment_reconciliation(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_safe_eur_payment_reconciliation(
  uuid, uuid, uuid, text, text, jsonb
) to service_role;
