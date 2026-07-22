-- SID-STRIPE-003 — garde-fou durable pour les objets financiers Stripe
-- scoppables par compte Connect mais non rattachables à une tentative locale.
--
-- Cette migration additive ne modifie aucun effet financier : elle remplace
-- uniquement trois primitives webhook afin que les orphelins ne soient plus
-- acquittés sans trace. Le registre stripe_webhook_effect déduplique l'audit
-- dans la même transaction que le fence du webhook.

-- ---------------------------------------------------------------------------
-- payment_intent.processing
-- ---------------------------------------------------------------------------

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
  v_prestataire_id uuid;
  v_effect_new boolean;
begin
  -- Fencing avant toute écriture, y compris le registre d'effet et l'audit.
  perform public.assert_stripe_webhook_lease(
    p_stripe_event_id, p_processing_attempt, p_lease_token,
    'payment_intent.processing', p_connected_account_id
  );

  if nullif(btrim(p_payment_intent_id), '') is null then
    raise exception 'payment_object_invalid' using errcode = '22023';
  end if;

  v_tentative := public.resolve_payment_intent_tentative(
    p_payment_intent_id, p_tentative_id, p_connected_account_id
  );
  if v_tentative.id is null then
    -- Le compte Connect signé par Stripe est l'unique racine de scope sûre.
    select p.id into v_prestataire_id
    from public.prestataire p
    where p.stripe_account_id = nullif(btrim(p_connected_account_id), '');
    if not found then
      raise exception 'stripe_account_scope_mismatch' using errcode = '22023';
    end if;

    insert into public.stripe_webhook_effect (
      stripe_event_id, stripe_object_id, effect_type
    )
    values (
      p_stripe_event_id, p_payment_intent_id, 'payment_intent.processing'
    )
    on conflict do nothing;
    v_effect_new := found;
    if not v_effect_new then
      return jsonb_build_object('applied', false, 'reason', 'already_applied');
    end if;

    insert into public.audit_log (
      prestataire_id, actor_type, action, entity_type, entity_id, metadata
    )
    values (
      v_prestataire_id,
      'system',
      'PAYMENT_PROCESSING_RECONCILIATION_REQUIRED',
      'stripe_payment_intent',
      null,
      jsonb_build_object(
        'stripe_event_id', p_stripe_event_id,
        'stripe_payment_intent_id', p_payment_intent_id,
        'stripe_connected_account_id', p_connected_account_id,
        'metadata_tentative_id', p_tentative_id,
        'reason', 'payment_processing_tentative_unresolved'
      )
    );

    return jsonb_build_object(
      'applied', true,
      'unresolved', true,
      'reconciliation_required', true
    );
  end if;

  -- Chemin rattaché conservé à l'identique (002-B).
  insert into public.stripe_webhook_effect (
    stripe_event_id, stripe_object_id, effect_type
  )
  values (
    p_stripe_event_id, p_payment_intent_id, 'payment_intent.processing'
  )
  on conflict do nothing;
  v_effect_new := found;
  if not v_effect_new then
    return jsonb_build_object('applied', false, 'reason', 'already_applied');
  end if;

  update public.tentative_paiement t
  set
    etat = 'EN_TRAITEMENT',
    stripe_payment_intent_id = coalesce(
      t.stripe_payment_intent_id,
      nullif(btrim(p_payment_intent_id), '')
    ),
    moyen = coalesce(p_moyen, t.moyen)
  where t.id = v_tentative.id
    and t.etat in ('CREEE', 'NECESSITE_ACTION_CLIENT');

  return jsonb_build_object('applied', true, 'tentative_id', v_tentative.id);
end;
$$;

comment on function public.apply_payment_intent_processing(
  text, integer, uuid, text, text, uuid, public.tentative_paiement_moyen
) is
  'Effet processing fencé. Un PaymentIntent orphelin mais scoppable crée un audit de rapprochement idempotent, sans effet financier.';

-- ---------------------------------------------------------------------------
-- payment_intent.payment_failed
-- ---------------------------------------------------------------------------

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
  v_prestataire_id uuid;
  v_effect_new boolean;
begin
  -- Fencing avant toute écriture, y compris le registre d'effet et l'audit.
  perform public.assert_stripe_webhook_lease(
    p_stripe_event_id, p_processing_attempt, p_lease_token,
    'payment_intent.payment_failed', p_connected_account_id
  );

  if nullif(btrim(p_payment_intent_id), '') is null then
    raise exception 'payment_object_invalid' using errcode = '22023';
  end if;

  v_tentative := public.resolve_payment_intent_tentative(
    p_payment_intent_id, p_tentative_id, p_connected_account_id
  );
  if v_tentative.id is null then
    select p.id into v_prestataire_id
    from public.prestataire p
    where p.stripe_account_id = nullif(btrim(p_connected_account_id), '');
    if not found then
      raise exception 'stripe_account_scope_mismatch' using errcode = '22023';
    end if;

    insert into public.stripe_webhook_effect (
      stripe_event_id, stripe_object_id, effect_type
    )
    values (
      p_stripe_event_id, p_payment_intent_id, 'payment_intent.payment_failed'
    )
    on conflict do nothing;
    v_effect_new := found;
    if not v_effect_new then
      return jsonb_build_object('applied', false, 'reason', 'already_applied');
    end if;

    -- Le message Stripe libre n'est pas recopié sans tentative : le code
    -- normalisé suffit au rapprochement et minimise les données d'audit.
    insert into public.audit_log (
      prestataire_id, actor_type, action, entity_type, entity_id, metadata
    )
    values (
      v_prestataire_id,
      'system',
      'PAYMENT_FAILED_RECONCILIATION_REQUIRED',
      'stripe_payment_intent',
      null,
      jsonb_build_object(
        'stripe_event_id', p_stripe_event_id,
        'stripe_payment_intent_id', p_payment_intent_id,
        'stripe_connected_account_id', p_connected_account_id,
        'metadata_tentative_id', p_tentative_id,
        'failure_code', left(nullif(btrim(p_echec_code), ''), 100),
        'reason', 'payment_failed_tentative_unresolved'
      )
    );

    return jsonb_build_object(
      'applied', true,
      'unresolved', true,
      'reconciliation_required', true
    );
  end if;

  -- Chemin rattaché conservé à l'identique (002-B).
  insert into public.stripe_webhook_effect (
    stripe_event_id, stripe_object_id, effect_type
  )
  values (
    p_stripe_event_id, p_payment_intent_id, 'payment_intent.payment_failed'
  )
  on conflict do nothing;
  v_effect_new := found;
  if not v_effect_new then
    return jsonb_build_object('applied', false, 'reason', 'already_applied');
  end if;

  update public.tentative_paiement t
  set
    etat = 'ECHOUEE',
    stripe_payment_intent_id = coalesce(
      t.stripe_payment_intent_id,
      nullif(btrim(p_payment_intent_id), '')
    ),
    echec_code = left(nullif(btrim(p_echec_code), ''), 100),
    echec_message = left(nullif(btrim(p_echec_message), ''), 500)
  where t.id = v_tentative.id
    and t.etat in ('CREEE', 'NECESSITE_ACTION_CLIENT', 'EN_TRAITEMENT');

  return jsonb_build_object('applied', true, 'tentative_id', v_tentative.id);
end;
$$;

comment on function public.apply_payment_intent_payment_failed(
  text, integer, uuid, text, text, uuid, text, text
) is
  'Effet payment_failed fencé. Un PaymentIntent orphelin mais scoppable crée un audit de rapprochement idempotent, sans effet financier.';

-- ---------------------------------------------------------------------------
-- charge.dispute.created
-- ---------------------------------------------------------------------------

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
  v_prestataire_id uuid;
  v_effect_new boolean;
begin
  -- Fencing avant toute écriture, y compris le registre d'effet et l'audit.
  perform public.assert_stripe_webhook_lease(
    p_stripe_event_id, p_processing_attempt, p_lease_token,
    'charge.dispute.created', p_connected_account_id
  );

  if nullif(btrim(p_dispute_id), '') is null then
    raise exception 'stripe_dispute_object_invalid' using errcode = '22023';
  end if;

  -- Conserve l'ordre du chemin 002-B : fence, clé d'effet, puis résolution.
  -- Toute erreur de scope ultérieure annule la clé avec la transaction.
  insert into public.stripe_webhook_effect (
    stripe_event_id, stripe_object_id, effect_type
  )
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
    -- Scope du chemin rattaché identique à 002-B.
    select c.* into v_creance
    from public.creance c
    join public.prestataire p on p.id = c.prestataire_id
    where c.id = v_tentative.creance_id
      and p.stripe_account_id = nullif(btrim(p_connected_account_id), '');
    if not found then
      raise exception 'webhook_tentative_scope_mismatch';
    end if;
    v_prestataire_id := v_creance.prestataire_id;
  else
    -- Une dispute orpheline doit rester opérable dès lors que le compte signé
    -- permet de la rattacher sans ambiguïté à un prestataire Sidian.
    select p.id into v_prestataire_id
    from public.prestataire p
    where p.stripe_account_id = nullif(btrim(p_connected_account_id), '');
    if not found then
      raise exception 'stripe_account_scope_mismatch' using errcode = '22023';
    end if;
  end if;

  if v_tentative.id is not null then
    -- Chemin rattaché conservé : audit + approval sans réécriture financière.
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

  insert into public.audit_log (
    prestataire_id, actor_type, action, entity_type, entity_id, metadata
  )
  values (
    v_prestataire_id,
    'system',
    'PAYMENT_DISPUTE_RECONCILIATION_REQUIRED',
    'stripe_dispute',
    null,
    jsonb_build_object(
      'stripe_event_id', p_stripe_event_id,
      'dispute_id', p_dispute_id,
      'stripe_payment_intent_id', nullif(btrim(p_payment_intent_id), ''),
      'stripe_connected_account_id', p_connected_account_id,
      'reason', nullif(btrim(p_reason), ''),
      'reconciliation_reason', 'charge_dispute_tentative_unresolved'
    )
  );

  insert into public.approval_request (
    prestataire_id, creance_id, type, requested_by_actor_type, payload, status
  )
  values (
    v_prestataire_id,
    null,
    'formal_action',
    'system',
    jsonb_build_object(
      'reason', 'charge_dispute_tentative_unresolved',
      'stripe_event_id', p_stripe_event_id,
      'dispute_id', p_dispute_id,
      'stripe_payment_intent_id', nullif(btrim(p_payment_intent_id), ''),
      'stripe_connected_account_id', p_connected_account_id
    ),
    'pending'
  );

  return jsonb_build_object(
    'applied', true,
    'creance_id', null,
    'unresolved', true,
    'reconciliation_required', true
  );
end;
$$;

comment on function public.record_charge_dispute_opened(
  text, integer, uuid, text, text, text, text
) is
  'Trace une dispute fencée. Une dispute orpheline mais scoppable crée un audit et une approval_request idempotents, sans modifier paiement ni créance.';

-- Surface RPC : service_role uniquement, sans héritage d'un grant historique.
revoke all on function public.apply_payment_intent_processing(
  text, integer, uuid, text, text, uuid, public.tentative_paiement_moyen
) from public, anon, authenticated, service_role;
grant execute on function public.apply_payment_intent_processing(
  text, integer, uuid, text, text, uuid, public.tentative_paiement_moyen
) to service_role;

revoke all on function public.apply_payment_intent_payment_failed(
  text, integer, uuid, text, text, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.apply_payment_intent_payment_failed(
  text, integer, uuid, text, text, uuid, text, text
) to service_role;

revoke all on function public.record_charge_dispute_opened(
  text, integer, uuid, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.record_charge_dispute_opened(
  text, integer, uuid, text, text, text, text
) to service_role;
