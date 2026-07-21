-- SID-PROD-003 — profil prestataire et première étape d'onboarding

alter table public.prestataire
  add column if not exists onboarding_profile_completed_at timestamptz;

comment on column public.prestataire.onboarding_profile_completed_at is
  'Première configuration explicite du nom commercial et du profil agent.';

create or replace function public.protect_prestataire_sensitive_columns()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
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
      or new.onboarding_profile_completed_at is distinct from old.onboarding_profile_completed_at
      or new.nom is distinct from old.nom
    then
      raise exception 'Modification des champs prestataire interdite via PostgREST'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.configure_current_prestataire_profile(
  p_nom text,
  p_profil_agent public.profil_agent_defaut
)
returns public.prestataire
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_nom text;
  v_row public.prestataire;
  v_initial_configuration boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated'
      using errcode = '42501';
  end if;

  if p_profil_agent is null then
    raise exception 'prestataire_profile_required'
      using errcode = '22023';
  end if;

  v_nom := btrim(regexp_replace(coalesce(p_nom, ''), '\s+', ' ', 'g'));

  if char_length(v_nom) < 2 or char_length(v_nom) > 200 then
    raise exception 'prestataire_name_invalid'
      using errcode = '22023';
  end if;

  select p.*
    into v_row
  from public.prestataire as p
  where p.user_id = v_uid
  for update;

  if not found then
    raise exception 'prestataire_not_found'
      using errcode = 'P0002';
  end if;

  v_initial_configuration := v_row.onboarding_profile_completed_at is null;

  if v_row.nom is not distinct from v_nom
    and v_row.profil_agent_defaut is not distinct from p_profil_agent
    and not v_initial_configuration
  then
    return v_row;
  end if;

  update public.prestataire as p
  set
    nom = v_nom,
    profil_agent_defaut = p_profil_agent,
    onboarding_profile_completed_at = coalesce(
      p.onboarding_profile_completed_at,
      clock_timestamp()
    )
  where p.id = v_row.id
    and p.user_id = v_uid
  returning p.* into v_row;

  insert into public.audit_log (
    prestataire_id,
    actor_type,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    v_row.id,
    'human',
    'prestataire.profile_configured',
    'prestataire',
    v_row.id,
    jsonb_build_object(
      'profil_agent', v_row.profil_agent_defaut,
      'initial_configuration', v_initial_configuration
    )
  );

  return v_row;
end;
$$;

comment on function public.configure_current_prestataire_profile(text, public.profil_agent_defaut) is
  'Configure le profil du prestataire courant depuis auth.uid(), avec verrou et audit idempotent.';

revoke all on function public.configure_current_prestataire_profile(text, public.profil_agent_defaut) from public;
revoke all on function public.configure_current_prestataire_profile(text, public.profil_agent_defaut) from anon;
revoke all on function public.configure_current_prestataire_profile(text, public.profil_agent_defaut) from service_role;
grant execute on function public.configure_current_prestataire_profile(text, public.profil_agent_defaut) to authenticated;
