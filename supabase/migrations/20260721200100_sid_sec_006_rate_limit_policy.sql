-- SID-SEC-006 — politique persistante Auth, callback et webhook Stripe.
-- Les sujets reçus sont exclusivement des pseudonymes HMAC SHA-256 produits
-- côté serveur. La table privée, ses ACL et sa RLS restent inchangées.

create or replace function public.consume_public_rate_limit(
  p_category public.public_rate_limit_category,
  p_subject_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_window interval;
  v_limit integer;
  v_count integer;
  v_reset_at timestamptz;
begin
  if p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'rate_limit_subject_invalid' using errcode = '22023';
  end if;

  case p_category
    when 'link_resolution_ip' then
      v_limit := 30;
      v_window := interval '10 minutes';
    when 'link_resolution_token' then
      v_limit := 60;
      v_window := interval '10 minutes';
    when 'checkout_creation_ip' then
      v_limit := 5;
      v_window := interval '10 minutes';
    when 'checkout_new_operation_link' then
      v_limit := 3;
      v_window := interval '10 minutes';
    when 'auth_signup_ip' then
      v_limit := 10;
      v_window := interval '10 minutes';
    when 'auth_signup_email' then
      v_limit := 5;
      v_window := interval '10 minutes';
    when 'auth_signin_ip' then
      v_limit := 30;
      v_window := interval '10 minutes';
    when 'auth_signin_email' then
      v_limit := 10;
      v_window := interval '10 minutes';
    when 'auth_password_reset_ip' then
      v_limit := 10;
      v_window := interval '30 minutes';
    when 'auth_password_reset_email' then
      v_limit := 3;
      v_window := interval '30 minutes';
    when 'auth_password_update_ip' then
      v_limit := 10;
      v_window := interval '10 minutes';
    when 'auth_password_update_user' then
      v_limit := 5;
      v_window := interval '10 minutes';
    when 'auth_callback_ip' then
      v_limit := 30;
      v_window := interval '10 minutes';
    when 'auth_callback_code' then
      v_limit := 5;
      v_window := interval '10 minutes';
    when 'stripe_webhook_ip' then
      -- Préserve les rafales Stripe légitimes tout en bornant les appels d'une
      -- même origine de plateforme avant vérification cryptographique.
      v_limit := 300;
      v_window := interval '1 minute';
    else
      raise exception 'rate_limit_category_invalid' using errcode = '22023';
  end case;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_category::text || ':' || p_subject_hash, 0)
  );

  delete from public.public_rate_limit_event e
  where e.category = p_category
    and e.subject_hash = p_subject_hash
    and e.expires_at <= v_now;

  select count(*)::integer, min(e.expires_at)
    into v_count, v_reset_at
  from public.public_rate_limit_event e
  where e.category = p_category
    and e.subject_hash = p_subject_hash
    and e.expires_at > v_now;

  if v_count >= v_limit then
    return jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'reset_at', v_reset_at
    );
  end if;

  insert into public.public_rate_limit_event (
    category,
    subject_hash,
    occurred_at,
    expires_at
  )
  values (p_category, p_subject_hash, v_now, v_now + v_window);

  v_count := v_count + 1;
  v_reset_at := coalesce(v_reset_at, v_now + v_window);

  return jsonb_build_object(
    'allowed', true,
    'remaining', v_limit - v_count,
    'reset_at', v_reset_at
  );
end;
$$;

comment on function public.consume_public_rate_limit(
  public.public_rate_limit_category, text
) is
  'Consomme atomiquement un quota persistant privé à partir d’un sujet HMAC SHA-256. Couvre liens publics, Auth, callback et webhook Stripe.';

revoke all on function public.consume_public_rate_limit(
  public.public_rate_limit_category, text
) from public, anon, authenticated;
grant execute on function public.consume_public_rate_limit(
  public.public_rate_limit_category, text
) to service_role;
