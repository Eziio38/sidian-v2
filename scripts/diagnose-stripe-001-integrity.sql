-- SID-STRIPE-001-FIX — diagnostic strictement en lecture seule.
-- Exécuter avant la migration sur l'environnement ciblé. Les résultats sont des
-- agrégats sans identifiant utilisateur, email ou identifiant Stripe.

select
  count(*) filter (where etat = 'ACTIVE' and type is null)
    as active_without_type,
  count(*) filter (where etat = 'ACTIVE' and stripe_payment_method_id is null)
    as active_without_payment_method,
  count(*) filter (where etat = 'ACTIVE' and authorized_at is null)
    as active_without_authorized_at,
  count(*) filter (
    where etat = 'ACTIVE'
      and nullif(btrim(authorization_text_version), '') is null
  ) as active_without_text_version,
  count(*) filter (
    where etat = 'ACTIVE'
      and nullif(btrim(authorization_channel), '') is null
  ) as active_without_channel,
  count(*) filter (where etat = 'ACTIVE' and revoked_at is not null)
    as active_with_revoked_at,
  count(*) filter (where etat = 'REVOQUEE' and revoked_at is null)
    as revoked_without_revoked_at,
  count(*) filter (where etat <> 'REVOQUEE' and revoked_at is not null)
    as non_revoked_with_revoked_at
from public.payment_authorization;

select
  pricing_version,
  count(*) as account_count
from public.prestataire
group by pricing_version
order by account_count desc, pricing_version;
