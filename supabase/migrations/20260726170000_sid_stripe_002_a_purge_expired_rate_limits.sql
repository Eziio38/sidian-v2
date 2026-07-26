-- SID-STRIPE-002-A — purge rate-limit : cutoff timestamptz correct + horloge injectable.
--
-- Cause racine du flaky « événement expiré encore présent » :
--   purge_expired_public_rate_limits respecte un batch (ORDER BY expires_at LIMIT n).
--   Un appel unique avec p_batch_size=100 ne garantit PAS la suppression d'un
--   événement fraîchement expiré s'il existe un backlog plus ancien.
--
-- Correctifs :
--   1. Comparer avec un timestamptz natif (now() / p_now), jamais timezone('utc', now())
--      qui renvoie un timestamp WITHOUT time zone et dépend du TimeZone de session.
--   2. Exposer p_now pour des tests de cutoff déterministes (before / at / after).
--   3. Ordre stable (expires_at, id) pour des lots reproductibles.

drop function if exists public.purge_expired_public_rate_limits(integer);

create or replace function public.purge_expired_public_rate_limits(
  p_batch_size integer default 1000,
  p_now timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_deleted integer;
  v_now timestamptz := coalesce(p_now, now());
begin
  if p_batch_size < 1 or p_batch_size > 10000 then
    raise exception 'rate_limit_purge_batch_invalid' using errcode = '22023';
  end if;

  with expired as (
    select e.id
    from public.public_rate_limit_event e
    where e.expires_at <= v_now
    order by e.expires_at asc, e.id asc
    limit p_batch_size
    for update skip locked
  )
  delete from public.public_rate_limit_event e
  using expired
  where e.id = expired.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.purge_expired_public_rate_limits(integer, timestamptz) is
  'Purge par lots les public_rate_limit_event expirés (expires_at <= now). '
  'Les appelants doivent boucler jusqu''à 0. p_now permet un cutoff déterministe.';

revoke all on function public.purge_expired_public_rate_limits(integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.purge_expired_public_rate_limits(integer, timestamptz)
  to service_role;
