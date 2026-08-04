-- SID-UI-SETTINGS — préférences de notification du prestataire.
--
-- ---------------------------------------------------------------------------
-- POURQUOI SEULEMENT DEUX COLONNES
-- ---------------------------------------------------------------------------
-- `EMAIL_TEMPLATE_KEYS` (src/lib/email/types.ts) déclare huit gabarits, mais
-- le runtime n'en émet réellement que deux aujourd'hui :
--
--   * reminder_before_due — relance préventive J-5
--     (WORKFLOW_POLICY.prevention), émise par le job `prevention_notice` ;
--   * payment_failed      — avis d'échec de tentative, émis par le job
--     `retry_failed_notify` (retry_policy = 'none' : on notifie, on ne rejoue
--     jamais un prélèvement).
--
-- Les six autres ne partent jamais :
--   * reminder_after_due exige `paymentLinkUrl` ; `runtime_load_job_context`
--     renvoie toujours null (payment_link ne conserve que `token_hash`), donc
--     le handler échoue avant tout envoi ;
--   * l'escalade silence n'a aucun gabarit honnête et échoue explicitement ;
--   * payment_received, update_payment_method, cancellation_notice,
--     partial_payment_notice et guide_internal_notice n'ont aucun appelant
--     dans le runtime — ils n'existent qu'en aperçu de brouillon.
--
-- Offrir un interrupteur pour un événement qui ne part jamais serait un
-- mensonge d'interface : la table ne porte donc QUE les deux événements réels.
-- Ajouter une colonne ici n'est légitime que le jour où un job l'émet.
--
-- WhatsApp n'a délibérément aucune colonne : le canal dépend d'une activation
-- plateforme (`loadWhatsAppEnv`), pas d'un choix du prestataire. Son état se
-- lit dans `getWorkspaceConfigStatus`, il ne se règle pas ici.
--
-- Défaut `true` des deux côtés : c'est le comportement actuel du runtime.
-- Un défaut `false` couperait silencieusement les relances des comptes
-- existants — une décision produit que personne n'a prise.

create table public.notification_preference (
  -- Clé primaire = prestataire : une seule ligne de préférences par compte,
  -- garantie par le schéma plutôt que par la discipline des appelants.
  prestataire_id uuid primary key
    references public.prestataire (id) on delete cascade,
  email_reminder_before_due boolean not null default true,
  email_payment_failed boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.notification_preference is
  'Préférences de notification par prestataire. Une colonne par événement réellement émis par le runtime — jamais par gabarit déclaré.';
comment on column public.notification_preference.email_reminder_before_due is
  'Autorise la relance préventive J-5 (job prevention_notice → reminder_before_due).';
comment on column public.notification_preference.email_payment_failed is
  'Autorise l''avis d''échec de tentative (job retry_failed_notify → payment_failed).';

alter table public.notification_preference enable row level security;

-- Lecture réservée au propriétaire. `current_prestataire_id()` dérive le
-- tenant de `auth.uid()` et exclut déjà les comptes clôturés.
create policy notification_preference_select_scope
  on public.notification_preference
  for select
  to authenticated
  using (prestataire_id = public.current_prestataire_id());

-- Aucune policy insert / update / delete pour `authenticated` : l'écriture
-- passe exclusivement par la RPC ci-dessous, qui redérive le tenant et trace
-- le changement. Un UPDATE PostgREST direct ne doit jamais pouvoir viser la
-- ligne d'un autre compte, même par erreur d'appelant.

-- Moindre privilège, en double barrière : la RLS borne les lignes visibles, le
-- privilège SQL borne les verbes disponibles. `authenticated` n'obtient QUE
-- `select` — même une policy d'écriture ajoutée par erreur resterait sans
-- effet.
revoke all on table public.notification_preference from anon;
grant select on table public.notification_preference to authenticated;
grant all on table public.notification_preference to service_role;

-- ---------------------------------------------------------------------------
-- Écriture — SECURITY DEFINER, tenant dérivé de auth.uid()
-- ---------------------------------------------------------------------------
-- La fonction ne prend AUCUN identifiant de prestataire : un appelant hostile
-- n'a aucun paramètre par lequel désigner le compte d'un tiers.
create or replace function public.set_current_prestataire_notification_preferences(
  p_email_reminder_before_due boolean,
  p_email_payment_failed boolean
)
returns public.notification_preference
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_prestataire_id uuid := public.current_prestataire_id();
  v_row public.notification_preference;
  v_previous public.notification_preference;
begin
  if v_prestataire_id is null then
    -- Couvre l'absence de session comme le compte clôturé : dans les deux cas
    -- il n'y a pas de préférence à écrire.
    raise exception 'not_authenticated'
      using errcode = '42501';
  end if;

  if p_email_reminder_before_due is null or p_email_payment_failed is null then
    raise exception 'notification_preference_required'
      using errcode = '22023';
  end if;

  select np.*
    into v_previous
  from public.notification_preference as np
  where np.prestataire_id = v_prestataire_id;

  insert into public.notification_preference as np (
    prestataire_id,
    email_reminder_before_due,
    email_payment_failed
  ) values (
    v_prestataire_id,
    p_email_reminder_before_due,
    p_email_payment_failed
  )
  on conflict (prestataire_id) do update
    set
      email_reminder_before_due = excluded.email_reminder_before_due,
      email_payment_failed = excluded.email_payment_failed,
      updated_at = timezone('utc', now())
  returning np.* into v_row;

  -- Couper une relance change ce que le client reçoit : la décision est
  -- traçable, comme toute action encadrée. Aucune écriture silencieuse.
  if v_previous.prestataire_id is null
    or v_previous.email_reminder_before_due is distinct from v_row.email_reminder_before_due
    or v_previous.email_payment_failed is distinct from v_row.email_payment_failed
  then
    insert into public.audit_log (
      prestataire_id,
      actor_type,
      action,
      entity_type,
      entity_id,
      metadata
    ) values (
      v_prestataire_id,
      'human',
      'prestataire.notification_preferences_updated',
      'notification_preference',
      v_prestataire_id,
      jsonb_build_object(
        'email_reminder_before_due', v_row.email_reminder_before_due,
        'email_payment_failed', v_row.email_payment_failed,
        'initial_configuration', v_previous.prestataire_id is null
      )
    );
  end if;

  return v_row;
end;
$$;

comment on function public.set_current_prestataire_notification_preferences(boolean, boolean) is
  'Enregistre les préférences de notification du prestataire courant (auth.uid()). Idempotente, auditée uniquement en cas de changement réel.';

revoke all on function public.set_current_prestataire_notification_preferences(boolean, boolean) from public;
revoke all on function public.set_current_prestataire_notification_preferences(boolean, boolean) from anon;
revoke all on function public.set_current_prestataire_notification_preferences(boolean, boolean) from service_role;
grant execute on function public.set_current_prestataire_notification_preferences(boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Inventaire RLS — la nouvelle table entre dans le contrôle structurel
-- ---------------------------------------------------------------------------
-- Reprend la liste en vigueur (20260803140000_document_storage.sql) et ajoute
-- `notification_preference` : sans cela, une table oubliée sans RLS passerait
-- sous le radar de `test-user-data-isolation`.
create or replace function public.sidian_assert_rls_enabled()
returns table(table_name text, rls_enabled boolean)
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    c.relname::text as table_name,
    c.relrowsecurity as rls_enabled
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in (
      'prestataire',
      'client_payeur',
      'creance',
      'tentative_paiement',
      'paiement',
      'payment_authorization',
      'dossier_suivi',
      'regle',
      'conversation',
      'conversation_project',
      'message',
      'approval_request',
      'audit_log',
      'document',
      'notification_preference',
      'processed_webhook_event',
      'stripe_customer_binding',
      'payment_link',
      'stripe_webhook_effect',
      'stripe_connect_audit_outbox',
      'public_rate_limit_event'
    )
  order by c.relname;
$$;

revoke all on function public.sidian_assert_rls_enabled() from public;
grant execute on function public.sidian_assert_rls_enabled() to service_role;
