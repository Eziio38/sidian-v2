-- SID-SEC-001 — onboarding prestataire via RPC étroite (pas d'INSERT authenticated)

-- 1. Retirer l'INSERT direct authenticated
drop policy if exists prestataire_insert_own on public.prestataire;

revoke insert on table public.prestataire from authenticated;

-- Réaffirmer les privilèges restants sans élargir
grant select, update, delete on table public.prestataire to authenticated;

-- 2. RPC d'onboarding : auth.uid() + email Auth confirmé + nom borné uniquement
create or replace function public.ensure_prestataire_for_current_user(p_nom text)
returns public.prestataire
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_email_confirmed_at timestamptz;
  v_nom text;
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
    return v_row;
  end if;

  begin
    insert into public.prestataire (user_id, email, nom)
    values (v_uid, lower(btrim(v_email)), v_nom)
    returning * into v_row;
  exception
    when unique_violation then
      select p.*
        into v_row
      from public.prestataire as p
      where p.user_id = v_uid;

      if not found then
        raise;
      end if;
  end;

  return v_row;
end;
$$;

comment on function public.ensure_prestataire_for_current_user(text) is
  'SID-SEC-001 — crée ou retourne le prestataire du JWT courant. '
  'user_id/email dérivés de auth.users ; attributs commerciaux via défauts SQL.';

revoke all on function public.ensure_prestataire_for_current_user(text) from public;
revoke all on function public.ensure_prestataire_for_current_user(text) from anon;
grant execute on function public.ensure_prestataire_for_current_user(text)
  to authenticated, service_role;
