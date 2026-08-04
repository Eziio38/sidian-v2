-- SID-RUNTIME-RELANCES — contexte de rendu des relances
--
-- Les handlers de `runtime_job` doivent rendre un email français à partir de
-- données métier : nom du prestataire, identité du client payeur, montant,
-- devise, échéance, état de la créance. Sans cette fonction, chaque handler
-- devrait enchaîner quatre lectures PostgREST et recomposer lui-même le
-- périmètre — avec le risque de le recomposer mal.
--
-- Lecture seule. Aucun effet Stripe / Email / WhatsApp / LLM ici : la fonction
-- ne fait que fournir la matière du rendu, jamais l'envoi.

-- ---------------------------------------------------------------------------
-- runtime_load_job_context — lecture bornée par la créance elle-même
-- ---------------------------------------------------------------------------
--
-- [LIEN DE PAIEMENT — CONSTAT, PAS UN OUBLI]
-- `payment_link` ne stocke que `token_hash` (SHA-256 du jeton opaque). Le jeton
-- brut n'est restitué qu'une seule fois, à la création, par
-- `open_payment_receivable` — voir la migration
-- 20260721120000_sid_stripe_002_a_checkout_foundation.sql. Il est donc
-- **impossible**, par construction, de reconstituer côté serveur l'URL
-- `/p/<token>` d'un lien déjà émis.
--
-- La fonction expose donc l'EXISTENCE d'un lien actif (`payment_link_active`,
-- `payment_link_id`) et non son URL. `payment_link_url` est renvoyé
-- explicitement à null : c'est le contrat, pas une colonne oubliée. Aucun
-- consommateur ne doit inventer d'URL à partir de `payment_link_id` — un tel
-- lien ne résoudrait rien.

create or replace function public.runtime_load_job_context(p_creance_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'creance_id', c.id,
    -- Le périmètre tenant vient de la créance, jamais d'un identifiant fourni
    -- par l'appelant : le worker compare ensuite cette valeur à celle du job.
    'prestataire_id', c.prestataire_id,
    'prestataire_nom', p.nom,
    'client_payeur_id', cp.id,
    'client_nom', cp.nom,
    'client_email', cp.email,
    'montant_cents', c.montant,
    'devise', c.devise,
    'date_echeance', to_char(c.date_echeance, 'YYYY-MM-DD'),
    'etat', c.etat,
    'payment_link_active', (pl.id is not null),
    'payment_link_id', pl.id,
    -- Toujours null : le jeton brut n'existe nulle part en base (cf. en-tête).
    'payment_link_url', null::text
  )
  from public.creance as c
  join public.prestataire as p on p.id = c.prestataire_id
  join public.client_payeur as cp on cp.id = c.client_payeur_id
  left join public.payment_link as pl
    on pl.creance_id = c.id
   and pl.status = 'active'
  where c.id = p_creance_id;
$$;

comment on function public.runtime_load_job_context(uuid) is
  'Contexte de rendu des relances runtime (lecture seule). payment_link_url est toujours null : payment_link ne conserve que le hash du jeton, l''URL /p/<token> n''est pas reconstituable côté serveur.';

revoke all on function public.runtime_load_job_context(uuid)
  from public, anon, authenticated;
grant execute on function public.runtime_load_job_context(uuid)
  to service_role;
