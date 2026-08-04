-- P0 Runtime — leases outbox (WhatsApp communication_messages + Connect audit drain batch).
-- Claim atomique multi-worker : FOR UPDATE SKIP LOCKED + lease_token fencing.

-- ---------------------------------------------------------------------------
-- 1. communication_messages — colonnes lease / backoff
-- ---------------------------------------------------------------------------

alter table public.communication_messages
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists next_attempt_at timestamptz;

comment on column public.communication_messages.lease_token is
  'Token de claim courant. Requis pour finaliser accept/fail sous lease.';

comment on column public.communication_messages.lease_expires_at is
  'Expiration du lease sending. Après expiration, un autre worker peut reclamer.';

comment on column public.communication_messages.next_attempt_at is
  'Backoff : ne pas reclamer avant cet instant (queued retryable).';

create index if not exists communication_messages_claimable_idx
  on public.communication_messages (status, next_attempt_at, queued_at)
  where status in ('queued', 'sending');

-- ---------------------------------------------------------------------------
-- 2. claim_communication_outbound_batch
-- ---------------------------------------------------------------------------

create or replace function public.claim_communication_outbound_batch(
  p_limit integer default 10,
  p_lease_seconds integer default 60,
  p_max_attempts integer default 4
)
returns setof public.communication_messages
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_ids uuid[];
begin
  if p_limit < 1 or p_limit > 100 then
    raise exception 'communication_outbound_batch_invalid';
  end if;
  if p_lease_seconds < 15 or p_lease_seconds > 600 then
    raise exception 'communication_outbound_lease_invalid';
  end if;
  if p_max_attempts < 1 or p_max_attempts > 10 then
    raise exception 'communication_outbound_max_attempts_invalid';
  end if;

  -- Dead-letter immédiat des queued au-delà du plafond (sans claim).
  with over_limit as (
    select c.id
    from public.communication_messages c
    where c.direction = 'outbound'
      and c.status = 'queued'
      and c.attempt_count >= p_max_attempts
      and (c.next_attempt_at is null or c.next_attempt_at <= v_now)
    for update skip locked
  )
  update public.communication_messages m
  set
    status = 'failed',
    failed_at = coalesce(m.failed_at, v_now),
    last_error_code = 'max_attempts',
    last_error_message = 'max_attempts_exceeded',
    lease_token = null,
    lease_expires_at = null,
    next_attempt_at = null
  from over_limit
  where m.id = over_limit.id;

  select array_agg(x.id) into v_ids
  from (
    select c.id
    from public.communication_messages c
    where c.direction = 'outbound'
      and (
        (
          c.status = 'queued'
          and c.attempt_count < p_max_attempts
          and (c.next_attempt_at is null or c.next_attempt_at <= v_now)
        )
        or (
          c.status = 'sending'
          and c.lease_expires_at is not null
          and c.lease_expires_at <= v_now
          and c.attempt_count < p_max_attempts
        )
      )
    order by c.queued_at asc, c.id asc
    limit p_limit
    for update skip locked
  ) x;

  if v_ids is null or cardinality(v_ids) = 0 then
    return;
  end if;

  return query
  update public.communication_messages m
  set
    status = 'sending',
    attempt_count = m.attempt_count + 1,
    lease_token = gen_random_uuid(),
    lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
    next_attempt_at = null,
    last_error_code = null,
    last_error_message = null
  where m.id = any (v_ids)
  returning m.*;
end;
$$;

comment on function public.claim_communication_outbound_batch(integer, integer, integer) is
  'Claim atomique multi-worker des messages outbound WhatsApp (SKIP LOCKED + lease).';

revoke all on function public.claim_communication_outbound_batch(integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_communication_outbound_batch(integer, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. complete / fail sous lease (fencing)
-- ---------------------------------------------------------------------------

create or replace function public.complete_communication_outbound_claim(
  p_message_id uuid,
  p_lease_token uuid,
  p_provider_message_id text,
  p_accepted_at timestamptz default null
)
returns public.communication_messages
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.communication_messages;
  v_now timestamptz := timezone('utc', now());
begin
  if p_provider_message_id is null or btrim(p_provider_message_id) = '' then
    raise exception 'communication_outbound_provider_message_id_required';
  end if;

  update public.communication_messages m
  set
    status = 'accepted',
    provider_message_id = btrim(p_provider_message_id),
    sent_at = coalesce(p_accepted_at, v_now),
    last_error_code = null,
    last_error_message = null,
    lease_token = null,
    lease_expires_at = null,
    next_attempt_at = null
  where m.id = p_message_id
    and m.status = 'sending'
    and m.lease_token = p_lease_token
    and m.lease_expires_at > v_now
  returning m.* into v_row;

  if not found then
    raise exception 'communication_outbound_lease_lost' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

revoke all on function public.complete_communication_outbound_claim(
  uuid, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_communication_outbound_claim(
  uuid, uuid, text, timestamptz
) to service_role;

create or replace function public.fail_communication_outbound_claim(
  p_message_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_error_message text,
  p_retryable boolean,
  p_retry_delay_seconds integer default null,
  p_max_attempts integer default 4
)
returns public.communication_messages
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.communication_messages;
  v_now timestamptz := timezone('utc', now());
  v_terminal boolean;
begin
  if p_retryable and (
    p_retry_delay_seconds is null
    or p_retry_delay_seconds < 1
    or p_retry_delay_seconds > 86400
  ) then
    raise exception 'communication_outbound_retry_delay_invalid';
  end if;

  select m.* into v_row
  from public.communication_messages m
  where m.id = p_message_id
  for update;

  if not found then
    raise exception 'communication_outbound_not_found' using errcode = 'P0002';
  end if;

  if v_row.status is distinct from 'sending'
    or v_row.lease_token is distinct from p_lease_token
    or v_row.lease_expires_at is null
    or v_row.lease_expires_at <= v_now
  then
    raise exception 'communication_outbound_lease_lost' using errcode = 'P0002';
  end if;

  v_terminal := (not p_retryable) or (v_row.attempt_count >= p_max_attempts);

  update public.communication_messages m
  set
    status = case when v_terminal then 'failed'::public.communication_message_status
                  else 'queued'::public.communication_message_status end,
    last_error_code = left(nullif(btrim(p_error_code), ''), 100),
    last_error_message = left(nullif(btrim(p_error_message), ''), 500),
    failed_at = case when v_terminal then v_now else null end,
    lease_token = null,
    lease_expires_at = null,
    next_attempt_at = case
      when v_terminal then null
      else v_now + make_interval(secs => p_retry_delay_seconds)
    end
  where m.id = p_message_id
  returning m.* into v_row;

  return v_row;
end;
$$;

revoke all on function public.fail_communication_outbound_claim(
  uuid, uuid, text, text, boolean, integer, integer
) from public, anon, authenticated;
grant execute on function public.fail_communication_outbound_claim(
  uuid, uuid, text, text, boolean, integer, integer
) to service_role;

-- ---------------------------------------------------------------------------
-- 4. stripe_connect_audit_outbox — drain batch (flush atomique existant)
-- ---------------------------------------------------------------------------

create or replace function public.drain_stripe_connect_audit_outbox_batch(
  p_limit integer default 25
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.stripe_connect_audit_outbox;
  v_count integer := 0;
  v_ids uuid[];
  v_id uuid;
begin
  if p_limit < 1 or p_limit > 100 then
    raise exception 'connect_audit_outbox_batch_invalid';
  end if;

  select array_agg(x.id) into v_ids
  from (
    select o.id
    from public.stripe_connect_audit_outbox o
    where o.status = 'pending'
    order by o.created_at asc, o.id asc
    limit p_limit
    for update skip locked
  ) x;

  if v_ids is null then
    return 0;
  end if;

  foreach v_id in array v_ids
  loop
    select o.* into v_row
    from public.stripe_connect_audit_outbox o
    where o.id = v_id;

    if v_row.status = 'pending' then
      perform public.flush_stripe_connect_audit_outbox(
        v_row.prestataire_id,
        v_row.operation_key
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

comment on function public.drain_stripe_connect_audit_outbox_batch(integer) is
  'Drain batch multi-worker de stripe_connect_audit_outbox (SKIP LOCKED + flush idempotent).';

revoke all on function public.drain_stripe_connect_audit_outbox_batch(integer)
  from public, anon, authenticated;
grant execute on function public.drain_stripe_connect_audit_outbox_batch(integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. email_outbox — leases + claim batch (table créée par SOUS-AGENT A)
-- ---------------------------------------------------------------------------

alter table public.email_outbox
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists next_attempt_at timestamptz;

create index if not exists email_outbox_claimable_idx
  on public.email_outbox (status, next_attempt_at, queued_at)
  where status in ('queued', 'processing');

create or replace function public.claim_email_outbox_batch(
  p_limit integer default 10,
  p_lease_seconds integer default 60
)
returns setof public.email_outbox
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_ids uuid[];
begin
  if p_limit < 1 or p_limit > 100 then
    raise exception 'email_outbox_batch_invalid';
  end if;
  if p_lease_seconds < 15 or p_lease_seconds > 600 then
    raise exception 'email_outbox_lease_invalid';
  end if;

  with over_limit as (
    select e.id
    from public.email_outbox e
    where e.status = 'queued'
      and e.attempt_count >= e.max_attempts
      and (e.next_attempt_at is null or e.next_attempt_at <= v_now)
    for update skip locked
  )
  update public.email_outbox m
  set
    status = 'dead_letter',
    dead_lettered_at = coalesce(m.dead_lettered_at, v_now),
    last_error_code = 'max_attempts',
    last_error_message = 'max_attempts_exceeded',
    lease_token = null,
    lease_expires_at = null,
    next_attempt_at = null
  from over_limit
  where m.id = over_limit.id;

  select array_agg(x.id) into v_ids
  from (
    select e.id
    from public.email_outbox e
    where (
        (
          e.status = 'queued'
          and e.attempt_count < e.max_attempts
          and (e.next_attempt_at is null or e.next_attempt_at <= v_now)
        )
        or (
          e.status = 'processing'
          and e.lease_expires_at is not null
          and e.lease_expires_at <= v_now
          and e.attempt_count < e.max_attempts
        )
      )
    order by e.queued_at asc, e.id asc
    limit p_limit
    for update skip locked
  ) x;

  if v_ids is null or cardinality(v_ids) = 0 then
    return;
  end if;

  return query
  update public.email_outbox m
  set
    status = 'processing',
    attempt_count = m.attempt_count + 1,
    processed_at = v_now,
    lease_token = gen_random_uuid(),
    lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
    next_attempt_at = null,
    last_error_code = null,
    last_error_message = null
  where m.id = any (v_ids)
  returning m.*;
end;
$$;

comment on function public.claim_email_outbox_batch(integer, integer) is
  'Claim atomique multi-worker email_outbox (SKIP LOCKED + lease).';

revoke all on function public.claim_email_outbox_batch(integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_email_outbox_batch(integer, integer)
  to service_role;
