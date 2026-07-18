-- SID-PROD-001 — socle métier clients + paiements à recevoir
-- Extension de client_payeur / creance ; mutations via RPC uniquement.

-- 1. Colonnes
alter table public.client_payeur
  add column if not exists archived_at timestamptz;

alter table public.client_payeur
  add column if not exists creation_key uuid;

alter table public.creance
  add column if not exists libelle text;

alter table public.creance
  add column if not exists archived_at timestamptz;

alter table public.creance
  add column if not exists creation_key uuid;

-- Backfill création keys pour lignes éventuelles (reset local : tables vides)
update public.client_payeur
set creation_key = gen_random_uuid()
where creation_key is null;

update public.creance
set creation_key = gen_random_uuid()
where creation_key is null;

alter table public.client_payeur
  alter column creation_key set not null;

alter table public.creance
  alter column creation_key set not null;

alter table public.client_payeur
  alter column creation_key set default gen_random_uuid();

alter table public.creance
  alter column creation_key set default gen_random_uuid();

comment on column public.client_payeur.archived_at is
  'Archivage logique — filtre applicatif, hors policies RLS.';
comment on column public.client_payeur.creation_key is
  'Clé d''idempotence de création — unique par prestataire, immuable.';
comment on column public.creance.libelle is
  'Libellé métier court du paiement à recevoir.';
comment on column public.creance.archived_at is
  'Archivage logique — filtre applicatif, hors policies RLS.';
comment on column public.creance.creation_key is
  'Clé d''idempotence de création — unique par prestataire, immuable.';

alter table public.client_payeur
  drop constraint if exists client_payeur_creation_key_unique;
alter table public.client_payeur
  add constraint client_payeur_creation_key_unique
  unique (prestataire_id, creation_key);

alter table public.creance
  drop constraint if exists creance_creation_key_unique;
alter table public.creance
  add constraint creance_creation_key_unique
  unique (prestataire_id, creation_key);

alter table public.creance
  drop constraint if exists creance_libelle_length;
alter table public.creance
  add constraint creance_libelle_length
  check (libelle is null or char_length(libelle) <= 200);

alter table public.creance
  drop constraint if exists creance_devise_eur_only;
alter table public.creance
  add constraint creance_devise_eur_only
  check (devise = 'EUR');

alter table public.creance
  drop constraint if exists creance_montant_mvp_bounds;
alter table public.creance
  add constraint creance_montant_mvp_bounds
  check (montant >= 1 and montant <= 100000000);

-- 2. Retirer mutations PostgREST authenticated
drop policy if exists client_payeur_insert_scope on public.client_payeur;
drop policy if exists client_payeur_update_scope on public.client_payeur;
drop policy if exists client_payeur_delete_scope on public.client_payeur;

drop policy if exists creance_insert_scope on public.creance;
drop policy if exists creance_update_scope on public.creance;
drop policy if exists creance_delete_scope on public.creance;

revoke all privileges on table public.client_payeur from authenticated;
revoke all privileges on table public.client_payeur from anon;
grant select on table public.client_payeur to authenticated;

revoke all privileges on table public.creance from authenticated;
revoke all privileges on table public.creance from anon;
grant select on table public.creance to authenticated;

-- 3. Helpers internes (aucun EXECUTE public)
create or replace function public.require_current_prestataire_id()
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_id uuid := public.current_prestataire_id();
begin
  if v_id is null then
    raise exception 'not_authenticated'
      using errcode = '42501';
  end if;
  return v_id;
end;
$$;

revoke all on function public.require_current_prestataire_id() from public;
revoke all on function public.require_current_prestataire_id() from anon;
revoke all on function public.require_current_prestataire_id() from authenticated;
revoke all on function public.require_current_prestataire_id() from service_role;

create or replace function public.normalize_person_name(p_nom text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_nom text;
begin
  v_nom := btrim(regexp_replace(coalesce(p_nom, ''), '\s+', ' ', 'g'));
  if char_length(v_nom) = 0 then
    raise exception 'nom_required'
      using errcode = '22023';
  end if;
  if char_length(v_nom) > 200 then
    v_nom := left(v_nom, 200);
  end if;
  return v_nom;
end;
$$;

revoke all on function public.normalize_person_name(text) from public;
revoke all on function public.normalize_person_name(text) from anon;
revoke all on function public.normalize_person_name(text) from authenticated;
revoke all on function public.normalize_person_name(text) from service_role;

create or replace function public.canonicalize_email(p_email text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_email text;
  v_local text;
  v_domain text;
  v_at int;
  v_labels text[];
  v_label text;
  v_i int;
begin
  v_email := lower(btrim(coalesce(p_email, '')));

  if char_length(v_email) = 0 then
    raise exception 'email_invalid'
      using errcode = '22023';
  end if;

  if char_length(v_email) > 254 then
    raise exception 'email_invalid'
      using errcode = '22023';
  end if;

  if v_email ~ '[[:space:]]' then
    raise exception 'email_invalid'
      using errcode = '22023';
  end if;

  v_at := position('@' in v_email);
  if v_at < 2 then
    raise exception 'email_invalid'
      using errcode = '22023';
  end if;

  v_local := left(v_email, v_at - 1);
  v_domain := substr(v_email, v_at + 1);

  if char_length(v_local) = 0 or char_length(v_domain) = 0 then
    raise exception 'email_invalid'
      using errcode = '22023';
  end if;

  if char_length(v_local) > 64 or char_length(v_domain) > 253 then
    raise exception 'email_invalid'
      using errcode = '22023';
  end if;

  if position('@' in v_domain) > 0 then
    raise exception 'email_invalid'
      using errcode = '22023';
  end if;

  -- local : caractères usuels, pas de point initial / final / consécutif
  if v_local !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+$' then
    raise exception 'email_invalid'
      using errcode = '22023';
  end if;

  if left(v_local, 1) = '.'
     or right(v_local, 1) = '.'
     or position('..' in v_local) > 0
  then
    raise exception 'email_invalid'
      using errcode = '22023';
  end if;

  -- domaine : au moins un point, pas de points initiaux/finaux/consécutifs
  if position('.' in v_domain) = 0
     or left(v_domain, 1) = '.'
     or right(v_domain, 1) = '.'
     or position('..' in v_domain) > 0
  then
    raise exception 'email_invalid'
      using errcode = '22023';
  end if;

  v_labels := string_to_array(v_domain, '.');
  if coalesce(array_length(v_labels, 1), 0) < 2 then
    raise exception 'email_invalid'
      using errcode = '22023';
  end if;

  for v_i in 1 .. array_length(v_labels, 1) loop
    v_label := v_labels[v_i];

    if v_label is null
       or char_length(v_label) = 0
       or char_length(v_label) > 63
    then
      raise exception 'email_invalid'
        using errcode = '22023';
    end if;

    if left(v_label, 1) = '-' or right(v_label, 1) = '-' then
      raise exception 'email_invalid'
        using errcode = '22023';
    end if;

    if v_label !~ '^[a-z0-9-]+$' then
      raise exception 'email_invalid'
        using errcode = '22023';
    end if;

    -- TLD : lettres uniquement, ≥ 2
    if v_i = array_length(v_labels, 1) and v_label !~ '^[a-z]{2,}$' then
      raise exception 'email_invalid'
        using errcode = '22023';
    end if;
  end loop;

  return v_email;
end;
$$;

revoke all on function public.canonicalize_email(text) from public;
revoke all on function public.canonicalize_email(text) from anon;
revoke all on function public.canonicalize_email(text) from authenticated;
revoke all on function public.canonicalize_email(text) from service_role;

create or replace function public.normalize_creance_montant(p_montant bigint)
returns bigint
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_montant is null or p_montant < 1 or p_montant > 100000000 then
    raise exception 'montant_invalid'
      using errcode = '22023';
  end if;
  return p_montant;
end;
$$;

revoke all on function public.normalize_creance_montant(bigint) from public;
revoke all on function public.normalize_creance_montant(bigint) from anon;
revoke all on function public.normalize_creance_montant(bigint) from authenticated;
revoke all on function public.normalize_creance_montant(bigint) from service_role;

create or replace function public.normalize_creance_devise(p_devise text)
returns char(3)
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  -- Exactement 'EUR' après trim — refuse eur/USD/ZZZ/vide (pas de case-fold).
  v_devise text := btrim(coalesce(p_devise, ''));
begin
  if v_devise is distinct from 'EUR' then
    raise exception 'devise_invalid'
      using errcode = '22023';
  end if;
  return 'EUR';
end;
$$;

revoke all on function public.normalize_creance_devise(text) from public;
revoke all on function public.normalize_creance_devise(text) from anon;
revoke all on function public.normalize_creance_devise(text) from authenticated;
revoke all on function public.normalize_creance_devise(text) from service_role;

-- 4. RPC client_payeur
create or replace function public.create_current_client_payeur(
  p_nom text,
  p_email text,
  p_creation_key uuid
)
returns public.client_payeur
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_prestataire_id uuid := public.require_current_prestataire_id();
  v_nom text := public.normalize_person_name(p_nom);
  v_email text := public.canonicalize_email(p_email);
  v_row public.client_payeur;
begin
  if p_creation_key is null then
    raise exception 'creation_key_required'
      using errcode = '22023';
  end if;

  select c.*
    into v_row
  from public.client_payeur as c
  where c.prestataire_id = v_prestataire_id
    and c.creation_key = p_creation_key;

  if found then
    if v_row.nom is distinct from v_nom
      or v_row.email is distinct from v_email
    then
      raise exception 'idempotency_payload_conflict'
        using errcode = '22023';
    end if;
    return v_row;
  end if;

  begin
    insert into public.client_payeur as c (
      prestataire_id, nom, email, creation_key
    )
    values (v_prestataire_id, v_nom, v_email, p_creation_key)
    returning c.* into v_row;
  exception
    when unique_violation then
      select c.*
        into v_row
      from public.client_payeur as c
      where c.prestataire_id = v_prestataire_id
        and c.creation_key = p_creation_key;

      if not found then
        raise;
      end if;

      if v_row.nom is distinct from v_nom
        or v_row.email is distinct from v_email
      then
        raise exception 'idempotency_payload_conflict'
          using errcode = '22023';
      end if;
  end;

  return v_row;
end;
$$;

comment on function public.create_current_client_payeur(text, text, uuid) is
  'SID-PROD-001 — crée un client_payeur idempotent pour le prestataire courant.';

revoke all on function public.create_current_client_payeur(text, text, uuid) from public;
revoke all on function public.create_current_client_payeur(text, text, uuid) from anon;
revoke all on function public.create_current_client_payeur(text, text, uuid) from service_role;
grant execute on function public.create_current_client_payeur(text, text, uuid) to authenticated;

-- Drop old 2-arg signature if present from prior draft
drop function if exists public.create_current_client_payeur(text, text);

create or replace function public.update_current_client_payeur(
  p_id uuid,
  p_nom text,
  p_email text
)
returns public.client_payeur
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_prestataire_id uuid := public.require_current_prestataire_id();
  v_row public.client_payeur;
begin
  update public.client_payeur as c
  set
    nom = public.normalize_person_name(p_nom),
    email = public.canonicalize_email(p_email)
  where c.id = p_id
    and c.prestataire_id = v_prestataire_id
    and c.archived_at is null
  returning c.* into v_row;

  if not found then
    raise exception 'client_payeur_not_found'
      using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

revoke all on function public.update_current_client_payeur(uuid, text, text) from public;
revoke all on function public.update_current_client_payeur(uuid, text, text) from anon;
revoke all on function public.update_current_client_payeur(uuid, text, text) from service_role;
grant execute on function public.update_current_client_payeur(uuid, text, text) to authenticated;

create or replace function public.archive_current_client_payeur(p_id uuid)
returns public.client_payeur
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_prestataire_id uuid := public.require_current_prestataire_id();
  v_row public.client_payeur;
  v_active_count integer;
begin
  -- Verrou ligne client (même cible que create_current_creance) avant toute décision
  select c.*
    into v_row
  from public.client_payeur as c
  where c.id = p_id
    and c.prestataire_id = v_prestataire_id
  for update;

  if not found then
    raise exception 'client_payeur_not_found'
      using errcode = 'P0002';
  end if;


  -- Idempotent : déjà archivé → retourne la ligne
  if v_row.archived_at is not null then
    return v_row;
  end if;

  select count(*)::integer
    into v_active_count
  from public.creance as cr
  where cr.client_payeur_id = p_id
    and cr.prestataire_id = v_prestataire_id
    and cr.archived_at is null;

  if v_active_count > 0 then
    raise exception 'CLIENT_HAS_ACTIVE_CREANCES'
      using errcode = 'P0001';
  end if;

  update public.client_payeur as c
  set archived_at = timezone('utc', now())
  where c.id = p_id
    and c.prestataire_id = v_prestataire_id
    and c.archived_at is null
  returning c.* into v_row;

  return v_row;
end;
$$;

comment on function public.archive_current_client_payeur(uuid) is
  'SID-PROD-001 — archive un client s''il n''a aucune créance active (non archivée). '
  'Verrouille client_payeur FOR UPDATE (invariant concurrent create/update/archive). '
  'Idempotent si déjà archivé. Erreur CLIENT_HAS_ACTIVE_CREANCES sinon.';

revoke all on function public.archive_current_client_payeur(uuid) from public;
revoke all on function public.archive_current_client_payeur(uuid) from anon;
revoke all on function public.archive_current_client_payeur(uuid) from service_role;
grant execute on function public.archive_current_client_payeur(uuid) to authenticated;

-- 5. RPC creance
drop function if exists public.create_current_creance(uuid, bigint, date, text, text, char);
drop function if exists public.create_current_creance(uuid, bigint, date, text, text, text);
drop function if exists public.update_current_creance_draft(uuid, uuid, bigint, date, text, text, char);
drop function if exists public.update_current_creance_draft(uuid, uuid, bigint, date, text, text, text);

create or replace function public.create_current_creance(
  p_client_payeur_id uuid,
  p_montant bigint,
  p_date_echeance date,
  p_creation_key uuid,
  p_libelle text default null,
  p_reference_externe text default null,
  p_devise text default 'EUR'
)
returns public.creance
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_prestataire_id uuid := public.require_current_prestataire_id();
  v_montant bigint := public.normalize_creance_montant(p_montant);
  v_devise char(3) := public.normalize_creance_devise(p_devise);
  v_libelle text;
  v_reference text;
  v_client public.client_payeur;
  v_row public.creance;
begin
  if p_creation_key is null then
    raise exception 'creation_key_required'
      using errcode = '22023';
  end if;

  if p_date_echeance is null then
    raise exception 'date_echeance_required'
      using errcode = '22023';
  end if;

  if extract(year from p_date_echeance) < 2000
     or extract(year from p_date_echeance) > 2100
  then
    raise exception 'date_echeance_invalid'
      using errcode = '22023';
  end if;

  v_libelle := nullif(btrim(regexp_replace(coalesce(p_libelle, ''), '\s+', ' ', 'g')), '');
  if v_libelle is not null and char_length(v_libelle) > 200 then
    v_libelle := left(v_libelle, 200);
  end if;

  v_reference := nullif(btrim(coalesce(p_reference_externe, '')), '');
  if v_reference is not null and char_length(v_reference) > 200 then
    v_reference := left(v_reference, 200);
  end if;

  -- Verrou ligne client (même cible que archive_current_client_payeur)
  select c.*
    into v_client
  from public.client_payeur as c
  where c.id = p_client_payeur_id
    and c.prestataire_id = v_prestataire_id
  for update;

  if not found then
    raise exception 'client_payeur_not_found'
      using errcode = 'P0002';
  end if;


  if v_client.archived_at is not null then
    raise exception 'client_payeur_not_found'
      using errcode = 'P0002';
  end if;

  select cr.*
    into v_row
  from public.creance as cr
  where cr.prestataire_id = v_prestataire_id
    and cr.creation_key = p_creation_key;

  if found then
    if v_row.client_payeur_id is distinct from p_client_payeur_id
      or v_row.montant is distinct from v_montant
      or v_row.date_echeance is distinct from p_date_echeance
      or v_row.libelle is distinct from v_libelle
      or v_row.reference_externe is distinct from v_reference
      or v_row.devise is distinct from v_devise
    then
      raise exception 'idempotency_payload_conflict'
        using errcode = '22023';
    end if;
    return v_row;
  end if;

  begin
    insert into public.creance as cr (
      prestataire_id,
      client_payeur_id,
      montant,
      devise,
      origine,
      reference_externe,
      date_echeance,
      etat,
      libelle,
      creation_key
    )
    values (
      v_prestataire_id,
      p_client_payeur_id,
      v_montant,
      v_devise,
      'import_manuel',
      v_reference,
      p_date_echeance,
      'BROUILLON',
      v_libelle,
      p_creation_key
    )
    returning cr.* into v_row;
  exception
    when unique_violation then
      select cr.*
        into v_row
      from public.creance as cr
      where cr.prestataire_id = v_prestataire_id
        and cr.creation_key = p_creation_key;

      if not found then
        raise;
      end if;

      if v_row.client_payeur_id is distinct from p_client_payeur_id
        or v_row.montant is distinct from v_montant
        or v_row.date_echeance is distinct from p_date_echeance
        or v_row.libelle is distinct from v_libelle
        or v_row.reference_externe is distinct from v_reference
        or v_row.devise is distinct from v_devise
      then
        raise exception 'idempotency_payload_conflict'
          using errcode = '22023';
      end if;
  end;

  return v_row;
end;
$$;

comment on function public.create_current_creance(uuid, bigint, date, uuid, text, text, text) is
  'SID-PROD-001 — crée un paiement à recevoir BROUILLON idempotent (EUR uniquement). '
  'Verrouille client_payeur FOR UPDATE (invariant concurrent create/update/archive).';

revoke all on function public.create_current_creance(uuid, bigint, date, uuid, text, text, text) from public;
revoke all on function public.create_current_creance(uuid, bigint, date, uuid, text, text, text) from anon;
revoke all on function public.create_current_creance(uuid, bigint, date, uuid, text, text, text) from service_role;
grant execute on function public.create_current_creance(uuid, bigint, date, uuid, text, text, text) to authenticated;

create or replace function public.update_current_creance_draft(
  p_id uuid,
  p_client_payeur_id uuid,
  p_montant bigint,
  p_date_echeance date,
  p_libelle text default null,
  p_reference_externe text default null,
  p_devise text default 'EUR'
)
returns public.creance
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_prestataire_id uuid := public.require_current_prestataire_id();
  v_montant bigint := public.normalize_creance_montant(p_montant);
  v_devise char(3) := public.normalize_creance_devise(p_devise);
  v_libelle text;
  v_reference text;
  v_existing public.creance;
  v_target public.client_payeur;
  v_row public.creance;
begin
  if p_date_echeance is null then
    raise exception 'date_echeance_required'
      using errcode = '22023';
  end if;

  if extract(year from p_date_echeance) < 2000
     or extract(year from p_date_echeance) > 2100
  then
    raise exception 'date_echeance_invalid'
      using errcode = '22023';
  end if;

  v_libelle := nullif(btrim(regexp_replace(coalesce(p_libelle, ''), '\s+', ' ', 'g')), '');
  if v_libelle is not null and char_length(v_libelle) > 200 then
    v_libelle := left(v_libelle, 200);
  end if;

  v_reference := nullif(btrim(coalesce(p_reference_externe, '')), '');
  if v_reference is not null and char_length(v_reference) > 200 then
    v_reference := left(v_reference, 200);
  end if;

  -- 1. Verrouiller la créance cible (tenant) avant toute décision
  select cr.*
    into v_existing
  from public.creance as cr
  where cr.id = p_id
    and cr.prestataire_id = v_prestataire_id
  for update;

  if not found then
    raise exception 'creance_draft_not_found'
      using errcode = 'P0002';
  end if;

  if v_existing.archived_at is not null or v_existing.etat is distinct from 'BROUILLON' then
    raise exception 'creance_draft_not_found'
      using errcode = 'P0002';
  end if;

  -- 2. Verrouiller le client cible (même ligne que create/archive) — ordre :
  --    créance puis client_payeur (pas de verrou multi-clients : seul le cible
  --    est requis pour l'invariant « pas de créance active sur client archivé »).
  select c.*
    into v_target
  from public.client_payeur as c
  where c.id = p_client_payeur_id
    and c.prestataire_id = v_prestataire_id
  for update;

  if not found then
    raise exception 'client_payeur_not_found'
      using errcode = 'P0002';
  end if;

  if v_target.archived_at is not null then
    raise exception 'client_payeur_not_found'
      using errcode = 'P0002';
  end if;

  update public.creance as cr
  set
    client_payeur_id = p_client_payeur_id,
    montant = v_montant,
    devise = v_devise,
    date_echeance = p_date_echeance,
    libelle = v_libelle,
    reference_externe = v_reference,
    updated_at = timezone('utc', now())
  where cr.id = p_id
    and cr.prestataire_id = v_prestataire_id
    and cr.etat = 'BROUILLON'
    and cr.archived_at is null
  returning cr.* into v_row;

  if not found then
    raise exception 'creance_draft_not_found'
      using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

comment on function public.update_current_creance_draft(uuid, uuid, bigint, date, text, text, text) is
  'SID-PROD-001 — met à jour un brouillon. Verrouille creance puis client_payeur cible FOR UPDATE '
  '(invariant concurrent : aucune créance active sur un client archivé).';

revoke all on function public.update_current_creance_draft(uuid, uuid, bigint, date, text, text, text) from public;
revoke all on function public.update_current_creance_draft(uuid, uuid, bigint, date, text, text, text) from anon;
revoke all on function public.update_current_creance_draft(uuid, uuid, bigint, date, text, text, text) from service_role;
grant execute on function public.update_current_creance_draft(uuid, uuid, bigint, date, text, text, text) to authenticated;

create or replace function public.archive_current_creance(p_id uuid)
returns public.creance
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_prestataire_id uuid := public.require_current_prestataire_id();
  v_row public.creance;
begin
  select cr.*
    into v_row
  from public.creance as cr
  where cr.id = p_id
    and cr.prestataire_id = v_prestataire_id;

  if not found then
    raise exception 'creance_not_found'
      using errcode = 'P0002';
  end if;

  if v_row.archived_at is not null then
    return v_row;
  end if;

  update public.creance as cr
  set
    archived_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where cr.id = p_id
    and cr.prestataire_id = v_prestataire_id
    and cr.archived_at is null
  returning cr.* into v_row;

  return v_row;
end;
$$;

revoke all on function public.archive_current_creance(uuid) from public;
revoke all on function public.archive_current_creance(uuid) from anon;
revoke all on function public.archive_current_creance(uuid) from service_role;
grant execute on function public.archive_current_creance(uuid) to authenticated;

-- 6. Assertion ACL tests (service_role)
create or replace function public.sidian_table_authenticated_privileges(p_table text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_rel text := format('%I.%I', 'public', p_table);
begin
  if p_table not in ('client_payeur', 'creance', 'prestataire') then
    raise exception 'table_not_allowed'
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'select', has_table_privilege('authenticated', v_rel, 'SELECT'),
    'insert', has_table_privilege('authenticated', v_rel, 'INSERT'),
    'update', has_table_privilege('authenticated', v_rel, 'UPDATE'),
    'delete', has_table_privilege('authenticated', v_rel, 'DELETE'),
    'truncate', has_table_privilege('authenticated', v_rel, 'TRUNCATE'),
    'references', has_table_privilege('authenticated', v_rel, 'REFERENCES'),
    'trigger', has_table_privilege('authenticated', v_rel, 'TRIGGER'),
    'maintain', has_table_privilege('authenticated', v_rel, 'MAINTAIN'),
    'anon_select', has_table_privilege('anon', v_rel, 'SELECT'),
    'column_mutation_grants', exists (
      select 1
      from information_schema.column_privileges as cp
      where cp.grantee = 'authenticated'
        and cp.table_schema = 'public'
        and cp.table_name = p_table
        and cp.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    ),
    'mutation_policies', coalesce(
      (
        select jsonb_agg(p.polname order by p.polname)
        from pg_policy as p
        join pg_class as c on c.oid = p.polrelid
        join pg_namespace as n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = p_table
          and p.polcmd in ('a', 'w', 'd')
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.sidian_table_authenticated_privileges(text) from public;
revoke all on function public.sidian_table_authenticated_privileges(text) from anon;
revoke all on function public.sidian_table_authenticated_privileges(text) from authenticated;
grant execute on function public.sidian_table_authenticated_privileges(text) to service_role;
