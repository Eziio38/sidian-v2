-- SID-STRIPE-002-B — résolution serveur d'un lien de paiement opaque.
--
-- Primitive unique de résolution : token opaque (empreinte SHA-256) → contexte
-- minimal nécessaire au serveur pour préparer une Session Checkout. Ne renvoie
-- jamais rien pour un lien révoqué. Le creance_id n'est exposé qu'au serveur
-- (jamais dans l'URL publique). Le rate limiting est appliqué en amont par
-- l'appelant (consume_public_rate_limit), cette fonction reste une lecture pure.

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

  return jsonb_build_object(
    'found', true,
    'payment_link_id', v_link.id,
    'creance_id', v_creance.id,
    'prestataire_id', v_prestataire.id,
    'client_payeur_id', v_client.id,
    'stripe_account_id', v_prestataire.stripe_account_id,
    'montant', v_creance.montant,
    'devise', v_creance.devise,
    'amount_paid', v_paid,
    'remaining', v_creance.montant - v_paid,
    'creance_etat', v_creance.etat::text,
    'creance_archived', v_creance.archived_at is not null,
    'client_email', v_client.email,
    'client_nom', v_client.nom
  );
end;
$$;

comment on function public.resolve_payment_link_by_token_hash(text) is
  'Résout un lien de paiement actif par empreinte de token opaque. Lecture serveur pure ; ne renvoie jamais un lien révoqué.';

revoke all on function public.resolve_payment_link_by_token_hash(text)
  from public, anon, authenticated;
grant execute on function public.resolve_payment_link_by_token_hash(text)
  to service_role;
