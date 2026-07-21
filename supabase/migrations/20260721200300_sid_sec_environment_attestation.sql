-- SID-SEC Phase 1 — attestation cryptographique de l'environnement Supabase.
--
-- Un JWT dédié, signé par le projet Supabase ciblé, porte uniquement le rôle
-- ci-dessous, l'environnement Sidian et la référence projet. PostgREST vérifie
-- sa signature avant d'autoriser cette RPC. Une seconde RPC read-only vérifie
-- que la service_role configurée appartient au même projet.

do $$
declare
  v_role pg_catalog.pg_roles;
begin
  select r.*
    into v_role
  from pg_catalog.pg_roles as r
  where r.rolname = 'sidian_environment_attestor';

  if not found then
    create role sidian_environment_attestor
      nologin
      noinherit
      nobypassrls;
  elsif v_role.rolcanlogin or v_role.rolinherit or v_role.rolbypassrls then
    raise exception 'sidian_environment_attestor_role_incompatible';
  end if;
end;
$$;

revoke sidian_environment_attestor from anon, authenticated, service_role;
grant sidian_environment_attestor to authenticator
  with inherit false, set true;

grant usage on schema public to sidian_environment_attestor;

create or replace function public.attest_sidian_environment()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_claims jsonb;
  v_environment text;
  v_project_ref text;
begin
  begin
    v_claims := nullif(
      current_setting('request.jwt.claims', true),
      ''
    )::jsonb;
  exception
    when others then
      raise exception 'environment_attestation_invalid'
        using errcode = '42501';
  end;

  v_environment := v_claims->>'sidian_environment';
  v_project_ref := v_claims->>'sidian_project_ref';

  if v_claims->>'role' is distinct from 'sidian_environment_attestor'
    or v_environment is null
    or v_environment not in ('local', 'staging', 'production')
    or v_project_ref is null
    or v_project_ref !~ '^[a-z0-9]{8,64}$'
  then
    raise exception 'environment_attestation_invalid'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'environment', v_environment,
    'project_ref', v_project_ref
  );
end;
$$;

comment on function public.attest_sidian_environment() is
  'Retourne uniquement les claims environnementaux d’un JWT minimal dont la signature a été validée par le projet Supabase ciblé.';

revoke all on function public.attest_sidian_environment()
  from public, anon, authenticated, service_role;
grant execute on function public.attest_sidian_environment()
  to sidian_environment_attestor;

create or replace function public.service_role_healthcheck()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select true;
$$;

comment on function public.service_role_healthcheck() is
  'Primitive read-only minimale prouvant que la service_role appartient au projet Supabase ciblé.';

revoke all on function public.service_role_healthcheck()
  from public, anon, authenticated, sidian_environment_attestor;
grant execute on function public.service_role_healthcheck()
  to service_role;
