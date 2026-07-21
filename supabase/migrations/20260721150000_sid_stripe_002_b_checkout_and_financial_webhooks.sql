-- SID-STRIPE-002-B — provisioning Checkout transactionnel (claim/lease/reprise)
-- et effets financiers webhook fencés (paiement, recalcul créance, trop-perçu).
--
-- Périmètre : chemin Checkout de PAIEMENT uniquement.
-- Le chemin d'AUTORISATION future (Setup Session, payment_authorization,
-- prélèvement auto : setup_intent.*, mandate.updated, payment_method.detached,
-- branche setup de checkout.session.*) appartient à un lot ultérieur
-- (cf. docs/implementation/PHASE_5_STRIPE_CONNECT.md « Hors périmètre »).
--
-- Invariants réutilisés (jamais affaiblis) :
--   * fencing webhook par (event_id, lease_token, processing_attempts) + lease non expiré ;
--   * concordance de scope compte connecté (03 §5.2) ;
--   * registre d'effet unique stripe_webhook_effect — effet financier appliqué au plus une fois ;
--   * contraintes 002-A tentative_paiement (lease consistency, snapshots, unicités).

-- ---------------------------------------------------------------------------
-- 0. Garde de fencing partagée pour les effets financiers webhook
-- ---------------------------------------------------------------------------

-- Verrouille l'événement courant et refuse tout worker périmé / usurpé.
-- Le verrou FOR UPDATE persiste dans la transaction appelante jusqu'à commit.
create or replace function public.assert_stripe_webhook_lease(
  p_event_id text,
  p_processing_attempt integer,
  p_lease_token uuid,
  p_expected_type text,
  p_connected_account_id text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_event public.processed_webhook_event;
  v_now timestamptz := timezone('utc', now());
begin
  select e.* into v_event
  from public.processed_webhook_event e
  where e.id = p_event_id
  for update;

  if not found
    or v_event.processing_status is distinct from 'processing'
    or v_event.processing_attempts is distinct from p_processing_attempt
    or v_event.lease_token is distinct from p_lease_token
    or v_event.lease_expires_at is null
    or v_event.lease_expires_at <= v_now
    or v_event.type is distinct from p_expected_type
    or v_event.stripe_connected_account_id is distinct from
      nullif(btrim(p_connected_account_id), '')
  then
    raise exception 'webhook_lease_lost' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.assert_stripe_webhook_lease(
  text, integer, uuid, text, text
) from public, anon, authenticated, service_role;
-- Appelée uniquement par d'autres fonctions SECURITY DEFINER de ce schéma.

-- ---------------------------------------------------------------------------
-- 1. Provisioning transactionnel de la Session Checkout de paiement
-- ---------------------------------------------------------------------------

-- Claim exclusif par créance. Sérialise via l'index partiel unique 002-A
-- (une seule tentative non terminale par créance). Reprend un provisioning
-- au lease expiré ou en échec retryable en réutilisant les clés persistées,
-- afin que l'idempotency key Stripe renvoie la même Session (jamais de double).
create or replace function public.claim_checkout_provisioning(
  p_creance_id uuid,
  p_payment_link_id uuid,
  p_stripe_account_id text,
  p_operation_key uuid,
  p_idempotency_key text,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_creance public.creance;
  v_link public.payment_link;
  v_existing public.tentative_paiement;
  v_new public.tentative_paiement;
  v_now timestamptz := timezone('utc', now());
  v_paid bigint;
  v_remaining bigint;
  v_lease uuid;
begin
  if p_lease_seconds < 15 or p_lease_seconds > 600 then
    raise exception 'checkout_lease_invalid' using errcode = '22023';
  end if;
  if nullif(btrim(p_stripe_account_id), '') is null then
    raise exception 'stripe_account_id_required' using errcode = '22023';
  end if;
  if p_operation_key is null then
    raise exception 'checkout_operation_key_required' using errcode = '22023';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'checkout_idempotency_key_required' using errcode = '22023';
  end if;

  -- Verrou de la créance : sérialise le calcul du solde et l'ouverture d'une tentative.
  select c.* into v_creance
  from public.creance c
  where c.id = p_creance_id
  for update;
  if not found then
    raise exception 'creance_not_found' using errcode = 'P0002';
  end if;
  if v_creance.archived_at is not null then
    raise exception 'payment_receivable_archived' using errcode = '22023';
  end if;
  if v_creance.etat not in ('OUVERTE', 'PARTIELLEMENT_REGLEE') then
    raise exception 'payment_receivable_not_payable' using errcode = '22023';
  end if;

  -- Concordance de scope : le compte connecté attendu doit être celui du prestataire.
  perform 1
  from public.prestataire p
  where p.id = v_creance.prestataire_id
    and p.stripe_account_id = nullif(btrim(p_stripe_account_id), '');
  if not found then
    raise exception 'stripe_account_scope_mismatch' using errcode = '22023';
  end if;

  -- Lien de paiement : actif et rattaché à cette créance.
  select pl.* into v_link
  from public.payment_link pl
  where pl.id = p_payment_link_id
    and pl.creance_id = v_creance.id
    and pl.status = 'active'
  for update;
  if not found then
    raise exception 'payment_link_not_active' using errcode = 'P0002';
  end if;

  -- Solde restant sous verrou (gère les paiements partiels ; jamais de session à 0).
  select coalesce(sum(pmt.montant), 0) into v_paid
  from public.paiement pmt
  where pmt.creance_id = v_creance.id;
  v_remaining := v_creance.montant - v_paid;
  if v_remaining <= 0 then
    raise exception 'payment_receivable_already_settled' using errcode = '22023';
  end if;

  -- Tentative non terminale existante pour cette créance (index partiel 002-A).
  select t.* into v_existing
  from public.tentative_paiement t
  where t.creance_id = v_creance.id
    and t.etat in ('CREEE', 'NECESSITE_ACTION_CLIENT', 'EN_TRAITEMENT')
  for update;

  if found then
    -- Scope figé de la tentative : jamais un autre compte connecté.
    if v_existing.stripe_account_id is not null
      and v_existing.stripe_account_id is distinct from nullif(btrim(p_stripe_account_id), '')
    then
      raise exception 'stripe_account_scope_mismatch' using errcode = '22023';
    end if;

    -- Session déjà provisionnée et vivante : réutilisation idempotente.
    if v_existing.checkout_provisioning_status = 'created'
      and v_existing.stripe_checkout_session_id is not null
    then
      return jsonb_build_object(
        'status', 'already_created',
        'tentative_id', v_existing.id,
        'montant', v_existing.montant,
        'idempotency_key', v_existing.stripe_checkout_idempotency_key,
        'operation_key', v_existing.checkout_operation_key,
        'stripe_account_id', v_existing.stripe_account_id,
        'stripe_customer_id', v_existing.stripe_customer_id,
        'stripe_checkout_session_id', v_existing.stripe_checkout_session_id,
        'stripe_checkout_session_expires_at', v_existing.stripe_checkout_session_expires_at
      );
    end if;

    -- Provisioning en cours détenu par un worker actif : ne pas voler le lease.
    if v_existing.checkout_provisioning_status = 'creating'
      and v_existing.checkout_lease_expires_at is not null
      and v_existing.checkout_lease_expires_at > v_now
    then
      return jsonb_build_object(
        'status', 'in_progress',
        'tentative_id', v_existing.id,
        'lease_expires_at', v_existing.checkout_lease_expires_at
      );
    end if;

    -- Reprise après panne : lease expiré, échec retryable, ou creating orphelin.
    -- Réutilise operation_key + idempotency_key persistés (dédup Stripe).
    v_lease := gen_random_uuid();
    update public.tentative_paiement t
    set
      checkout_provisioning_status = 'creating',
      checkout_lease_token = v_lease,
      checkout_lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      checkout_provisioning_attempts = t.checkout_provisioning_attempts + 1,
      checkout_provisioning_error_code = null,
      montant = v_remaining
    where t.id = v_existing.id
    returning t.* into v_new;

    return jsonb_build_object(
      'status', 'reclaimed',
      'tentative_id', v_new.id,
      'montant', v_new.montant,
      'idempotency_key', v_new.stripe_checkout_idempotency_key,
      'operation_key', v_new.checkout_operation_key,
      'stripe_account_id', v_new.stripe_account_id,
      'stripe_customer_id', v_new.stripe_customer_id,
      'lease_token', v_new.checkout_lease_token,
      'lease_expires_at', v_new.checkout_lease_expires_at,
      'attempt', v_new.checkout_provisioning_attempts
    );
  end if;

  -- Aucune tentative non terminale : ouverture d'un nouveau provisioning.
  v_lease := gen_random_uuid();
  begin
    insert into public.tentative_paiement (
      creance_id,
      payment_link_id,
      montant,
      moyen,
      source,
      etat,
      checkout_operation_key,
      stripe_checkout_idempotency_key,
      checkout_provisioning_status,
      checkout_lease_token,
      checkout_lease_expires_at,
      checkout_provisioning_attempts,
      stripe_account_id
    )
    values (
      v_creance.id,
      v_link.id,
      v_remaining,
      null,
      'lien_agent',
      'CREEE',
      p_operation_key,
      p_idempotency_key,
      'creating',
      v_lease,
      v_now + make_interval(secs => p_lease_seconds),
      1,
      nullif(btrim(p_stripe_account_id), '')
    )
    returning * into v_new;
  exception when unique_violation then
    -- Course perdue : un autre appel a claim en premier. Renvoie l'état courant.
    return jsonb_build_object('status', 'in_progress', 'tentative_id', null);
  end;

  return jsonb_build_object(
    'status', 'claimed',
    'tentative_id', v_new.id,
    'montant', v_new.montant,
    'idempotency_key', v_new.stripe_checkout_idempotency_key,
    'operation_key', v_new.checkout_operation_key,
    'stripe_account_id', v_new.stripe_account_id,
    'stripe_customer_id', v_new.stripe_customer_id,
    'lease_token', v_new.checkout_lease_token,
    'lease_expires_at', v_new.checkout_lease_expires_at,
    'attempt', v_new.checkout_provisioning_attempts
  );
end;
$$;

comment on function public.claim_checkout_provisioning(
  uuid, uuid, text, uuid, text, integer
) is
  'Claim/lease/reprise exclusif du provisioning Checkout par créance. Réutilise l''idempotency key persistée après panne pour éviter toute Session dupliquée.';

revoke all on function public.claim_checkout_provisioning(
  uuid, uuid, text, uuid, text, integer
) from public, anon, authenticated;
grant execute on function public.claim_checkout_provisioning(
  uuid, uuid, text, uuid, text, integer
) to service_role;

-- Finalise le provisioning : Session Stripe créée, snapshots figés, lease libéré.
create or replace function public.complete_checkout_provisioning(
  p_tentative_id uuid,
  p_lease_token uuid,
  p_stripe_checkout_session_id text,
  p_stripe_payment_intent_id text,
  p_stripe_customer_id text,
  p_stripe_account_id text,
  p_session_expires_at timestamptz,
  p_application_fee_amount bigint
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
  if v_row.checkout_provisioning_status is distinct from 'creating'
    or v_row.checkout_lease_token is distinct from p_lease_token
    or v_row.checkout_lease_expires_at is null
    or v_row.checkout_lease_expires_at <= v_now
  then
    raise exception 'checkout_lease_lost' using errcode = 'P0002';
  end if;
  if v_row.stripe_account_id is distinct from nullif(btrim(p_stripe_account_id), '') then
    raise exception 'stripe_account_scope_mismatch' using errcode = '22023';
  end if;
  if nullif(btrim(p_stripe_checkout_session_id), '') is null then
    raise exception 'stripe_checkout_session_id_required' using errcode = '22023';
  end if;

  update public.tentative_paiement t
  set
    checkout_provisioning_status = 'created',
    checkout_lease_token = null,
    checkout_lease_expires_at = null,
    checkout_provisioning_error_code = null,
    stripe_checkout_session_id = nullif(btrim(p_stripe_checkout_session_id), ''),
    stripe_payment_intent_id = nullif(btrim(p_stripe_payment_intent_id), ''),
    stripe_customer_id = nullif(btrim(p_stripe_customer_id), ''),
    stripe_checkout_session_expires_at = p_session_expires_at,
    application_fee_amount = p_application_fee_amount
  where t.id = p_tentative_id
  returning t.* into v_row;

  return v_row;
end;
$$;

revoke all on function public.complete_checkout_provisioning(
  uuid, uuid, text, text, text, text, timestamptz, bigint
) from public, anon, authenticated;
grant execute on function public.complete_checkout_provisioning(
  uuid, uuid, text, text, text, text, timestamptz, bigint
) to service_role;

-- Marque l'échec du provisioning. Terminal → tentative ANNULEE (libère la créance).
create or replace function public.fail_checkout_provisioning(
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
  if v_row.checkout_provisioning_status is distinct from 'creating'
    or v_row.checkout_lease_token is distinct from p_lease_token
    or v_row.checkout_lease_expires_at is null
    or v_row.checkout_lease_expires_at <= v_now
  then
    raise exception 'checkout_lease_lost' using errcode = 'P0002';
  end if;

  update public.tentative_paiement t
  set
    checkout_provisioning_status =
      (case when p_retryable then 'failed_retryable' else 'failed_terminal' end)
        ::public.stripe_checkout_provisioning_status,
    checkout_lease_token = null,
    checkout_lease_expires_at = null,
    checkout_provisioning_error_code = left(nullif(btrim(p_error_code), ''), 100),
    etat = case when p_retryable then t.etat else 'ANNULEE' end
  where t.id = p_tentative_id
  returning t.* into v_row;

  return v_row;
end;
$$;

revoke all on function public.fail_checkout_provisioning(uuid, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.fail_checkout_provisioning(uuid, uuid, boolean, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. Recalcul déterministe de l'état de la créance (trop-perçu compris)
-- ---------------------------------------------------------------------------

-- Décision (non spécifiée explicitement, dérivée des invariants) :
--   * paiement.montant = montant réellement reçu (autoritatif Stripe) ;
--   * somme < dû  → PARTIELLEMENT_REGLEE ; somme ≥ dû → REGLEE (terminal §2.1) ;
--   * trop-perçu (somme > dû) : jamais de nouvel état ni de perte de fonds ;
--     créance REGLEE + trace audit + approval_request (depassement_seuil, §4) ;
--   * créance déjà terminale : ne jamais ressusciter — fonds enregistrés, garde-fou humain.
-- Suppose creance déjà verrouillée FOR UPDATE par l'appelant.
create or replace function public.recalculate_creance_settlement(
  p_creance_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_creance public.creance;
  v_paid bigint;
  v_now timestamptz := timezone('utc', now());
  v_target public.creance_etat;
  v_overpaid boolean := false;
begin
  select c.* into v_creance
  from public.creance c
  where c.id = p_creance_id
  for update;
  if not found then
    raise exception 'creance_not_found' using errcode = 'P0002';
  end if;

  select coalesce(sum(pmt.montant), 0) into v_paid
  from public.paiement pmt
  where pmt.creance_id = v_creance.id;

  v_overpaid := v_paid > v_creance.montant;

  -- Ne jamais surcharger un état terminal ou en litige : fonds enregistrés,
  -- décision laissée au garde-fou humain.
  if v_creance.etat not in ('OUVERTE', 'PARTIELLEMENT_REGLEE') then
    if v_paid > 0 then
      insert into public.audit_log (
        prestataire_id, actor_type, action, entity_type, entity_id, metadata
      )
      values (
        v_creance.prestataire_id, 'system', 'PAYMENT_ON_NON_OPEN_RECEIVABLE',
        'creance', v_creance.id,
        jsonb_build_object(
          'creance_state', v_creance.etat::text,
          'amount_due', v_creance.montant,
          'amount_paid', v_paid
        )
      );
      insert into public.approval_request (
        prestataire_id, creance_id, type, requested_by_actor_type, payload, status
      )
      values (
        v_creance.prestataire_id, v_creance.id, 'depassement_seuil', 'system',
        jsonb_build_object(
          'reason', 'payment_on_non_open_receivable',
          'creance_state', v_creance.etat::text,
          'amount_due', v_creance.montant,
          'amount_paid', v_paid
        ),
        'pending'
      );
    end if;
    return jsonb_build_object(
      'creance_state', v_creance.etat::text,
      'amount_due', v_creance.montant,
      'amount_paid', v_paid,
      'changed', false,
      'overpaid', v_overpaid
    );
  end if;

  if v_paid >= v_creance.montant then
    v_target := 'REGLEE';
  elsif v_paid > 0 then
    v_target := 'PARTIELLEMENT_REGLEE';
  else
    v_target := v_creance.etat;
  end if;

  if v_target is distinct from v_creance.etat then
    update public.creance c
    set etat = v_target, updated_at = v_now
    where c.id = v_creance.id;

    insert into public.audit_log (
      prestataire_id, actor_type, action, entity_type, entity_id, metadata
    )
    values (
      v_creance.prestataire_id, 'system', 'CREANCE_SETTLEMENT_RECALCULATED',
      'creance', v_creance.id,
      jsonb_build_object(
        'from_state', v_creance.etat::text,
        'to_state', v_target::text,
        'amount_due', v_creance.montant,
        'amount_paid', v_paid
      )
    );
  end if;

  if v_overpaid then
    insert into public.audit_log (
      prestataire_id, actor_type, action, entity_type, entity_id, metadata
    )
    values (
      v_creance.prestataire_id, 'system', 'PAYMENT_OVERPAYMENT_DETECTED',
      'creance', v_creance.id,
      jsonb_build_object(
        'amount_due', v_creance.montant,
        'amount_paid', v_paid,
        'excess', v_paid - v_creance.montant
      )
    );
    insert into public.approval_request (
      prestataire_id, creance_id, type, requested_by_actor_type, payload, status
    )
    values (
      v_creance.prestataire_id, v_creance.id, 'depassement_seuil', 'system',
      jsonb_build_object(
        'reason', 'overpayment',
        'amount_due', v_creance.montant,
        'amount_paid', v_paid,
        'excess', v_paid - v_creance.montant
      ),
      'pending'
    );
  end if;

  return jsonb_build_object(
    'creance_state', v_target::text,
    'amount_due', v_creance.montant,
    'amount_paid', v_paid,
    'changed', v_target is distinct from v_creance.etat,
    'overpaid', v_overpaid
  );
end;
$$;

revoke all on function public.recalculate_creance_settlement(uuid)
  from public, anon, authenticated, service_role;
-- Appelée uniquement par les effets financiers SECURITY DEFINER de ce schéma.

-- ---------------------------------------------------------------------------
-- 3. Effets financiers webhook (chemin paiement) — fencés + idempotents
-- ---------------------------------------------------------------------------

-- Résout la tentative de paiement pour un événement PaymentIntent, en tolérant
-- le désordre d'arrivée (id PI déjà lié, sinon métadonnée tentative), et vérifie
-- la concordance de scope avec le compte connecté de l'événement.
create or replace function public.apply_payment_intent_processing(
  p_stripe_event_id text,
  p_processing_attempt integer,
  p_lease_token uuid,
  p_connected_account_id text,
  p_payment_intent_id text,
  p_tentative_id uuid,
  p_moyen public.tentative_paiement_moyen
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tentative public.tentative_paiement;
  v_effect_new boolean;
begin
  perform public.assert_stripe_webhook_lease(
    p_stripe_event_id, p_processing_attempt, p_lease_token,
    'payment_intent.processing', p_connected_account_id
  );

  v_tentative := public.resolve_payment_intent_tentative(
    p_payment_intent_id, p_tentative_id, p_connected_account_id
  );
  if v_tentative.id is null then
    return jsonb_build_object('applied', false, 'reason', 'no_tentative');
  end if;

  insert into public.stripe_webhook_effect (stripe_event_id, stripe_object_id, effect_type)
  values (p_stripe_event_id, p_payment_intent_id, 'payment_intent.processing')
  on conflict do nothing;
  v_effect_new := found;
  if not v_effect_new then
    return jsonb_build_object('applied', false, 'reason', 'already_applied');
  end if;

  update public.tentative_paiement t
  set
    etat = 'EN_TRAITEMENT',
    stripe_payment_intent_id = coalesce(t.stripe_payment_intent_id, nullif(btrim(p_payment_intent_id), '')),
    moyen = coalesce(p_moyen, t.moyen)
  where t.id = v_tentative.id
    and t.etat in ('CREEE', 'NECESSITE_ACTION_CLIENT');

  return jsonb_build_object('applied', true, 'tentative_id', v_tentative.id);
end;
$$;

-- Confirmation de paiement : tentative RÉUSSIE, création idempotente de paiement,
-- recalcul de la créance et garde-fou trop-perçu. Fonds autoritatifs Stripe.
create or replace function public.apply_payment_intent_succeeded(
  p_stripe_event_id text,
  p_processing_attempt integer,
  p_lease_token uuid,
  p_connected_account_id text,
  p_payment_intent_id text,
  p_tentative_id uuid,
  p_amount_received bigint,
  p_moyen public.tentative_paiement_moyen
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tentative public.tentative_paiement;
  v_effect_new boolean;
  v_paiement_id uuid;
  v_settlement jsonb;
begin
  perform public.assert_stripe_webhook_lease(
    p_stripe_event_id, p_processing_attempt, p_lease_token,
    'payment_intent.succeeded', p_connected_account_id
  );

  if p_amount_received is null or p_amount_received <= 0 then
    raise exception 'payment_amount_invalid' using errcode = '22023';
  end if;

  -- Résolution sans verrou : l'ordre de verrouillage (créance puis tentative)
  -- est imposé ci-dessous pour rester cohérent avec claim_checkout_provisioning.
  v_tentative := public.resolve_payment_intent_tentative(
    p_payment_intent_id, p_tentative_id, p_connected_account_id
  );
  if v_tentative.id is null then
    -- Fonds réels sans tentative résoluble : ne jamais acquitter silencieusement.
    raise exception 'payment_succeeded_tentative_unresolved' using errcode = 'P0002';
  end if;

  insert into public.stripe_webhook_effect (stripe_event_id, stripe_object_id, effect_type)
  values (p_stripe_event_id, p_payment_intent_id, 'payment_intent.succeeded')
  on conflict do nothing;
  v_effect_new := found;
  if not v_effect_new then
    return jsonb_build_object('applied', false, 'reason', 'already_applied');
  end if;

  -- Ordre de verrou : créance d'abord, puis tentative (identique au claim).
  perform 1 from public.creance c where c.id = v_tentative.creance_id for update;
  select t.* into v_tentative
  from public.tentative_paiement t
  where t.id = v_tentative.id
  for update;

  update public.tentative_paiement t
  set
    etat = 'REUSSIE',
    stripe_payment_intent_id = coalesce(t.stripe_payment_intent_id, nullif(btrim(p_payment_intent_id), '')),
    moyen = coalesce(p_moyen, t.moyen),
    echec_code = null,
    echec_message = null
  where t.id = v_tentative.id;

  -- Création idempotente du paiement sous verrou de créance (backstop : index unique).
  select pmt.id into v_paiement_id
  from public.paiement pmt
  where pmt.tentative_paiement_id = v_tentative.id;
  if v_paiement_id is null then
    insert into public.paiement (creance_id, tentative_paiement_id, montant, source)
    values (v_tentative.creance_id, v_tentative.id, p_amount_received, 'lien_agent')
    returning id into v_paiement_id;
  end if;

  v_settlement := public.recalculate_creance_settlement(v_tentative.creance_id);

  insert into public.audit_log (
    prestataire_id, actor_type, action, entity_type, entity_id, metadata
  )
  select
    c.prestataire_id, 'system', 'PAYMENT_CONFIRMED', 'creance', c.id,
    jsonb_build_object(
      'tentative_id', v_tentative.id,
      'paiement_id', v_paiement_id,
      'amount_received', p_amount_received,
      'stripe_payment_intent_id', nullif(btrim(p_payment_intent_id), '')
    )
  from public.creance c
  where c.id = v_tentative.creance_id;

  return jsonb_build_object(
    'applied', true,
    'tentative_id', v_tentative.id,
    'paiement_id', v_paiement_id,
    'settlement', v_settlement
  );
end;
$$;

-- Échec de paiement : tentative ÉCHOUÉE (codes normalisés), créance inchangée.
create or replace function public.apply_payment_intent_payment_failed(
  p_stripe_event_id text,
  p_processing_attempt integer,
  p_lease_token uuid,
  p_connected_account_id text,
  p_payment_intent_id text,
  p_tentative_id uuid,
  p_echec_code text,
  p_echec_message text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tentative public.tentative_paiement;
  v_effect_new boolean;
begin
  perform public.assert_stripe_webhook_lease(
    p_stripe_event_id, p_processing_attempt, p_lease_token,
    'payment_intent.payment_failed', p_connected_account_id
  );

  v_tentative := public.resolve_payment_intent_tentative(
    p_payment_intent_id, p_tentative_id, p_connected_account_id
  );
  if v_tentative.id is null then
    return jsonb_build_object('applied', false, 'reason', 'no_tentative');
  end if;

  insert into public.stripe_webhook_effect (stripe_event_id, stripe_object_id, effect_type)
  values (p_stripe_event_id, p_payment_intent_id, 'payment_intent.payment_failed')
  on conflict do nothing;
  v_effect_new := found;
  if not v_effect_new then
    return jsonb_build_object('applied', false, 'reason', 'already_applied');
  end if;

  -- N'écrase jamais une tentative déjà terminale (ex. succeeded arrivé avant).
  update public.tentative_paiement t
  set
    etat = 'ECHOUEE',
    stripe_payment_intent_id = coalesce(t.stripe_payment_intent_id, nullif(btrim(p_payment_intent_id), '')),
    echec_code = left(nullif(btrim(p_echec_code), ''), 100),
    echec_message = left(nullif(btrim(p_echec_message), ''), 500)
  where t.id = v_tentative.id
    and t.etat in ('CREEE', 'NECESSITE_ACTION_CLIENT', 'EN_TRAITEMENT');

  return jsonb_build_object('applied', true, 'tentative_id', v_tentative.id);
end;
$$;

-- checkout.session.completed (paiement) : rattache le PI + snapshot Customer.
-- Ne confirme jamais seul un paiement (SEPA à confirmation différée) — les
-- événements PaymentIntent pilotent l'état financier.
create or replace function public.apply_checkout_session_completed_payment(
  p_stripe_event_id text,
  p_processing_attempt integer,
  p_lease_token uuid,
  p_connected_account_id text,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_customer_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tentative public.tentative_paiement;
  v_effect_new boolean;
begin
  perform public.assert_stripe_webhook_lease(
    p_stripe_event_id, p_processing_attempt, p_lease_token,
    'checkout.session.completed', p_connected_account_id
  );

  select t.* into v_tentative
  from public.tentative_paiement t
  join public.creance c on c.id = t.creance_id
  join public.prestataire p on p.id = c.prestataire_id
  where t.stripe_checkout_session_id = nullif(btrim(p_checkout_session_id), '')
    and p.stripe_account_id = nullif(btrim(p_connected_account_id), '')
  for update of t;
  if not found then
    -- Session inconnue de ce lot (ex. session `setup` d'un lot ultérieur).
    return jsonb_build_object('applied', false, 'reason', 'no_payment_tentative');
  end if;
  if v_tentative.stripe_account_id is distinct from nullif(btrim(p_connected_account_id), '') then
    raise exception 'webhook_tentative_scope_mismatch';
  end if;

  insert into public.stripe_webhook_effect (stripe_event_id, stripe_object_id, effect_type)
  values (p_stripe_event_id, p_checkout_session_id, 'checkout.session.completed.payment')
  on conflict do nothing;
  v_effect_new := found;
  if not v_effect_new then
    return jsonb_build_object('applied', false, 'reason', 'already_applied');
  end if;

  update public.tentative_paiement t
  set
    stripe_payment_intent_id = coalesce(t.stripe_payment_intent_id, nullif(btrim(p_payment_intent_id), '')),
    stripe_customer_id = coalesce(t.stripe_customer_id, nullif(btrim(p_customer_id), ''))
  where t.id = v_tentative.id;

  return jsonb_build_object('applied', true, 'tentative_id', v_tentative.id);
end;
$$;

-- checkout.session.expired (paiement) : tentative → ANNULEE si non terminale.
-- N'annule jamais un paiement déjà réussi (course succeeded/expired).
create or replace function public.apply_checkout_session_expired_payment(
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
  v_tentative public.tentative_paiement;
  v_effect_new boolean;
begin
  perform public.assert_stripe_webhook_lease(
    p_stripe_event_id, p_processing_attempt, p_lease_token,
    'checkout.session.expired', p_connected_account_id
  );

  select t.* into v_tentative
  from public.tentative_paiement t
  join public.creance c on c.id = t.creance_id
  join public.prestataire p on p.id = c.prestataire_id
  where t.stripe_checkout_session_id = nullif(btrim(p_checkout_session_id), '')
    and p.stripe_account_id = nullif(btrim(p_connected_account_id), '')
  for update of t;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'no_payment_tentative');
  end if;
  if v_tentative.stripe_account_id is distinct from nullif(btrim(p_connected_account_id), '') then
    raise exception 'webhook_tentative_scope_mismatch';
  end if;

  insert into public.stripe_webhook_effect (stripe_event_id, stripe_object_id, effect_type)
  values (p_stripe_event_id, p_checkout_session_id, 'checkout.session.expired.payment')
  on conflict do nothing;
  v_effect_new := found;
  if not v_effect_new then
    return jsonb_build_object('applied', false, 'reason', 'already_applied');
  end if;

  update public.tentative_paiement t
  set etat = 'ANNULEE'
  where t.id = v_tentative.id
    and t.etat in ('CREEE', 'NECESSITE_ACTION_CLIENT', 'EN_TRAITEMENT');

  return jsonb_build_object('applied', true, 'tentative_id', v_tentative.id);
end;
$$;

-- Résolution partagée d'une tentative depuis un événement PaymentIntent.
-- SECURITY DEFINER, appelée uniquement par les effets ci-dessus.
create or replace function public.resolve_payment_intent_tentative(
  p_payment_intent_id text,
  p_tentative_id uuid,
  p_connected_account_id text
)
returns public.tentative_paiement
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tentative public.tentative_paiement;
  v_account text;
begin
  select t.* into v_tentative
  from public.tentative_paiement t
  where t.stripe_payment_intent_id = nullif(btrim(p_payment_intent_id), '');

  if not found and p_tentative_id is not null then
    select t.* into v_tentative
    from public.tentative_paiement t
    where t.id = p_tentative_id;
  end if;

  if v_tentative.id is null then
    return v_tentative;
  end if;

  -- Concordance de scope stricte (03 §5.2) : compte connecté attendu.
  select p.stripe_account_id into v_account
  from public.creance c
  join public.prestataire p on p.id = c.prestataire_id
  where c.id = v_tentative.creance_id;

  if v_account is distinct from nullif(btrim(p_connected_account_id), '')
    or (v_tentative.stripe_account_id is not null
      and v_tentative.stripe_account_id is distinct from nullif(btrim(p_connected_account_id), ''))
  then
    raise exception 'webhook_tentative_scope_mismatch';
  end if;

  return v_tentative;
end;
$$;

-- charge.dispute.created : trace d'audit obligatoire (03 §5.1bis) + garde-fou
-- humain. Ne réécrit jamais un paiement confirmé ni un état terminal de créance.
-- La suspension d'une autorisation `prelevement_auto` et l'escalade `dossier_suivi`
-- sont câblées dans leurs lots respectifs (autorisation / suivi).
create or replace function public.record_charge_dispute_opened(
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
  v_tentative public.tentative_paiement;
  v_creance public.creance;
  v_effect_new boolean;
begin
  perform public.assert_stripe_webhook_lease(
    p_stripe_event_id, p_processing_attempt, p_lease_token,
    'charge.dispute.created', p_connected_account_id
  );

  insert into public.stripe_webhook_effect (stripe_event_id, stripe_object_id, effect_type)
  values (p_stripe_event_id, p_dispute_id, 'charge.dispute.created')
  on conflict do nothing;
  v_effect_new := found;
  if not v_effect_new then
    return jsonb_build_object('applied', false, 'reason', 'already_applied');
  end if;

  select t.* into v_tentative
  from public.tentative_paiement t
  where t.stripe_payment_intent_id = nullif(btrim(p_payment_intent_id), '');

  if found then
    select c.* into v_creance
    from public.creance c
    join public.prestataire p on p.id = c.prestataire_id
    where c.id = v_tentative.creance_id
      and p.stripe_account_id = nullif(btrim(p_connected_account_id), '');
    if not found then
      raise exception 'webhook_tentative_scope_mismatch';
    end if;

    insert into public.audit_log (
      prestataire_id, actor_type, action, entity_type, entity_id, metadata
    )
    values (
      v_creance.prestataire_id, 'system', 'PAYMENT_DISPUTE_OPENED',
      'creance', v_creance.id,
      jsonb_build_object(
        'dispute_id', p_dispute_id,
        'stripe_payment_intent_id', nullif(btrim(p_payment_intent_id), ''),
        'tentative_id', v_tentative.id,
        'reason', nullif(btrim(p_reason), '')
      )
    );
    insert into public.approval_request (
      prestataire_id, creance_id, type, requested_by_actor_type, payload, status
    )
    values (
      v_creance.prestataire_id, v_creance.id, 'formal_action', 'system',
      jsonb_build_object(
        'reason', 'charge_dispute_created',
        'dispute_id', p_dispute_id,
        'stripe_payment_intent_id', nullif(btrim(p_payment_intent_id), '')
      ),
      'pending'
    );
    return jsonb_build_object('applied', true, 'creance_id', v_creance.id);
  end if;

  -- Dispute non rattachable à une tentative connue : trace non scoping-liée impossible
  -- (audit_log exige un prestataire). L'effet reste enregistré (idempotence) et
  -- l'événement est acquitté ; à revisiter avec l'objet payment_dispute dédié.
  return jsonb_build_object('applied', true, 'creance_id', null, 'unresolved', true);
end;
$$;

-- Grants effets financiers : service_role uniquement.
revoke all on function public.apply_payment_intent_processing(
  text, integer, uuid, text, text, uuid, public.tentative_paiement_moyen
) from public, anon, authenticated;
grant execute on function public.apply_payment_intent_processing(
  text, integer, uuid, text, text, uuid, public.tentative_paiement_moyen
) to service_role;

revoke all on function public.apply_payment_intent_succeeded(
  text, integer, uuid, text, text, uuid, bigint, public.tentative_paiement_moyen
) from public, anon, authenticated;
grant execute on function public.apply_payment_intent_succeeded(
  text, integer, uuid, text, text, uuid, bigint, public.tentative_paiement_moyen
) to service_role;

revoke all on function public.apply_payment_intent_payment_failed(
  text, integer, uuid, text, text, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.apply_payment_intent_payment_failed(
  text, integer, uuid, text, text, uuid, text, text
) to service_role;

revoke all on function public.apply_checkout_session_completed_payment(
  text, integer, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.apply_checkout_session_completed_payment(
  text, integer, uuid, text, text, text, text
) to service_role;

revoke all on function public.apply_checkout_session_expired_payment(
  text, integer, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.apply_checkout_session_expired_payment(
  text, integer, uuid, text, text
) to service_role;

revoke all on function public.resolve_payment_intent_tentative(text, uuid, text)
  from public, anon, authenticated, service_role;

revoke all on function public.record_charge_dispute_opened(
  text, integer, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.record_charge_dispute_opened(
  text, integer, uuid, text, text, text, text
) to service_role;
