-- Le contexte de relance transporte les préférences de notification
--
-- `notification_preference` était écrite depuis Paramètres mais lue par
-- personne : l'utilisateur pouvait décocher une relance et la recevoir quand
-- même. Un réglage sans effet est pire que pas de réglage.
--
-- On étend le contexte déjà chargé par le worker plutôt que d'ajouter une
-- seconde requête : le périmètre tenant reste dérivé de la créance, et la
-- décision d'envoyer se prend avec les mêmes données que le reste du message.
--
-- Absence de ligne = tout activé. C'est le défaut de la table et le
-- comportement attendu d'un compte qui n'a jamais ouvert Paramètres.

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
    -- Toujours null : le jeton brut n'existe nulle part en base (cf. migration
    -- 20260803150000). Le worker refuse d'envoyer une relance qui devrait le
    -- porter, plutôt que d'expédier un message amputé de son lien.
    'payment_link_url', null::text,
    -- Préférences de notification — `true` par défaut si aucune ligne.
    'notify_reminder_before_due',
      coalesce(np.email_reminder_before_due, true),
    'notify_payment_failed',
      coalesce(np.email_payment_failed, true)
  )
  -- Clause FROM reprise verbatim de la migration 20260803150000 : cette
  -- migration n'ajoute que les préférences, elle ne redéfinit pas la
  -- sélection du lien de paiement.
  from public.creance as c
  join public.prestataire as p on p.id = c.prestataire_id
  join public.client_payeur as cp on cp.id = c.client_payeur_id
  left join public.payment_link as pl
    on pl.creance_id = c.id
   and pl.status = 'active'
  left join public.notification_preference as np
    on np.prestataire_id = c.prestataire_id
  where c.id = p_creance_id;
$$;

revoke all on function public.runtime_load_job_context(uuid)
  from public, anon, authenticated;
grant execute on function public.runtime_load_job_context(uuid) to service_role;

comment on function public.runtime_load_job_context(uuid) is
  'Contexte de rendu des relances runtime (lecture seule). payment_link_url est toujours null : payment_link ne conserve que le hash du jeton. Transporte aussi les préférences de notification du prestataire (true par défaut).';
