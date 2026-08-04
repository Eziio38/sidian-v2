-- P0 Runtime — jobs / outbox + leases scanners (03 §7)
--
-- Les scanners claim des candidats (SKIP LOCKED + lease), puis enqueue
-- des runtime_job. Aucun appel Stripe / WhatsApp / Email / LLM ici.
--
-- Calendrier : policy applicative src/lib/runtime/workflow-policy.ts
-- (J-5 prévention, échéance, silence via delai_grace, clôture, auto-pay,
--  retry_policy=none). Pas d’offsets legacy J+5/+9/+10/+15/+17.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

create type public.runtime_scanner_kind as enum (
  'prevention',
  'due',
  'silence',
  'closure',
  'auto_pay',
  'retries'
);

create type public.runtime_job_kind as enum (
  'prevention_notice',
  'due_send_link',
  'silence_escalate',
  'closure_close_dossier',
  'autopay_intent',
  'retry_failed_notify'
);

create type public.runtime_job_status as enum (
  'pending',
  'claimed',
  'completed',
  'failed_retryable',
  'failed_terminal',
  'cancelled'
);

create type public.runtime_scan_lease_status as enum (
  'open',
  'claimed',
  'completed',
  'failed'
);

-- ---------------------------------------------------------------------------
-- 2. runtime_job — outbox d’intentions (pas d’effets externes)
-- ---------------------------------------------------------------------------

create table public.runtime_job (
  id uuid primary key default gen_random_uuid(),
  prestataire_id uuid not null
    references public.prestataire (id) on delete restrict,
  creance_id uuid not null
    references public.creance (id) on delete cascade,
  dossier_suivi_id uuid
    references public.dossier_suivi (id) on delete set null,
  scanner_kind public.runtime_scanner_kind not null,
  job_kind public.runtime_job_kind not null,
  policy_version text not null,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.runtime_job_status not null default 'pending',
  attempt_count integer not null default 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  available_at timestamptz not null default timezone('utc', now()),
  last_error_code text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,

  constraint runtime_job_policy_version_ck check (
    char_length(trim(policy_version)) between 1 and 64
  ),
  constraint runtime_job_idempotency_key_ck check (
    char_length(trim(idempotency_key)) between 8 and 256
  ),
  constraint runtime_job_attempt_count_ck check (
    attempt_count >= 0 and attempt_count <= 32
  ),
  constraint runtime_job_payload_object_ck check (
    jsonb_typeof(payload) = 'object'
  ),
  constraint runtime_job_lease_pair_ck check (
    (lease_token is null and lease_expires_at is null)
    or (lease_token is not null and lease_expires_at is not null)
  ),
  constraint runtime_job_completed_at_ck check (
    (status in ('completed', 'failed_terminal', 'cancelled') and completed_at is not null)
    or (status not in ('completed', 'failed_terminal', 'cancelled') and completed_at is null)
  )
);

comment on table public.runtime_job is
  'Outbox runtime P0 — intentions persistées par les scanners §7. Aucun effet Stripe/WA/Email/LLM direct.';

create unique index runtime_job_idempotency_uidx
  on public.runtime_job (idempotency_key);

create index runtime_job_pending_available_idx
  on public.runtime_job (status, available_at)
  where status in ('pending', 'failed_retryable', 'claimed');

create index runtime_job_creance_idx
  on public.runtime_job (creance_id, job_kind);

create index runtime_job_prestataire_idx
  on public.runtime_job (prestataire_id, created_at desc);

create trigger runtime_job_set_updated_at
before update on public.runtime_job
for each row execute function public.set_updated_at();

alter table public.runtime_job enable row level security;
revoke all on table public.runtime_job from anon, authenticated;
grant all on table public.runtime_job to service_role;

-- ---------------------------------------------------------------------------
-- 3. runtime_scan_lease — claim concurrent des candidats scanner
-- ---------------------------------------------------------------------------

create table public.runtime_scan_lease (
  scanner_kind public.runtime_scanner_kind not null,
  creance_id uuid not null
    references public.creance (id) on delete cascade,
  status public.runtime_scan_lease_status not null default 'open',
  lease_token uuid,
  lease_expires_at timestamptz,
  occurrence_key text not null,
  policy_version text not null,
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  primary key (scanner_kind, creance_id, occurrence_key),

  constraint runtime_scan_lease_occurrence_ck check (
    char_length(trim(occurrence_key)) between 1 and 128
  ),
  constraint runtime_scan_lease_policy_ck check (
    char_length(trim(policy_version)) between 1 and 64
  ),
  constraint runtime_scan_lease_pair_ck check (
    (status = 'claimed' and lease_token is not null and lease_expires_at is not null)
    or (status <> 'claimed' and (lease_token is null or lease_expires_at is not null))
  )
);

comment on table public.runtime_scan_lease is
  'Lease SKIP LOCKED par (scanner, créance, occurrence) — reprise après crash via expiration.';

create index runtime_scan_lease_claimable_idx
  on public.runtime_scan_lease (scanner_kind, status, lease_expires_at);

create trigger runtime_scan_lease_set_updated_at
before update on public.runtime_scan_lease
for each row execute function public.set_updated_at();

alter table public.runtime_scan_lease enable row level security;
revoke all on table public.runtime_scan_lease from anon, authenticated;
grant all on table public.runtime_scan_lease to service_role;

-- ---------------------------------------------------------------------------
-- 4. ensure + claim batch (SKIP LOCKED)
-- ---------------------------------------------------------------------------

create or replace function public.ensure_runtime_scan_leases(
  p_scanner_kind public.runtime_scanner_kind,
  p_creance_ids uuid[],
  p_occurrence_keys text[],
  p_policy_version text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_inserted integer := 0;
  v_i integer;
  v_n integer;
begin
  if p_creance_ids is null or p_occurrence_keys is null then
    raise exception 'runtime_scan_lease_args_required';
  end if;
  if cardinality(p_creance_ids) <> cardinality(p_occurrence_keys) then
    raise exception 'runtime_scan_lease_args_mismatch';
  end if;
  if p_policy_version is null or btrim(p_policy_version) = '' then
    raise exception 'runtime_policy_version_required';
  end if;

  v_n := coalesce(cardinality(p_creance_ids), 0);
  for v_i in 1..v_n loop
    insert into public.runtime_scan_lease as l (
      scanner_kind,
      creance_id,
      occurrence_key,
      policy_version,
      status
    )
    values (
      p_scanner_kind,
      p_creance_ids[v_i],
      p_occurrence_keys[v_i],
      btrim(p_policy_version),
      'open'
    )
    on conflict (scanner_kind, creance_id, occurrence_key) do nothing;

    if found then
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return v_inserted;
end;
$$;

comment on function public.ensure_runtime_scan_leases(
  public.runtime_scanner_kind, uuid[], text[], text
) is
  'Crée les lignes de lease manquantes (idempotent) avant claim SKIP LOCKED.';

revoke all on function public.ensure_runtime_scan_leases(
  public.runtime_scanner_kind, uuid[], text[], text
) from public, anon, authenticated;
grant execute on function public.ensure_runtime_scan_leases(
  public.runtime_scanner_kind, uuid[], text[], text
) to service_role;

create or replace function public.claim_runtime_scan_leases(
  p_scanner_kind public.runtime_scanner_kind,
  p_creance_ids uuid[],
  p_occurrence_keys text[],
  p_now timestamptz,
  p_lease_seconds integer,
  p_batch_size integer
)
returns table (
  creance_id uuid,
  occurrence_key text,
  lease_token uuid,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_lease integer := coalesce(p_lease_seconds, 120);
  v_batch integer := coalesce(p_batch_size, 50);
  v_token uuid := gen_random_uuid();
begin
  if p_creance_ids is null or p_occurrence_keys is null then
    raise exception 'runtime_scan_lease_args_required';
  end if;
  if cardinality(p_creance_ids) <> cardinality(p_occurrence_keys) then
    raise exception 'runtime_scan_lease_args_mismatch';
  end if;
  if v_lease < 30 or v_lease > 600 then
    raise exception 'runtime_lease_seconds_invalid';
  end if;
  if v_batch < 1 or v_batch > 200 then
    raise exception 'runtime_batch_size_invalid';
  end if;

  return query
  with wanted as (
    select
      t.creance_id,
      t.occurrence_key
    from unnest(p_creance_ids, p_occurrence_keys) as t(creance_id, occurrence_key)
  ),
  picked as (
    select l.scanner_kind, l.creance_id, l.occurrence_key
    from public.runtime_scan_lease l
    inner join wanted w
      on w.creance_id = l.creance_id
     and w.occurrence_key = l.occurrence_key
    where l.scanner_kind = p_scanner_kind
      and (
        l.status in ('open', 'failed')
        or (l.status = 'claimed' and l.lease_expires_at <= v_now)
        -- completed : ne jamais re-claimer la même occurrence
      )
    order by l.creance_id
    for update of l skip locked
    limit v_batch
  ),
  updated as (
    update public.runtime_scan_lease l
    set
      status = 'claimed',
      lease_token = v_token,
      lease_expires_at = v_now + make_interval(secs => v_lease),
      claimed_at = v_now,
      completed_at = null,
      last_error_code = null
    from picked p
    where l.scanner_kind = p.scanner_kind
      and l.creance_id = p.creance_id
      and l.occurrence_key = p.occurrence_key
    returning
      l.creance_id,
      l.occurrence_key,
      l.lease_token,
      l.lease_expires_at
  )
  select
    u.creance_id,
    u.occurrence_key,
    u.lease_token,
    u.lease_expires_at
  from updated u;
end;
$$;

comment on function public.claim_runtime_scan_leases(
  public.runtime_scanner_kind, uuid[], text[], timestamptz, integer, integer
) is
  'Claim atomique SKIP LOCKED — lease pour reprise crash ; clock injectée via p_now.';

revoke all on function public.claim_runtime_scan_leases(
  public.runtime_scanner_kind, uuid[], text[], timestamptz, integer, integer
) from public, anon, authenticated;
grant execute on function public.claim_runtime_scan_leases(
  public.runtime_scanner_kind, uuid[], text[], timestamptz, integer, integer
) to service_role;

create or replace function public.complete_runtime_scan_lease(
  p_scanner_kind public.runtime_scanner_kind,
  p_creance_id uuid,
  p_occurrence_key text,
  p_lease_token uuid,
  p_now timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_updated integer;
begin
  update public.runtime_scan_lease l
  set
    status = 'completed',
    lease_token = null,
    lease_expires_at = null,
    completed_at = v_now
  where l.scanner_kind = p_scanner_kind
    and l.creance_id = p_creance_id
    and l.occurrence_key = p_occurrence_key
    and l.status = 'claimed'
    and l.lease_token = p_lease_token
    and l.lease_expires_at > v_now;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.complete_runtime_scan_lease(
  public.runtime_scanner_kind, uuid, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_runtime_scan_lease(
  public.runtime_scanner_kind, uuid, text, uuid, timestamptz
) to service_role;

create or replace function public.fail_runtime_scan_lease(
  p_scanner_kind public.runtime_scanner_kind,
  p_creance_id uuid,
  p_occurrence_key text,
  p_lease_token uuid,
  p_error_code text default null,
  p_now timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_updated integer;
begin
  update public.runtime_scan_lease l
  set
    status = 'failed',
    lease_token = null,
    lease_expires_at = null,
    last_error_code = left(nullif(btrim(p_error_code), ''), 100),
    completed_at = null
  where l.scanner_kind = p_scanner_kind
    and l.creance_id = p_creance_id
    and l.occurrence_key = p_occurrence_key
    and l.status = 'claimed'
    and l.lease_token = p_lease_token
    and l.lease_expires_at > v_now;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.fail_runtime_scan_lease(
  public.runtime_scanner_kind, uuid, text, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.fail_runtime_scan_lease(
  public.runtime_scanner_kind, uuid, text, uuid, text, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- 5. enqueue_runtime_job — idempotent outbox
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_runtime_job(
  p_prestataire_id uuid,
  p_creance_id uuid,
  p_dossier_suivi_id uuid,
  p_scanner_kind public.runtime_scanner_kind,
  p_job_kind public.runtime_job_kind,
  p_policy_version text,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb,
  p_available_at timestamptz default null,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_row public.runtime_job;
  v_key text := btrim(p_idempotency_key);
begin
  if p_prestataire_id is null or p_creance_id is null then
    raise exception 'runtime_job_scope_required';
  end if;
  if p_policy_version is null or btrim(p_policy_version) = '' then
    raise exception 'runtime_policy_version_required';
  end if;
  if v_key is null or char_length(v_key) < 8 then
    raise exception 'runtime_job_idempotency_key_invalid';
  end if;

  insert into public.runtime_job as j (
    prestataire_id,
    creance_id,
    dossier_suivi_id,
    scanner_kind,
    job_kind,
    policy_version,
    idempotency_key,
    payload,
    status,
    available_at,
    created_at,
    updated_at
  )
  values (
    p_prestataire_id,
    p_creance_id,
    p_dossier_suivi_id,
    p_scanner_kind,
    p_job_kind,
    btrim(p_policy_version),
    v_key,
    coalesce(p_payload, '{}'::jsonb),
    'pending',
    coalesce(p_available_at, v_now),
    v_now,
    v_now
  )
  on conflict (idempotency_key) do nothing
  returning * into v_row;

  if v_row.id is not null then
    return jsonb_build_object(
      'enqueued', true,
      'duplicate', false,
      'job_id', v_row.id,
      'status', v_row.status::text
    );
  end if;

  select j.* into v_row
  from public.runtime_job j
  where j.idempotency_key = v_key;

  return jsonb_build_object(
    'enqueued', false,
    'duplicate', true,
    'job_id', v_row.id,
    'status', v_row.status::text
  );
end;
$$;

comment on function public.enqueue_runtime_job(
  uuid, uuid, uuid, public.runtime_scanner_kind, public.runtime_job_kind,
  text, text, jsonb, timestamptz, timestamptz
) is
  'Insert outbox runtime idempotent — jamais d’effet externe.';

revoke all on function public.enqueue_runtime_job(
  uuid, uuid, uuid, public.runtime_scanner_kind, public.runtime_job_kind,
  text, text, jsonb, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.enqueue_runtime_job(
  uuid, uuid, uuid, public.runtime_scanner_kind, public.runtime_job_kind,
  text, text, jsonb, timestamptz, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- 6. claim_runtime_jobs — worker aval (bounded + lease), hors scanners
-- ---------------------------------------------------------------------------

create or replace function public.claim_runtime_jobs(
  p_now timestamptz,
  p_lease_seconds integer,
  p_batch_size integer,
  p_job_kinds public.runtime_job_kind[] default null
)
returns setof public.runtime_job
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_lease integer := coalesce(p_lease_seconds, 120);
  v_batch integer := coalesce(p_batch_size, 50);
  v_token uuid := gen_random_uuid();
begin
  if v_lease < 30 or v_lease > 600 then
    raise exception 'runtime_lease_seconds_invalid';
  end if;
  if v_batch < 1 or v_batch > 200 then
    raise exception 'runtime_batch_size_invalid';
  end if;

  return query
  with picked as (
    select j.id
    from public.runtime_job j
    where j.available_at <= v_now
      and (
        j.status = 'pending'
        or j.status = 'failed_retryable'
        or (j.status = 'claimed' and j.lease_expires_at <= v_now)
      )
      and (
        p_job_kinds is null
        or j.job_kind = any (p_job_kinds)
      )
    order by j.available_at, j.created_at
    for update skip locked
    limit v_batch
  )
  update public.runtime_job j
  set
    status = 'claimed',
    attempt_count = j.attempt_count + 1,
    lease_token = v_token,
    lease_expires_at = v_now + make_interval(secs => v_lease),
    last_error_code = null
  from picked p
  where j.id = p.id
  returning j.*;
end;
$$;

revoke all on function public.claim_runtime_jobs(
  timestamptz, integer, integer, public.runtime_job_kind[]
) from public, anon, authenticated;
grant execute on function public.claim_runtime_jobs(
  timestamptz, integer, integer, public.runtime_job_kind[]
) to service_role;
