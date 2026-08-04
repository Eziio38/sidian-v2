-- SID-STRIPE-003 — projection explicite d'une Session Checkout expirée.
--
-- Migration additive : une expiration Stripe signée reste non financière,
-- mais sa cause est désormais durable, auditable et distinguable d'un échec de
-- paiement sur la page de retour. Le lien de paiement reste actif et peut
-- provisionner une nouvelle tentative.

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
  v_state_changed boolean;
begin
  -- Le fence précède toute lecture ou écriture métier.
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

  insert into public.stripe_webhook_effect (
    stripe_event_id, stripe_object_id, effect_type
  )
  values (
    p_stripe_event_id, p_checkout_session_id, 'checkout.session.expired.payment'
  )
  on conflict do nothing;
  v_effect_new := found;
  if not v_effect_new then
    return jsonb_build_object('applied', false, 'reason', 'already_applied');
  end if;

  -- Ne touche jamais une tentative terminale. L'erreur de provisioning est une
  -- cause d'affichage normalisée, pas une confirmation issue du navigateur.
  update public.tentative_paiement t
  set
    etat = 'ANNULEE',
    checkout_provisioning_status = 'failed_terminal',
    checkout_provisioning_error_code = 'checkout_session_expired'
  where t.id = v_tentative.id
    and t.etat in ('CREEE', 'NECESSITE_ACTION_CLIENT', 'EN_TRAITEMENT');
  v_state_changed := found;

  if v_state_changed then
    insert into public.audit_log (
      prestataire_id, actor_type, action, entity_type, entity_id, metadata
    )
    select
      c.prestataire_id,
      'system',
      'PAYMENT_CHECKOUT_SESSION_EXPIRED',
      'creance',
      c.id,
      jsonb_build_object(
        'tentative_id', v_tentative.id,
        'stripe_checkout_session_id', p_checkout_session_id,
        'reason', 'checkout_session_expired'
      )
    from public.creance c
    where c.id = v_tentative.creance_id;
  end if;

  return jsonb_build_object(
    'applied', true,
    'tentative_id', v_tentative.id,
    'expired', v_state_changed
  );
end;
$$;

comment on function public.apply_checkout_session_expired_payment(
  text, integer, uuid, text, text
) is
  'Projette une expiration Checkout Stripe signée, fencée et idempotente, sans effet financier.';

revoke all on function public.apply_checkout_session_expired_payment(
  text, integer, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.apply_checkout_session_expired_payment(
  text, integer, uuid, text, text
) to service_role;

create or replace function public.resolve_payment_status_by_checkout_session_id(
  p_checkout_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tentative public.tentative_paiement;
begin
  if nullif(btrim(p_checkout_session_id), '') is null
    or char_length(btrim(p_checkout_session_id)) > 255
    or btrim(p_checkout_session_id) !~ '^cs_[A-Za-z0-9_]+$'
  then
    return jsonb_build_object('found', false);
  end if;

  select t.* into v_tentative
  from public.tentative_paiement t
  where t.stripe_checkout_session_id = btrim(p_checkout_session_id);

  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'etat', v_tentative.etat::text,
    'moyen', v_tentative.moyen,
    'montant', v_tentative.montant,
    'echec_code', v_tentative.echec_code,
    'checkout_provisioning_error_code',
      v_tentative.checkout_provisioning_error_code
  );
end;
$$;

comment on function public.resolve_payment_status_by_checkout_session_id(text)
is
  'Résout un statut de retour Checkout opaque, y compris une expiration projetée, sans identifiant interne.';

revoke all on function public.resolve_payment_status_by_checkout_session_id(text)
  from public, anon, authenticated;
grant execute on function public.resolve_payment_status_by_checkout_session_id(text)
  to service_role;
