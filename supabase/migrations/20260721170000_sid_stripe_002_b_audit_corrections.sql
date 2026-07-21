-- SID-STRIPE-002-B — correctifs audit F2/F5.
--
-- Migration strictement additive :
--   * l'entrée EUR explicite devient la seule RPC de succès exécutable par
--     service_role ;
--   * un succès Stripe sans tentative résoluble crée une trace et une demande
--     de rapprochement humain idempotentes, puis peut être acquitté.

create or replace function public.apply_eur_payment_intent_succeeded(
  p_stripe_event_id text,
  p_processing_attempt integer,
  p_lease_token uuid,
  p_connected_account_id text,
  p_payment_intent_id text,
  p_tentative_id uuid,
  p_amount_received bigint,
  p_currency text,
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
  -- Fencing avant toute lecture ou écriture métier.
  perform public.assert_stripe_webhook_lease(
    p_stripe_event_id, p_processing_attempt, p_lease_token,
    'payment_intent.succeeded', p_connected_account_id
  );

  if lower(nullif(btrim(p_currency), '')) is distinct from 'eur' then
    raise exception 'payment_currency_not_supported' using errcode = '22023';
  end if;
  if p_amount_received is null or p_amount_received <= 0 then
    raise exception 'payment_amount_invalid' using errcode = '22023';
  end if;
  if nullif(btrim(p_payment_intent_id), '') is null then
    raise exception 'payment_object_invalid' using errcode = '22023';
  end if;

  -- Résolution sans verrou financier. Si elle réussit, la primitive existante
  -- conserve l'ordre de verrou créance → tentative et tous ses backstops.
  v_tentative := public.resolve_payment_intent_tentative(
    p_payment_intent_id, p_tentative_id, p_connected_account_id
  );
  if v_tentative.id is not null then
    return public.apply_payment_intent_succeeded(
      p_stripe_event_id,
      p_processing_attempt,
      p_lease_token,
      p_connected_account_id,
      p_payment_intent_id,
      p_tentative_id,
      p_amount_received,
      p_moyen
    );
  end if;

  -- Le compte de l'événement reste le seul moyen sûr de scoper le garde-fou.
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
    p_stripe_event_id, p_payment_intent_id, 'payment_intent.succeeded'
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
    'PAYMENT_SUCCEEDED_RECONCILIATION_REQUIRED',
    'stripe_payment_intent',
    null,
    jsonb_build_object(
      'stripe_event_id', p_stripe_event_id,
      'stripe_payment_intent_id', p_payment_intent_id,
      'stripe_connected_account_id', p_connected_account_id,
      'amount_received', p_amount_received,
      'currency', 'eur',
      'metadata_tentative_id', p_tentative_id,
      'reason', 'payment_succeeded_tentative_unresolved'
    )
  );

  insert into public.approval_request (
    prestataire_id, creance_id, type, requested_by_actor_type, payload, status
  )
  values (
    v_prestataire_id,
    null,
    'autre',
    'system',
    jsonb_build_object(
      'reason', 'payment_succeeded_tentative_unresolved',
      'stripe_event_id', p_stripe_event_id,
      'stripe_payment_intent_id', p_payment_intent_id,
      'stripe_connected_account_id', p_connected_account_id,
      'amount_received', p_amount_received,
      'currency', 'eur',
      'metadata_tentative_id', p_tentative_id
    ),
    'pending'
  );

  return jsonb_build_object(
    'applied', true,
    'unresolved', true,
    'reconciliation_required', true
  );
end;
$$;

comment on function public.apply_eur_payment_intent_succeeded(
  text, integer, uuid, text, text, uuid, bigint, text,
  public.tentative_paiement_moyen
) is
  'Applique un succès PaymentIntent EUR fencé ou crée un garde-fou durable de rapprochement si la tentative est introuvable.';

-- L'ancienne signature reste une primitive interne appelée par le wrapper EUR,
-- mais ne constitue plus une surface RPC directement exécutable.
revoke all on function public.apply_payment_intent_succeeded(
  text, integer, uuid, text, text, uuid, bigint,
  public.tentative_paiement_moyen
) from public, anon, authenticated, service_role;

revoke all on function public.apply_eur_payment_intent_succeeded(
  text, integer, uuid, text, text, uuid, bigint, text,
  public.tentative_paiement_moyen
) from public, anon, authenticated;
grant execute on function public.apply_eur_payment_intent_succeeded(
  text, integer, uuid, text, text, uuid, bigint, text,
  public.tentative_paiement_moyen
) to service_role;
