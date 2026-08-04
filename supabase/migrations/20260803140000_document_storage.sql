-- Persistance des documents téléversés — STOCKAGE UNIQUEMENT.
--
-- Aucune extraction de contenu n'existe dans le produit : ni OCR, ni parsing
-- PDF, ni transcription. Un document dont les octets sont confirmés reste donc
-- en 'awaiting_processing', qui est l'état honnête « octets présents, contenu
-- jamais analysé ». L'état 'stored' est réservé au jour où une chaîne d'analyse
-- existera et déclarera qu'un document n'attend plus rien ; rien dans le code
-- actuel ne le pose. Voir docs/DOCUMENT_STORAGE.md.
--
-- Le chemin de stockage n'est jamais fourni par l'appelant : il est dérivé de
-- la session (auth.uid() -> prestataire) par les RPC ci-dessous. C'est la règle
-- d'isolation la plus stricte du projet.

-- ---------------------------------------------------------------------------
-- 1. Contraintes de format — source unique côté SQL
-- ---------------------------------------------------------------------------

-- Plafond de taille. Aligné sur MAX_DOCUMENT_FILE_SIZE déjà appliqué côté
-- composer (src/components/assistant/document-attachments.ts) et sur
-- DOCUMENT_MAX_SIZE_BYTES (src/lib/documents/schemas.ts). Toute révision doit
-- modifier les trois au même endroit — décision propriétaire, cf. doc.
create or replace function public.document_max_size_bytes()
returns bigint
language sql
immutable
parallel safe
as $$
  select 20971520::bigint;
$$;

comment on function public.document_max_size_bytes() is
  'Plafond de taille d''un document (20 MiB). Doit rester égal à DOCUMENT_MAX_SIZE_BYTES côté TypeScript.';

-- Allowlist MIME. Les archives (zip, rar, 7z, tar…) sont volontairement
-- absentes : un conteneur opaque ne peut être ni contrôlé ni restitué
-- honnêtement tant qu'aucune analyse de contenu n'existe.
create or replace function public.document_allowed_mime_types()
returns text[]
language sql
immutable
parallel safe
as $$
  select array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]::text[];
$$;

comment on function public.document_allowed_mime_types() is
  'Allowlist MIME des documents. Doit rester identique à DOCUMENT_ALLOWED_MIME_TYPES côté TypeScript.';

create or replace function public.document_mime_allowed(p_mime text)
returns boolean
language sql
immutable
parallel safe
as $$
  select p_mime is not null
    and lower(btrim(p_mime)) = any (public.document_allowed_mime_types());
$$;

comment on function public.document_mime_allowed(text) is
  'Vrai si le type MIME appartient à l''allowlist documents.';

revoke all on function public.document_max_size_bytes() from public, anon;
revoke all on function public.document_allowed_mime_types() from public, anon;
revoke all on function public.document_mime_allowed(text) from public, anon;
grant execute on function public.document_max_size_bytes() to authenticated, service_role;
grant execute on function public.document_allowed_mime_types() to authenticated, service_role;
grant execute on function public.document_mime_allowed(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Bucket privé
-- ---------------------------------------------------------------------------

-- Bucket créé par migration (et non par supabase/config.toml) : c'est le seul
-- mécanisme déjà utilisé par ce dépôt pour décrire le schéma, et il s'applique
-- identiquement en local et en hébergé.
insert into storage.buckets (id, name, "public", file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  public.document_max_size_bytes(),
  public.document_allowed_mime_types()
)
on conflict (id) do update
set
  "public" = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 3. Table de métadonnées
-- ---------------------------------------------------------------------------

create type public.document_status as enum (
  'pending_upload',
  'stored',
  'awaiting_processing',
  'quarantined',
  'deleted'
);

comment on type public.document_status is
  'pending_upload = ligne réservée, octets non confirmés ; awaiting_processing = octets présents, contenu jamais analysé (état terminal actuel) ; stored = réservé à une future chaîne d''analyse ; quarantined = incohérence détectée à la confirmation ; deleted = suppression logique.';

create table public.document (
  id uuid primary key default gen_random_uuid(),
  prestataire_id uuid not null references public.prestataire (id) on delete restrict,
  creance_id uuid references public.creance (id) on delete restrict,
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  checksum text,
  status public.document_status not null default 'pending_upload',
  uploaded_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  constraint document_storage_path_unique unique (storage_path),
  constraint document_mime_allowlist
    check (public.document_mime_allowed(mime_type)),
  constraint document_size_bytes_range
    check (size_bytes between 1 and public.document_max_size_bytes()),
  constraint document_original_filename_len
    check (char_length(btrim(original_filename)) between 1 and 255),
  -- Convention de chemin : <prestataire_id>/<document_id>/<nom-assaini>.
  -- La contrainte impose le préfixe tenant ET l'absence de séparateur dans le
  -- dernier segment : aucune ligne ne peut désigner le répertoire d'un autre.
  constraint document_storage_path_convention
    check (
      storage_path =
        prestataire_id::text || '/' || id::text || '/'
        || regexp_replace(storage_path, '^.*/', '')
    ),
  constraint document_storage_path_no_traversal
    check (storage_path !~ '(^|/)\.\.?(/|$)'),
  constraint document_deleted_consistency
    check ((status = 'deleted') = (deleted_at is not null)),
  constraint document_checksum_shape
    check (checksum is null or checksum ~ '^[a-f0-9]{64}$')
);

comment on table public.document is
  'Métadonnées des fichiers téléversés. Aucune donnée extraite : le produit ne sait pas lire le contenu.';
comment on column public.document.storage_path is
  'Chemin dans le bucket privé « documents » — toujours <prestataire_id>/<document_id>/<nom-assaini>, dérivé de la session.';
comment on column public.document.checksum is
  'SHA-256 hexadécimal fourni par le client, à titre indicatif — jamais recalculé côté serveur aujourd''hui.';
comment on column public.document.status is
  'Voir public.document_status. Une confirmation d''upload mène à awaiting_processing, pas à stored.';
comment on column public.document.deleted_at is
  'Suppression logique. La purge des octets relève d''une politique de rétention non arbitrée — cf. docs/DOCUMENT_STORAGE.md.';

create trigger document_set_updated_at
before update on public.document
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Index
-- ---------------------------------------------------------------------------

create index document_prestataire_created_idx
  on public.document (prestataire_id, created_at desc)
  where deleted_at is null;

create index document_creance_idx
  on public.document (creance_id, created_at desc)
  where creance_id is not null and deleted_at is null;

-- Balayage du ménage des uploads abandonnés : partiel sur le seul état
-- concerné, ordonné par ancienneté.
create index document_pending_upload_cleanup_idx
  on public.document (created_at)
  where status = 'pending_upload';

-- ---------------------------------------------------------------------------
-- 5. Cohérence tenant de la créance rattachée
-- ---------------------------------------------------------------------------

create or replace function public.enforce_document_creance_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_creance_prestataire_id uuid;
begin
  if new.creance_id is null then
    return new;
  end if;

  select c.prestataire_id
  into v_creance_prestataire_id
  from public.creance c
  where c.id = new.creance_id;

  if v_creance_prestataire_id is null
    or v_creance_prestataire_id is distinct from new.prestataire_id
  then
    raise exception 'document.creance_id hors scope prestataire'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_document_creance_scope()
  from public, anon, authenticated, service_role;

create trigger document_creance_scope_check
before insert or update of creance_id, prestataire_id on public.document
for each row execute function public.enforce_document_creance_scope();

-- ---------------------------------------------------------------------------
-- 6. RLS et privilèges
-- ---------------------------------------------------------------------------

alter table public.document enable row level security;

revoke all on table public.document from public, anon;
revoke all on table public.document from authenticated;
-- Lecture seule côté authenticated, comme tentative_paiement et paiement :
-- toute écriture passe par les RPC déterministes ci-dessous.
grant select on table public.document to authenticated;
grant all on table public.document to service_role;

create policy document_select_scope
  on public.document
  for select
  to authenticated
  using (prestataire_id = public.current_prestataire_id());

-- ---------------------------------------------------------------------------
-- 7. Policies sur les objets du bucket
-- ---------------------------------------------------------------------------

-- Un utilisateur ne voit et n'écrit que sous son propre préfixe tenant.
-- La signature d'URL (upload comme download) passe par ces policies.
create policy document_objects_select_scope
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_prestataire_id()::text
  );

create policy document_objects_insert_scope
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_prestataire_id()::text
  );

-- Pas de policy update/delete pour authenticated : la suppression des octets
-- relève de la maintenance service_role, afin qu'une ligne « confirmée » ne
-- puisse pas se retrouver silencieusement sans contenu.

-- ---------------------------------------------------------------------------
-- 8. RPC — le tenant provient toujours de la session
-- ---------------------------------------------------------------------------

create or replace function public.register_document_upload(
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_creance_id uuid default null
)
returns public.document
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_prestataire_id uuid;
  v_id uuid := gen_random_uuid();
  v_mime text := lower(btrim(coalesce(p_mime_type, '')));
  v_name text;
  v_row public.document;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select p.id
  into v_prestataire_id
  from public.prestataire p
  where p.user_id = v_uid;

  if v_prestataire_id is null then
    raise exception 'prestataire_not_found' using errcode = 'P0002';
  end if;

  if not public.document_mime_allowed(v_mime) then
    raise exception 'document_mime_not_allowed' using errcode = '22023';
  end if;

  if p_size_bytes is null
    or p_size_bytes < 1
    or p_size_bytes > public.document_max_size_bytes()
  then
    raise exception 'document_size_out_of_range' using errcode = '22023';
  end if;

  if p_creance_id is not null then
    perform 1
    from public.creance c
    where c.id = p_creance_id
      and c.prestataire_id = v_prestataire_id;

    if not found then
      raise exception 'document_creance_out_of_scope' using errcode = '42501';
    end if;
  end if;

  -- Assainissement du nom : on ne conserve jamais un segment de chemin fourni
  -- par le client. Miroir exact de sanitiseDocumentFilename() côté TypeScript.
  v_name := regexp_replace(coalesce(p_original_filename, ''), '^.*[/\\]', '');
  v_name := regexp_replace(v_name, '[^A-Za-z0-9._-]', '_', 'g');
  v_name := regexp_replace(v_name, '_{2,}', '_', 'g');
  v_name := regexp_replace(v_name, '^\.+', '');
  v_name := left(v_name, 120);
  if btrim(v_name) = '' then
    v_name := 'document';
  end if;

  insert into public.document (
    id,
    prestataire_id,
    creance_id,
    storage_path,
    original_filename,
    mime_type,
    size_bytes,
    status,
    uploaded_by
  ) values (
    v_id,
    v_prestataire_id,
    p_creance_id,
    v_prestataire_id::text || '/' || v_id::text || '/' || v_name,
    left(
      coalesce(nullif(btrim(coalesce(p_original_filename, '')), ''), 'document'),
      255
    ),
    v_mime,
    p_size_bytes,
    'pending_upload',
    v_uid
  )
  returning * into v_row;

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
    'document.upload_registered',
    'document',
    v_row.id,
    jsonb_build_object(
      'mime_type', v_row.mime_type,
      'declared_size_bytes', v_row.size_bytes,
      'creance_id', v_row.creance_id
    )
  );

  return v_row;
end;
$$;

comment on function public.register_document_upload(text, text, bigint, uuid) is
  'Réserve une ligne document pour le prestataire courant et calcule son chemin de stockage. Aucun octet n''est encore attendu.';

create or replace function public.confirm_document_upload(
  p_document_id uuid,
  p_checksum text default null
)
returns public.document
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_prestataire_id uuid;
  v_row public.document;
  v_object_size bigint;
  v_object_mime text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select p.id
  into v_prestataire_id
  from public.prestataire p
  where p.user_id = v_uid;

  if v_prestataire_id is null then
    raise exception 'prestataire_not_found' using errcode = 'P0002';
  end if;

  select d.*
  into v_row
  from public.document d
  where d.id = p_document_id
    and d.prestataire_id = v_prestataire_id
  for update;

  if not found then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;

  -- Idempotence : une confirmation déjà acquise n'est pas une erreur.
  if v_row.status = 'awaiting_processing' then
    return v_row;
  end if;

  if v_row.status <> 'pending_upload' then
    raise exception 'document_status_conflict' using errcode = '22023';
  end if;

  select
    (o.metadata->>'size')::bigint,
    lower(btrim(coalesce(o.metadata->>'mimetype', '')))
  into v_object_size, v_object_mime
  from storage.objects o
  where o.bucket_id = 'documents'
    and o.name = v_row.storage_path;

  if not found then
    raise exception 'document_object_missing' using errcode = 'P0002';
  end if;

  -- Le serveur ne fait pas confiance à la taille ni au type déclarés : il lit
  -- ce que le bucket a réellement reçu. Une divergence met en quarantaine sans
  -- lever d'exception, pour que la mise en quarantaine soit bien persistée.
  if v_object_size is null
    or v_object_size < 1
    or v_object_size > public.document_max_size_bytes()
    or not public.document_mime_allowed(v_object_mime)
  then
    update public.document d
    set status = 'quarantined'
    where d.id = v_row.id
    returning d.* into v_row;

    insert into public.audit_log (
      prestataire_id, actor_type, action, entity_type, entity_id, metadata
    ) values (
      v_prestataire_id,
      'system',
      'document.quarantined',
      'document',
      v_row.id,
      jsonb_build_object(
        'observed_size_bytes', v_object_size,
        'observed_mime_type', v_object_mime
      )
    );

    return v_row;
  end if;

  if p_checksum is not null and p_checksum !~ '^[a-f0-9]{64}$' then
    raise exception 'document_checksum_invalid' using errcode = '22023';
  end if;

  update public.document d
  set
    -- Terminal aujourd'hui : aucune chaîne d'analyse ne consomme cet état.
    status = 'awaiting_processing',
    size_bytes = v_object_size,
    mime_type = v_object_mime,
    checksum = coalesce(p_checksum, d.checksum)
  where d.id = v_row.id
  returning d.* into v_row;

  insert into public.audit_log (
    prestataire_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    v_prestataire_id,
    'human',
    'document.upload_confirmed',
    'document',
    v_row.id,
    jsonb_build_object(
      'size_bytes', v_row.size_bytes,
      'mime_type', v_row.mime_type,
      'has_checksum', v_row.checksum is not null
    )
  );

  return v_row;
end;
$$;

comment on function public.confirm_document_upload(uuid, text) is
  'Confirme la présence des octets, vérifie taille et type réellement stockés, puis fige le document en awaiting_processing.';

create or replace function public.soft_delete_document(p_document_id uuid)
returns public.document
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_prestataire_id uuid;
  v_row public.document;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select p.id
  into v_prestataire_id
  from public.prestataire p
  where p.user_id = v_uid;

  if v_prestataire_id is null then
    raise exception 'prestataire_not_found' using errcode = 'P0002';
  end if;

  select d.*
  into v_row
  from public.document d
  where d.id = p_document_id
    and d.prestataire_id = v_prestataire_id
  for update;

  if not found then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;

  if v_row.status = 'deleted' then
    return v_row;
  end if;

  update public.document d
  set status = 'deleted',
      deleted_at = timezone('utc', now())
  where d.id = v_row.id
  returning d.* into v_row;

  insert into public.audit_log (
    prestataire_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    v_prestataire_id,
    'human',
    'document.soft_deleted',
    'document',
    v_row.id,
    jsonb_build_object('storage_path', v_row.storage_path)
  );

  return v_row;
end;
$$;

comment on function public.soft_delete_document(uuid) is
  'Suppression logique d''un document du prestataire courant. Les octets restent dans le bucket — la purge dépend d''une politique de rétention non arbitrée.';

create or replace function public.list_current_documents(
  p_creance_id uuid default null,
  p_include_deleted boolean default false,
  p_limit integer default 50,
  p_offset integer default 0
)
returns setof public.document
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select d.*
  from public.document d
  where d.prestataire_id = public.current_prestataire_id()
    and (p_creance_id is null or d.creance_id = p_creance_id)
    and (coalesce(p_include_deleted, false) or d.deleted_at is null)
  order by d.created_at desc, d.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.list_current_documents(uuid, boolean, integer, integer) is
  'Liste les documents du prestataire courant. Le tenant vient de la session, jamais d''un argument.';

-- `setof` plutôt que `public.document` : un document hors tenant renvoie zéro
-- ligne au lieu de lever, pour que « inexistant » et « appartient à un autre »
-- soient indiscernables côté appelant.
create or replace function public.get_current_document(p_document_id uuid)
returns setof public.document
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select d.*
  from public.document d
  where d.id = p_document_id
    and d.prestataire_id = public.current_prestataire_id();
$$;

comment on function public.get_current_document(uuid) is
  'Renvoie un document du prestataire courant, ou aucune ligne. Le tenant vient de la session.';

-- Ménage des uploads jamais confirmés. Opération transverse : réservée au
-- service_role (worker / cron), jamais exposée à un utilisateur.
create or replace function public.purge_abandoned_document_uploads(
  p_older_than_hours integer default 24,
  p_limit integer default 500
)
returns table (id uuid, storage_path text)
-- `language sql` volontairement : en plpgsql, les paramètres OUT `id` et
-- `storage_path` entreraient en collision de nom avec les colonnes de
-- public.document lors de la substitution de variables.
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with candidate as (
    select d.id
    from public.document d
    where d.status = 'pending_upload'
      and d.created_at
        < timezone('utc', now())
          - make_interval(
              hours => least(greatest(coalesce(p_older_than_hours, 24), 1), 720)
            )
    order by d.created_at
    limit least(greatest(coalesce(p_limit, 500), 1), 5000)
    for update skip locked
  )
  update public.document d
  set status = 'deleted',
      deleted_at = timezone('utc', now())
  from candidate
  where d.id = candidate.id
  returning d.id, d.storage_path;
$$;

comment on function public.purge_abandoned_document_uploads(integer, integer) is
  'Marque supprimés les uploads jamais confirmés et renvoie leurs chemins pour retrait des octets par l''appelant service_role.';

revoke all on function public.register_document_upload(text, text, bigint, uuid)
  from public, anon, service_role;
revoke all on function public.confirm_document_upload(uuid, text)
  from public, anon, service_role;
revoke all on function public.soft_delete_document(uuid)
  from public, anon, service_role;
revoke all on function public.list_current_documents(uuid, boolean, integer, integer)
  from public, anon, service_role;
revoke all on function public.get_current_document(uuid)
  from public, anon, service_role;
revoke all on function public.purge_abandoned_document_uploads(integer, integer)
  from public, anon, authenticated;

grant execute on function public.register_document_upload(text, text, bigint, uuid) to authenticated;
grant execute on function public.confirm_document_upload(uuid, text) to authenticated;
grant execute on function public.soft_delete_document(uuid) to authenticated;
grant execute on function public.list_current_documents(uuid, boolean, integer, integer) to authenticated;
grant execute on function public.get_current_document(uuid) to authenticated;
grant execute on function public.purge_abandoned_document_uploads(integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 9. Cohérence de portée des traces d'audit
-- ---------------------------------------------------------------------------

-- Reprise de la dernière définition connue (20260721210300, qui couvre déjà
-- payment_authorization), avec la seule addition de 'document' : sans cette
-- branche, une trace pourrait désigner un document d'un autre prestataire.
create or replace function public.enforce_audit_log_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_prestataire_id uuid;
begin
  if new.entity_id is null then
    return new;
  end if;

  case new.entity_type
    when 'creance' then
      select c.prestataire_id into v_prestataire_id
      from public.creance c where c.id = new.entity_id;
    when 'client_payeur' then
      select cp.prestataire_id into v_prestataire_id
      from public.client_payeur cp where cp.id = new.entity_id;
    when 'conversation' then
      select conv.prestataire_id into v_prestataire_id
      from public.conversation conv where conv.id = new.entity_id;
    when 'approval_request' then
      select ar.prestataire_id into v_prestataire_id
      from public.approval_request ar where ar.id = new.entity_id;
    when 'payment_authorization' then
      select pa.prestataire_id into v_prestataire_id
      from public.payment_authorization pa where pa.id = new.entity_id;
    when 'document' then
      select doc.prestataire_id into v_prestataire_id
      from public.document doc where doc.id = new.entity_id;
    else
      return new;
  end case;

  if v_prestataire_id is not null
    and v_prestataire_id is distinct from new.prestataire_id
  then
    raise exception 'audit_log.prestataire_id incohérent avec entity_id';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Inventaire RLS — ajout de `document` sans réduire la couverture
-- ---------------------------------------------------------------------------

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
