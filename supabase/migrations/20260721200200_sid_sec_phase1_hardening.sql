-- SID-SEC Phase 1 — correctifs de revue indépendants.
--
-- Migration additive :
--   * journalise atomiquement chaque décision d'approbation ;
--   * rend l'expiration rejouable et utilise l'heure réelle après verrou ;
--   * matérialise les invariants de décision par une contrainte ;
--   * préserve le ON DELETE SET NULL de creance_id ;
--   * évalue les fenêtres de quota après acquisition du verrou advisory.

create or replace function public.guard_approval_request_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending'
      or new.approved_by is not null
      or new.decided_at is not null
    then
      raise exception 'approval_request_must_start_pending'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if new.id is distinct from old.id
    or new.prestataire_id is distinct from old.prestataire_id
    or (
      new.creance_id is distinct from old.creance_id
      and not (
        old.creance_id is not null
        and new.creance_id is null
        and not exists (
          select 1
          from public.creance as c
          where c.id = old.creance_id
        )
      )
    )
    or new.type is distinct from old.type
    or new.requested_by_actor_type is distinct from old.requested_by_actor_type
    or new.requested_by_provider is distinct from old.requested_by_provider
    or new.payload is distinct from old.payload
    or new.created_at is distinct from old.created_at
    or new.expires_at is distinct from old.expires_at
  then
    raise exception 'approval_request_immutable_fields'
      using errcode = '42501';
  end if;

  if old.status <> 'pending' then
    if new.status is distinct from old.status
      or new.approved_by is distinct from old.approved_by
      or new.decided_at is distinct from old.decided_at
    then
      raise exception 'approval_request_terminal'
        using errcode = '23514';
    end if;

    return new;
  end if;

  case new.status
    when 'pending' then
      if new.approved_by is not null or new.decided_at is not null then
        raise exception 'approval_request_pending_has_decision'
          using errcode = '23514';
      end if;
    when 'approved', 'rejected' then
      if new.approved_by is null
        or new.decided_at is null
        or (
          old.expires_at is not null
          and new.decided_at >= old.expires_at
        )
      then
        raise exception 'approval_request_human_decision_incomplete'
          using errcode = '23514';
      end if;
    when 'expired' then
      if new.approved_by is not null
        or new.decided_at is null
        or old.expires_at is null
        or new.decided_at < old.expires_at
      then
        raise exception 'approval_request_expiry_invalid'
          using errcode = '23514';
      end if;
  end case;

  return new;
end;
$$;

comment on function public.guard_approval_request_transition() is
  'SID-SEC-003 — impose une création pending, des champs immuables, des décisions avant expiration et préserve uniquement le SET NULL FK d’une créance supprimée.';

alter table public.approval_request
  add constraint approval_request_decision_shape
  check (
    (
      status = 'pending'
      and approved_by is null
      and decided_at is null
    )
    or (
      status in ('approved', 'rejected')
      and approved_by is not null
      and decided_at is not null
      and (expires_at is null or decided_at < expires_at)
    )
    or (
      status = 'expired'
      and approved_by is null
      and decided_at is not null
      and expires_at is not null
      and decided_at >= expires_at
    )
  ) not valid;

alter table public.approval_request
  validate constraint approval_request_decision_shape;

create or replace function public.decide_current_approval_request(
  p_approval_request_id uuid,
  p_decision public.approval_request_status
)
returns public.approval_request
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_prestataire_id uuid;
  v_decision_at timestamptz;
  v_existing public.approval_request;
  v_row public.approval_request;
begin
  if v_uid is null then
    raise exception 'not_authenticated'
      using errcode = '42501';
  end if;

  if p_approval_request_id is null then
    raise exception 'approval_request_id_required'
      using errcode = '22023';
  end if;

  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'approval_request_decision_invalid'
      using errcode = '22023';
  end if;

  select p.id
    into v_prestataire_id
  from public.prestataire as p
  where p.user_id = v_uid;

  if v_prestataire_id is null then
    raise exception 'approval_request_not_found'
      using errcode = 'P0002';
  end if;

  select ar.*
    into v_existing
  from public.approval_request as ar
  where ar.id = p_approval_request_id
    and ar.prestataire_id = v_prestataire_id
  for update;

  if not found then
    -- Même réponse pour un identifiant absent et un identifiant cross-tenant.
    raise exception 'approval_request_not_found'
      using errcode = 'P0002';
  end if;

  -- Capturé après le verrou : une attente concurrente ne peut pas autoriser
  -- une décision qui a expiré entre le début de l'appel et l'acquisition.
  v_decision_at := clock_timestamp();

  if v_existing.status = p_decision
    and v_existing.approved_by = v_uid
    and v_existing.decided_at is not null
  then
    return v_existing;
  end if;

  if v_existing.status = 'expired'
    and v_existing.approved_by is null
    and v_existing.decided_at is not null
  then
    return v_existing;
  end if;

  if v_existing.status <> 'pending' then
    raise exception 'approval_request_transition_invalid'
      using errcode = '23514';
  end if;

  if v_existing.expires_at is not null
    and v_existing.expires_at <= v_decision_at
  then
    update public.approval_request as ar
    set
      status = 'expired',
      approved_by = null,
      decided_at = v_decision_at
    where ar.id = v_existing.id
    returning ar.* into v_row;

    insert into public.audit_log (
      prestataire_id,
      actor_type,
      action,
      entity_type,
      entity_id,
      metadata
    )
    values (
      v_prestataire_id,
      'system',
      'APPROVAL_REQUEST_EXPIRED',
      'approval_request',
      v_row.id,
      jsonb_build_object(
        'from_status', 'pending',
        'to_status', 'expired',
        'requested_decision', p_decision::text,
        'triggered_by_user_id', v_uid
      )
    );

    return v_row;
  end if;

  update public.approval_request as ar
  set
    status = p_decision,
    approved_by = v_uid,
    decided_at = v_decision_at
  where ar.id = v_existing.id
  returning ar.* into v_row;

  insert into public.audit_log (
    prestataire_id,
    actor_type,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_prestataire_id,
    'human',
    case p_decision
      when 'approved' then 'APPROVAL_REQUEST_APPROVED'
      else 'APPROVAL_REQUEST_REJECTED'
    end,
    'approval_request',
    v_row.id,
    jsonb_build_object(
      'from_status', 'pending',
      'to_status', p_decision::text,
      'decided_by_user_id', v_uid
    )
  );

  return v_row;
end;
$$;

comment on function public.decide_current_approval_request(
  uuid,
  public.approval_request_status
) is
  'SID-SEC-003 — décision humaine tenant-safe, verrouillée, auditée atomiquement et rejouable, avec expiration au temps réel.';

revoke all on function public.decide_current_approval_request(
  uuid,
  public.approval_request_status
) from public, anon, service_role;
grant execute on function public.decide_current_approval_request(
  uuid,
  public.approval_request_status
) to authenticated;

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
  v_now timestamptz;
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
      v_limit := 300;
      v_window := interval '1 minute';
    else
      raise exception 'rate_limit_category_invalid' using errcode = '22023';
  end case;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_category::text || ':' || p_subject_hash, 0)
  );

  -- Le temps de fenêtre est capturé après la sérialisation du sujet.
  v_now := clock_timestamp();

  delete from public.public_rate_limit_event as e
  where e.category = p_category
    and e.subject_hash = p_subject_hash
    and e.expires_at <= v_now;

  select count(*)::integer, min(e.expires_at)
    into v_count, v_reset_at
  from public.public_rate_limit_event as e
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
  public.public_rate_limit_category,
  text
) is
  'Consomme atomiquement un quota persistant privé après verrouillage, à partir d’un sujet HMAC SHA-256.';

revoke all on function public.consume_public_rate_limit(
  public.public_rate_limit_category,
  text
) from public, anon, authenticated;
grant execute on function public.consume_public_rate_limit(
  public.public_rate_limit_category,
  text
) to service_role;
