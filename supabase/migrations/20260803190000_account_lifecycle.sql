-- Cycle de vie d'un compte prestataire : export RGPD et clôture / anonymisation.
--
-- ---------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION NE FAIT PAS, ET POURQUOI
-- ---------------------------------------------------------------------------
--
-- Il n'y a PAS d'effacement total. Deux raisons, aucune contournable :
--
-- 1. `prestataire.user_id` référence `auth.users` en `on delete restrict`, et
--    toutes les tables métier référencent `prestataire.id` de la même façon.
--    Un `delete` en cascade n'existe pas dans ce schéma — ce n'est pas un
--    oubli, c'est ce qui empêche une suppression accidentelle d'emporter des
--    écritures comptables.
--
-- 2. Les créances, tentatives de paiement et paiements sont des pièces
--    comptables. Le code de commerce impose leur conservation (L123-22), et le
--    RGPD prévoit explicitement cette exception au droit à l'effacement
--    (art. 17.3.b, obligation légale). Les anonymiser reviendrait à détruire
--    la piste d'audit financière.
--
-- Ce qui est donc réellement fait ici :
--   - anonymisation de l'identité du titulaire du compte (nom, email) ;
--   - effacement du contenu conversationnel (messages, titres) — aucune valeur
--     comptable, forte densité de données personnelles. Cela suppose une
--     dérogation nominative à l'immuabilité des messages : voir section 2 bis,
--     c'est la seule brèche ouverte par cette migration et elle est bornée à
--     la transaction de clôture ;
--   - suppression logique de tous les documents, avec restitution des chemins
--     de stockage pour que l'appelant service_role retire réellement les octets ;
--   - révocation d'accès : `current_prestataire_id()` cesse de résoudre, ce qui
--     ferme d'un seul point toutes les policies RLS scopées par tenant.
--
-- Ce qui est CONSERVÉ, en connaissance de cause :
--   - `client_payeur`, `creance`, `tentative_paiement`, `paiement` : pièces
--     comptables et identité de la contrepartie qui les rend opposables ;
--   - `audit_log` : traçabilité des actions sensibles ;
--   - les références Stripe du compte, nécessaires au rapprochement des flux.
--
-- La purge à expiration du délai légal de conservation N'EST PAS implémentée :
-- elle suppose une durée de rétention arbitrée par le propriétaire du produit.
-- Tant qu'elle n'existe pas, la clôture est une anonymisation partielle — et
-- doit être présentée comme telle à l'utilisateur, jamais comme un effacement
-- complet.

-- ---------------------------------------------------------------------------
-- 1. Statut de compte
-- ---------------------------------------------------------------------------

create type public.account_status as enum ('active', 'closed');

comment on type public.account_status is
  'active = compte utilisable ; closed = compte clôturé et anonymisé, accès révoqué. Aucune réouverture n''est implémentée.';

alter table public.prestataire
  add column account_status public.account_status not null default 'active',
  add column closed_at timestamptz,
  add column anonymised_at timestamptz;

alter table public.prestataire
  add constraint prestataire_closed_consistency
  check ((account_status = 'closed') = (closed_at is not null));

comment on column public.prestataire.account_status is
  'Statut du cycle de vie du compte. Un compte closed ne résout plus via current_prestataire_id().';
comment on column public.prestataire.closed_at is
  'Horodatage de la clôture demandée par le titulaire.';
comment on column public.prestataire.anonymised_at is
  'Horodatage de l''anonymisation de l''identité. Distinct de closed_at : une clôture sans anonymisation resterait visible.';

-- `authenticated` n'a que SELECT sur prestataire (aucun grant de mutation) :
-- ces trois colonnes héritent donc de la lecture seule, sans grant additionnel.

-- ---------------------------------------------------------------------------
-- 2. Immuabilité de l'identité anonymisée
-- ---------------------------------------------------------------------------

-- `ensure_prestataire_for_current_user` resynchronise `prestataire.email`
-- depuis `auth.users` à chaque appel. Sans ce garde-fou, la première
-- authentification qui suivrait une clôture réécrirait l'email anonymisé avec
-- l'email d'origine — l'anonymisation serait annulée en silence.
--
-- Le choix est de neutraliser l'écriture plutôt que de lever : lever ferait
-- échouer l'ouverture de session avec une erreur technique, alors que la
-- réponse correcte est « ce compte est clos ».
create or replace function public.protect_closed_prestataire_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if old.account_status = 'closed' then
    new.nom := old.nom;
    new.email := old.email;
    new.account_status := old.account_status;
    new.closed_at := old.closed_at;
    new.anonymised_at := old.anonymised_at;
  end if;

  return new;
end;
$$;

revoke all on function public.protect_closed_prestataire_identity()
  from public, anon, authenticated, service_role;

create trigger prestataire_closed_identity_guard
before update on public.prestataire
for each row execute function public.protect_closed_prestataire_identity();

-- ---------------------------------------------------------------------------
-- 2 bis. Levée nominative de l'immuabilité des messages
-- ---------------------------------------------------------------------------

-- `prevent_message_mutation` rend les messages strictement immuables : c'est
-- ce qui fait de la conversation une trace non falsifiable, et cela doit le
-- rester pour tous les chemins applicatifs.
--
-- Une seule opération obtient une dérogation : l'anonymisation d'un compte
-- clôturé. Sans elle, le contenu conversationnel — la donnée personnelle la
-- plus dense du produit, et la seule sans valeur comptable — survivrait
-- indéfiniment à la demande d'effacement de son auteur.
--
-- La dérogation est portée par un réglage LOCAL à la transaction, posé
-- uniquement par `public.close_current_account()`. Il n'existe aucune RPC
-- exposée capable de le poser : PostgREST n'exécute pas de SQL arbitraire, et
-- `set_config(..., true)` retombe à la fin de la transaction. La suppression
-- de messages, elle, reste interdite sans exception.
create or replace function public.prevent_message_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
    and coalesce(current_setting('sidian.account_closure', true), 'off') = 'on'
  then
    return new;
  end if;

  raise exception 'Les messages sont immuables';
end;
$$;

comment on function public.prevent_message_mutation() is
  'Immuabilité des messages. Unique dérogation : l''anonymisation menée par close_current_account(), signalée par le réglage local sidian.account_closure.';

-- ---------------------------------------------------------------------------
-- 3. Révocation d'accès en un seul point
-- ---------------------------------------------------------------------------

-- Toutes les policies RLS scopées par tenant passent par cette fonction.
-- Y filtrer les comptes clos révoque l'accès à l'ensemble des données métier
-- sans toucher à une seule policy — et sans qu'une table oubliée reste
-- accessible.
create or replace function public.current_prestataire_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select p.id
  from public.prestataire p
  where p.user_id = (select auth.uid())
    and p.account_status = 'active'
  limit 1;
$$;

comment on function public.current_prestataire_id() is
  'Prestataire de la session courante. Ne résout QUE pour un compte actif : un compte clôturé n''accède plus à aucune donnée scopée par tenant.';

-- ---------------------------------------------------------------------------
-- 4. Export des données du compte (portabilité / droit d'accès)
-- ---------------------------------------------------------------------------

create or replace function public.export_current_account_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_prestataire public.prestataire;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select p.* into v_prestataire
  from public.prestataire p
  where p.user_id = v_uid;

  if not found then
    raise exception 'prestataire_not_found' using errcode = 'P0002';
  end if;

  if v_prestataire.account_status = 'closed' then
    raise exception 'account_closed' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'schema_version', 1,
    'generated_at', to_jsonb(timezone('utc', now())),
    -- Dit explicitement ce que l'export NE contient pas, pour qu'il ne soit
    -- jamais pris pour une copie exhaustive du compte.
    'notice', jsonb_build_object(
      'documents',
      'Métadonnées uniquement : le contenu des fichiers se télécharge depuis l''application.',
      'extraction',
      'Aucun contenu extrait : le produit ne sait pas lire les documents.'
    ),
    'profile', jsonb_build_object(
      'id', v_prestataire.id,
      'nom', v_prestataire.nom,
      'email', v_prestataire.email,
      'created_at', to_jsonb(v_prestataire.created_at),
      'account_status', v_prestataire.account_status,
      'subscription_status', v_prestataire.subscription_status,
      'pricing_version', v_prestataire.pricing_version,
      'subscription_started_at', to_jsonb(v_prestataire.subscription_started_at),
      'profil_agent_defaut', v_prestataire.profil_agent_defaut,
      'theme_preference', v_prestataire.theme_preference,
      'onboarding_profile_completed_at',
        to_jsonb(v_prestataire.onboarding_profile_completed_at),
      'stripe_account_id', v_prestataire.stripe_account_id,
      'stripe_onboarding_status', v_prestataire.stripe_onboarding_status
    ),
    'clients', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at)
      from public.client_payeur c
      where c.prestataire_id = v_prestataire.id
    ), '[]'::jsonb),
    'creances', coalesce((
      select jsonb_agg(to_jsonb(cr) order by cr.created_at)
      from public.creance cr
      where cr.prestataire_id = v_prestataire.id
    ), '[]'::jsonb),
    'payment_attempts', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at)
      from public.tentative_paiement t
      join public.creance cr on cr.id = t.creance_id
      where cr.prestataire_id = v_prestataire.id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(to_jsonb(pa) order by pa.created_at)
      from public.paiement pa
      join public.creance cr on cr.id = pa.creance_id
      where cr.prestataire_id = v_prestataire.id
    ), '[]'::jsonb),
    'conversations', coalesce((
      select jsonb_agg(to_jsonb(conv) order by conv.created_at)
      from public.conversation conv
      where conv.prestataire_id = v_prestataire.id
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.created_at)
      from public.message m
      join public.conversation conv on conv.id = m.conversation_id
      where conv.prestataire_id = v_prestataire.id
    ), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', d.id,
          'creance_id', d.creance_id,
          'original_filename', d.original_filename,
          'mime_type', d.mime_type,
          'size_bytes', d.size_bytes,
          'checksum', d.checksum,
          'status', d.status,
          'created_at', to_jsonb(d.created_at),
          'deleted_at', to_jsonb(d.deleted_at)
        )
        order by d.created_at
      )
      from public.document d
      where d.prestataire_id = v_prestataire.id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

comment on function public.export_current_account_data() is
  'Export JSON des données du prestataire courant. Le tenant vient de auth.uid() : aucun argument ne permet de désigner un autre compte.';

-- ---------------------------------------------------------------------------
-- 5. Clôture et anonymisation
-- ---------------------------------------------------------------------------

create or replace function public.close_current_account()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_prestataire public.prestataire;
  v_now timestamptz := timezone('utc', now());
  v_storage_paths text[] := array[]::text[];
  v_documents_deleted integer := 0;
  v_messages_erased integer := 0;
  v_conversations_cleared integer := 0;
  v_clients_retained integer := 0;
  v_creances_retained integer := 0;
  v_payments_retained integer := 0;
  v_anonymised_email text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select p.* into v_prestataire
  from public.prestataire p
  where p.user_id = v_uid
  for update;

  if not found then
    raise exception 'prestataire_not_found' using errcode = 'P0002';
  end if;

  -- Idempotence : reclôturer n'est pas une erreur, et ne réécrit rien.
  if v_prestataire.account_status = 'closed' then
    return jsonb_build_object(
      'prestataire_id', v_prestataire.id,
      'already_closed', true,
      'closed_at', to_jsonb(v_prestataire.closed_at),
      'storage_paths', '[]'::jsonb
    );
  end if;

  -- Documents : suppression logique + restitution des chemins. Les octets ne
  -- sont PAS retirés ici (aucune fonction SQL n'écrit dans le stockage) :
  -- l'appelant service_role doit les supprimer et c'est lui qui rend
  -- l'effacement effectif.
  with purged as (
    update public.document d
    set status = 'deleted',
        deleted_at = v_now
    where d.prestataire_id = v_prestataire.id
      and d.deleted_at is null
    returning d.storage_path
  )
  select coalesce(array_agg(purged.storage_path), array[]::text[]), count(*)
  into v_storage_paths, v_documents_deleted
  from purged;

  -- Messages : contenu libre, aucune valeur comptable. `contenu` est
  -- non vide par contrainte, d'où un marqueur plutôt qu'une chaîne vide.
  -- Le réglage est LOCAL : il ne survit pas à cette transaction et n'est
  -- reconnu que par `prevent_message_mutation` (cf. section 2 bis).
  perform set_config('sidian.account_closure', 'on', true);

  with erased as (
    update public.message m
    set contenu = '[contenu supprimé à la clôture du compte]'
    where m.conversation_id in (
      select conv.id
      from public.conversation conv
      where conv.prestataire_id = v_prestataire.id
    )
    returning 1
  )
  select count(*) into v_messages_erased from erased;

  -- Refermé immédiatement : la dérogation ne couvre que l'écriture ci-dessus.
  perform set_config('sidian.account_closure', 'off', true);

  with cleared as (
    update public.conversation conv
    set title = null
    where conv.prestataire_id = v_prestataire.id
      and conv.title is not null
    returning 1
  )
  select count(*) into v_conversations_cleared from cleared;

  select count(*) into v_clients_retained
  from public.client_payeur c
  where c.prestataire_id = v_prestataire.id;

  select count(*) into v_creances_retained
  from public.creance cr
  where cr.prestataire_id = v_prestataire.id;

  select count(*) into v_payments_retained
  from public.paiement pa
  join public.creance cr on cr.id = pa.creance_id
  where cr.prestataire_id = v_prestataire.id;

  -- Domaine `.invalid` (RFC 2606) : jamais routable, donc jamais réutilisable
  -- pour joindre l'ancien titulaire.
  v_anonymised_email :=
    'compte-clos+' || v_prestataire.id::text || '@sidian.invalid';

  update public.prestataire p
  set nom = 'Compte clôturé',
      email = v_anonymised_email,
      account_status = 'closed',
      closed_at = v_now,
      anonymised_at = v_now
  where p.id = v_prestataire.id;

  insert into public.audit_log (
    prestataire_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    v_prestataire.id,
    'human',
    'account.closed',
    'prestataire',
    v_prestataire.id,
    jsonb_build_object(
      'documents_soft_deleted', v_documents_deleted,
      'messages_erased', v_messages_erased,
      'conversations_cleared', v_conversations_cleared,
      'clients_retained', v_clients_retained,
      'creances_retained', v_creances_retained,
      'payments_retained', v_payments_retained,
      'retention_reason', 'obligation_comptable_l123_22'
    )
  );

  return jsonb_build_object(
    'prestataire_id', v_prestataire.id,
    'already_closed', false,
    'closed_at', to_jsonb(v_now),
    'anonymised', jsonb_build_object(
      'profile_identity', true,
      'documents_soft_deleted', v_documents_deleted,
      'messages_erased', v_messages_erased,
      'conversations_cleared', v_conversations_cleared
    ),
    -- Restitué explicitement : l'interface ne doit pas pouvoir annoncer un
    -- effacement complet alors que ces lignes restent en base.
    'retained_for_legal_obligation', jsonb_build_object(
      'clients', v_clients_retained,
      'creances', v_creances_retained,
      'payments', v_payments_retained
    ),
    'storage_paths', to_jsonb(v_storage_paths)
  );
end;
$$;

comment on function public.close_current_account() is
  'Clôture et anonymise le compte du prestataire courant. Anonymisation partielle : les pièces comptables sont conservées (obligation légale). Renvoie les chemins de stockage à purger par l''appelant service_role.';

-- ---------------------------------------------------------------------------
-- 6. Privilèges
-- ---------------------------------------------------------------------------

revoke all on function public.export_current_account_data()
  from public, anon, service_role;
revoke all on function public.close_current_account()
  from public, anon, service_role;

-- Seul le titulaire, avec sa propre session, peut exporter ou clôturer.
grant execute on function public.export_current_account_data() to authenticated;
grant execute on function public.close_current_account() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Inventaire RLS — inchangé, rappelé pour la revue
-- ---------------------------------------------------------------------------

-- Aucune table n'est ajoutée par cette migration : la révocation d'accès passe
-- par current_prestataire_id(), donc par les policies existantes.
