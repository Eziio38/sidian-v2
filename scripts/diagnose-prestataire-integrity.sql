-- Diagnostic local / staging — lignes prestataire potentiellement incohérentes
-- À exécuter manuellement (SQL Editor / psql). Aucune écriture.
--
-- Procédure staging SID-SEC-001 :
-- 1. Exécuter cette requête
-- 2. Revue manuelle des lignes signalées
-- 3. Appliquer les migrations SID-SEC-001 (onboarding + hardening)
-- 4. Revalider pnpm test:schema / test:auth en local, puis Auth staging

-- Email prestataire ≠ forme canonique auth (lower(btrim)) — y compris casse/espaces
select
  p.id,
  p.user_id,
  p.email as prestataire_email,
  u.email as auth_email,
  lower(btrim(u.email)) as auth_email_canonical,
  u.email_confirmed_at,
  p.subscription_status,
  p.pricing_version,
  p.platform_fee_basis_points,
  p.profil_agent_defaut,
  p.created_at
from public.prestataire p
left join auth.users u on u.id = p.user_id
where u.id is null
   or p.email is distinct from lower(btrim(u.email));

-- Valeurs commerciales hors défauts d'onboarding (revue métier, pas forcément une erreur)
select
  p.id,
  p.email,
  p.subscription_status,
  p.pricing_version,
  p.platform_fee_basis_points,
  p.profil_agent_defaut
from public.prestataire p
where p.subscription_status is distinct from 'trialing'
   or p.pricing_version is distinct from 'early_access_49'
   or p.platform_fee_basis_points is distinct from 0
   or p.profil_agent_defaut is distinct from 'controle';
