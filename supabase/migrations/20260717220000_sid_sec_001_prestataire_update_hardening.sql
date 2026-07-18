-- SID-SEC-001 (finalisation) — immutabilité PostgREST + RPC nom + email Auth

-- 1. Retirer toute mutation / privilège superflu authenticated sur prestataire
--    (REVOKE ALL inclut MAINTAIN — résidu possible après grants partiels)
drop policy if exists prestataire_update_own on public.prestataire;

revoke all privileges on table public.prestataire from authenticated;
revoke all privileges on table public.prestataire from anon;

-- SELECT uniquement (pas INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN)
grant select on table public.prestataire to authenticated;

-- 2. Défense en profondeur : bloquer les colonnes système si UPDATE authenticated
create or replace function public.protect_prestataire_sensitive_columns()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- PostgREST authentifié : current_user = authenticated.
  -- Les RPC SECURITY DEFINER s'exécutent en tant que propriétaire (ex. postgres).
  if current_user = 'authenticated' then
    if new.email is distinct from old.email
      or new.created_at is distinct from old.created_at
      or new.user_id is distinct from old.user_id
      or new.subscription_status is distinct from old.subscription_status
      or new.pricing_version is distinct from old.pricing_version
      or new.subscription_started_at is distinct from old.subscription_started_at
      or new.early_access_price_locked_until is distinct from old.early_access_price_locked_until
      or new.platform_fee_basis_points is distinct from old.platform_fee_basis_points
      or new.profil_agent_defaut is distinct from old.profil_agent_defaut
      or new.nom is distinct from old.nom
    then
      raise exception 'Modification des champs prestataire interdite via PostgREST'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- 3. Onboarding : réconcilier l'email Auth si divergé ; ne pas écraser le commercial
create or replace function public.ensure_prestataire_for_current_user(p_nom text)
returns public.prestataire
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_email_confirmed_at timestamptz;
  v_nom text;
  v_auth_email text;
  v_row public.prestataire;
begin
  if v_uid is null then
    raise exception 'not_authenticated'
      using errcode = '42501';
  end if;

  select u.email, u.email_confirmed_at
    into v_email, v_email_confirmed_at
  from auth.users as u
  where u.id = v_uid;

  if v_email is null or btrim(v_email) = '' then
    raise exception 'auth_email_missing'
      using errcode = '22023';
  end if;

  if v_email_confirmed_at is null then
    raise exception 'email_not_confirmed'
      using errcode = '42501';
  end if;

  v_auth_email := lower(btrim(v_email));

  v_nom := btrim(regexp_replace(coalesce(p_nom, ''), '\s+', ' ', 'g'));

  if char_length(v_nom) = 0 then
    v_nom := 'Mon activité';
  end if;

  if char_length(v_nom) > 200 then
    v_nom := left(v_nom, 200);
  end if;

  select p.*
    into v_row
  from public.prestataire as p
  where p.user_id = v_uid;

  if found then
    -- Forme stockée non canonique (casse, espaces, divergence) → écrire v_auth_email exact
    if v_row.email is distinct from v_auth_email then
      update public.prestataire as p
      set email = v_auth_email
      where p.id = v_row.id
        and p.user_id = v_uid
      returning p.* into v_row;
    end if;

    return v_row;
  end if;

  begin
    insert into public.prestataire as p (user_id, email, nom)
    values (v_uid, v_auth_email, v_nom)
    returning p.* into v_row;
  exception
    when unique_violation then
      select p.*
        into v_row
      from public.prestataire as p
      where p.user_id = v_uid;

      if not found then
        raise;
      end if;

      if v_row.email is distinct from v_auth_email then
        update public.prestataire as p
        set email = v_auth_email
        where p.id = v_row.id
          and p.user_id = v_uid
        returning p.* into v_row;
      end if;
  end;

  return v_row;
end;
$$;

comment on function public.ensure_prestataire_for_current_user(text) is
  'SID-SEC-001 — crée ou retourne le prestataire courant. '
  'Canonicalise email (lower(btrim(auth.users.email))) si IS DISTINCT FROM ; '
  'ne touche pas aux champs commerciaux.';

revoke all on function public.ensure_prestataire_for_current_user(text) from public;
revoke all on function public.ensure_prestataire_for_current_user(text) from anon;
revoke all on function public.ensure_prestataire_for_current_user(text) from service_role;
grant execute on function public.ensure_prestataire_for_current_user(text) to authenticated;

-- 4. RPC étroite : seul le nom est éditable
create or replace function public.update_current_prestataire_name(p_nom text)
returns public.prestataire
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_nom text;
  v_row public.prestataire;
begin
  if v_uid is null then
    raise exception 'not_authenticated'
      using errcode = '42501';
  end if;

  v_nom := btrim(regexp_replace(coalesce(p_nom, ''), '\s+', ' ', 'g'));

  if char_length(v_nom) = 0 then
    raise exception 'prestataire_nom_required'
      using errcode = '22023';
  end if;

  if char_length(v_nom) > 200 then
    v_nom := left(v_nom, 200);
  end if;

  update public.prestataire as p
  set nom = v_nom
  where p.user_id = v_uid
  returning p.* into v_row;

  if not found then
    raise exception 'prestataire_not_found'
      using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

comment on function public.update_current_prestataire_name(text) is
  'SID-SEC-001 — met à jour uniquement prestataire.nom pour auth.uid().';

revoke all on function public.update_current_prestataire_name(text) from public;
revoke all on function public.update_current_prestataire_name(text) from anon;
revoke all on function public.update_current_prestataire_name(text) from service_role;
grant execute on function public.update_current_prestataire_name(text) to authenticated;

-- 5. Helper de test : ACL authenticated sur prestataire (service_role uniquement)
create or replace function public.sidian_prestataire_authenticated_privileges()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'select', has_table_privilege('authenticated', 'public.prestataire', 'SELECT'),
    'insert', has_table_privilege('authenticated', 'public.prestataire', 'INSERT'),
    'update', has_table_privilege('authenticated', 'public.prestataire', 'UPDATE'),
    'delete', has_table_privilege('authenticated', 'public.prestataire', 'DELETE'),
    'truncate', has_table_privilege('authenticated', 'public.prestataire', 'TRUNCATE'),
    'references', has_table_privilege('authenticated', 'public.prestataire', 'REFERENCES'),
    'trigger', has_table_privilege('authenticated', 'public.prestataire', 'TRIGGER'),
    'maintain', has_table_privilege('authenticated', 'public.prestataire', 'MAINTAIN'),
    'column_mutation_grants', exists (
      select 1
      from information_schema.column_privileges as cp
      where cp.grantee = 'authenticated'
        and cp.table_schema = 'public'
        and cp.table_name = 'prestataire'
        and cp.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    ),
    'mutation_policies', coalesce(
      (
        select jsonb_agg(p.polname order by p.polname)
        from pg_policy as p
        join pg_class as c on c.oid = p.polrelid
        join pg_namespace as n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = 'prestataire'
          and p.polcmd in ('a', 'w', 'd')
      ),
      '[]'::jsonb
    ),
    'anon_select', has_table_privilege('anon', 'public.prestataire', 'SELECT')
  );
$$;

comment on function public.sidian_prestataire_authenticated_privileges() is
  'SID-SEC-001 — assertion ACL prestataire pour tests service_role.';

revoke all on function public.sidian_prestataire_authenticated_privileges() from public;
revoke all on function public.sidian_prestataire_authenticated_privileges() from anon;
revoke all on function public.sidian_prestataire_authenticated_privileges() from authenticated;
grant execute on function public.sidian_prestataire_authenticated_privileges() to service_role;
