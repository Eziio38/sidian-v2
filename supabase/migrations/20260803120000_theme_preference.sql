-- SID-UI-THEME — préférence d'apparence par compte (Clair / Sombre / Automatique)
--
-- Le thème par défaut d'un nouveau compte est 'light' : c'est le thème de
-- référence du produit. 'system' suit prefers-color-scheme côté client et
-- n'est jamais le défaut.
--
-- La colonne est protégée comme les autres champs prestataire : aucune
-- écriture directe via PostgREST, uniquement via la RPC dédiée ci-dessous.

create type public.theme_preference as enum (
  'light',
  'dark',
  'system'
);

alter table public.prestataire
  add column if not exists theme_preference public.theme_preference not null default 'light';

comment on column public.prestataire.theme_preference is
  'Préférence d''apparence du compte. Défaut light (thème de référence). system suit le réglage OS côté client.';

-- Le trigger de protection doit couvrir la nouvelle colonne : elle ne doit
-- jamais être modifiable par un UPDATE PostgREST direct.
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
      or new.theme_preference is distinct from old.theme_preference
      or new.nom is distinct from old.nom
    then
      raise exception 'Modification des champs prestataire interdite via PostgREST'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- Écriture de la préférence pour le prestataire courant, dérivé de auth.uid().
-- Aucun identifiant de propriétaire n'est accepté depuis l'appelant.
-- Pas d'audit_log : une préférence d'affichage n'est pas une action sensible.
create or replace function public.set_current_prestataire_theme_preference(
  p_theme public.theme_preference
)
returns public.theme_preference
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_theme public.theme_preference;
begin
  if v_uid is null then
    raise exception 'not_authenticated'
      using errcode = '42501';
  end if;

  if p_theme is null then
    raise exception 'theme_preference_required'
      using errcode = '22023';
  end if;

  update public.prestataire as p
  set theme_preference = p_theme
  where p.user_id = v_uid
  returning p.theme_preference into v_theme;

  if not found then
    raise exception 'prestataire_not_found'
      using errcode = 'P0002';
  end if;

  return v_theme;
end;
$$;

comment on function public.set_current_prestataire_theme_preference(public.theme_preference) is
  'Enregistre la préférence d''apparence du prestataire courant (auth.uid()). Idempotente.';

revoke all on function public.set_current_prestataire_theme_preference(public.theme_preference) from public;
revoke all on function public.set_current_prestataire_theme_preference(public.theme_preference) from anon;
revoke all on function public.set_current_prestataire_theme_preference(public.theme_preference) from service_role;
grant execute on function public.set_current_prestataire_theme_preference(public.theme_preference) to authenticated;
