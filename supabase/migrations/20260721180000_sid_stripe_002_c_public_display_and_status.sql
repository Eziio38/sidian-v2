-- SID-STRIPE-002-C — interface minimale de paiement : champs d'affichage
-- public supplémentaires et statut de retour Checkout.
--
-- Migration strictement additive :
--   * resolve_payment_link_by_token_hash gagne des champs de lecture pure
--     nécessaires à l'affichage (nom prestataire, libellé/référence,
--     échéance, indicateur de paiement en cours) — aucune colonne, aucun
--     invariant financier, aucune signature de fonction modifiée ;
--   * resolve_payment_status_by_checkout_session_id est une primitive de
--     lecture seule nouvelle, scope à un identifiant Stripe opaque déjà
--     détenu par l'appelant (redirection Stripe), pour permettre à /retour
--     de revérifier côté serveur avant d'afficher un statut de paiement.

create or replace function public.resolve_payment_link_by_token_hash(
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_link public.payment_link;
  v_creance public.creance;
  v_prestataire public.prestataire;
  v_client public.client_payeur;
  v_paid bigint;
  v_pending public.tentative_paiement;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'payment_link_token_invalid' using errcode = '22023';
  end if;

  select pl.* into v_link
  from public.payment_link pl
  where pl.token_hash = p_token_hash
    and pl.status = 'active';
  if not found then
    return jsonb_build_object('found', false);
  end if;

  select c.* into v_creance
  from public.creance c
  where c.id = v_link.creance_id;

  select p.* into v_prestataire
  from public.prestataire p
  where p.id = v_creance.prestataire_id;

  select cp.* into v_client
  from public.client_payeur cp
  where cp.id = v_creance.client_payeur_id;

  select coalesce(sum(pmt.montant), 0) into v_paid
  from public.paiement pmt
  where pmt.creance_id = v_creance.id;

  -- Paiement en traitement (SEPA à confirmation différée) : signal d'affichage
  -- uniquement — ne remplace jamais la source de vérité webhook/PaymentIntent.
  select t.* into v_pending
  from public.tentative_paiement t
  where t.creance_id = v_creance.id
    and t.etat = 'EN_TRAITEMENT'
  limit 1;

  return jsonb_build_object(
    'found', true,
    'payment_link_id', v_link.id,
    'creance_id', v_creance.id,
    'prestataire_id', v_prestataire.id,
    'client_payeur_id', v_client.id,
    'stripe_account_id', v_prestataire.stripe_account_id,
    'prestataire_nom', v_prestataire.nom,
    'montant', v_creance.montant,
    'devise', v_creance.devise,
    'amount_paid', v_paid,
    'remaining', v_creance.montant - v_paid,
    'creance_etat', v_creance.etat::text,
    'creance_archived', v_creance.archived_at is not null,
    'creance_libelle', v_creance.libelle,
    'creance_reference_externe', v_creance.reference_externe,
    'creance_date_echeance', v_creance.date_echeance,
    'client_email', v_client.email,
    'client_nom', v_client.nom,
    'pending_payment', v_pending.id is not null,
    'pending_moyen', v_pending.moyen
  );
end;
$$;

comment on function public.resolve_payment_link_by_token_hash(text) is
  'Résout un lien de paiement actif par empreinte de token opaque. Lecture serveur pure ; ne renvoie jamais un lien révoqué. Inclut les champs d''affichage public (nom prestataire, libellé, référence, échéance, indicateur de paiement en cours).';

-- Grants inchangés (create or replace conserve les privilèges existants) ;
-- réaffirmés ici pour lisibilité et robustesse si la fonction est un jour
-- recréée par drop/create.
revoke all on function public.resolve_payment_link_by_token_hash(text)
  from public, anon, authenticated;
grant execute on function public.resolve_payment_link_by_token_hash(text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Statut de retour Checkout — lecture seule par identifiant Stripe opaque
-- ---------------------------------------------------------------------------

-- L'identifiant de Session Checkout est un secret de capacité à forte entropie
-- généré par Stripe et connu uniquement du navigateur qui vient d'y être
-- redirigé (query param success_url). Il n'est jamais énumérable et ne
-- provient jamais d'une saisie libre. Cette primitive ne renvoie aucun
-- identifiant interne (creance_id, tentative_id, prestataire_id) : uniquement
-- l'état de la tentative nécessaire à l'affichage de /retour.
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
  if nullif(btrim(p_checkout_session_id), '') is null then
    raise exception 'checkout_session_id_required' using errcode = '22023';
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
    'echec_code', v_tentative.echec_code
  );
end;
$$;

comment on function public.resolve_payment_status_by_checkout_session_id(text) is
  'Résout le statut d''une tentative de paiement par identifiant de Session Checkout Stripe (capacité opaque). Lecture serveur pure pour la page de retour ; aucun identifiant interne exposé.';

revoke all on function public.resolve_payment_status_by_checkout_session_id(text)
  from public, anon, authenticated;
grant execute on function public.resolve_payment_status_by_checkout_session_id(text)
  to service_role;
