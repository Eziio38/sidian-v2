-- G1-G — Idempotency Service persistant (claim atomique / replay / fencing).
--
-- Distinct de public.agent_audit_events (journal append-only) et de
-- public.audit_log (registre métier / Stripe).
-- Mutations réservées au chemin de confiance serveur (service_role + RPC).
-- Lecture authentifiée scoped au tenant via public.current_prestataire_id().
-- Ne prétend pas garantir l'exactly-once d'un effet externe non transactionnel.

-- ---------------------------------------------------------------------------
-- 1. Helpers — sanitization terminal_result
-- ---------------------------------------------------------------------------

create or replace function public.agent_idempotency_json_has_forbidden_key(
  p_value jsonb
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  with recursive walk(node) as (
    select p_value
    where p_value is not null
    union all
    select child.node
    from walk w
    cross join lateral (
      select e.value as node
      from jsonb_each(w.node) e
      where jsonb_typeof(w.node) = 'object'
      union all
      select a.value as node
      from jsonb_array_elements(w.node) a
      where jsonb_typeof(w.node) = 'array'
    ) child
    where jsonb_typeof(w.node) in ('object', 'array')
  ),
  object_keys as (
    select lower(e.key) as key
    from walk w
    cross join lateral jsonb_each(w.node) e
    where jsonb_typeof(w.node) = 'object'
  )
  select exists (
    select 1
    from object_keys k
    where k.key in (
      'stack',
      'stacktrace',
      'stack_trace',
      'password',
      'secret',
      'secrets',
      'token',
      'owner_token',
      'owner_token_hash',
      'authorization',
      'authorization_header',
      'cookie',
      'pan',
      'iban',
      'card_number',
      'cvc',
      'cvv',
      'raw_args',
      'arguments',
      'args',
      'api_key',
      'private_key',
      'access_token',
      'refresh_token',
      'stripe_secret',
      'client_secret',
      'pem'
    )
  );
$$;

comment on function public.agent_idempotency_json_has_forbidden_key(jsonb) is
  'G1-G — détecte clés interdites (stack/secret/token/args bruts) dans un JSON sanitizé.';

revoke all on function public.agent_idempotency_json_has_forbidden_key(jsonb)
  from public, anon, authenticated;
grant execute on function public.agent_idempotency_json_has_forbidden_key(jsonb)
  to service_role;

create or replace function public.agent_idempotency_terminal_result_is_sanitized(
  p_value jsonb
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select
    p_value is not null
    and jsonb_typeof(p_value) = 'object'
    and not public.agent_idempotency_json_has_forbidden_key(p_value);
$$;

comment on function public.agent_idempotency_terminal_result_is_sanitized(jsonb) is
  'G1-G — terminal_result doit être un objet JSON sans stack/secret/args complets.';

revoke all on function public.agent_idempotency_terminal_result_is_sanitized(jsonb)
  from public, anon, authenticated;
grant execute on function public.agent_idempotency_terminal_result_is_sanitized(jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. Table
-- ---------------------------------------------------------------------------

create table public.agent_idempotency_records (
  id uuid primary key default gen_random_uuid(),
  -- Tenant = prestataire (convention RLS / JWT du dépôt).
  tenant_id uuid not null
    references public.prestataire (id) on delete restrict,
  idempotency_key text not null,
  request_fingerprint text not null,
  correlation_id text not null,
  tool_id text not null,
  tool_version text not null,
  resource_kind text,
  resource_id text,
  mode text not null,
  status text not null,
  -- Hash du owner token uniquement — jamais le token brut.
  owner_token_hash text,
  started_at timestamptz not null,
  expires_at timestamptz not null,
  completed_at timestamptz,
  -- Résultat terminal déjà sanitizé (hashes / codes, pas de payload outil).
  terminal_result jsonb,
  terminal_result_hash text,
  failure_code text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  constraint agent_idempotency_records_tenant_key_uq
    unique (tenant_id, idempotency_key),

  constraint agent_idempotency_records_key_ck check (
    char_length(idempotency_key) between 1 and 256
  ),
  constraint agent_idempotency_records_fingerprint_ck check (
    char_length(btrim(request_fingerprint)) between 1 and 128
  ),
  constraint agent_idempotency_records_correlation_id_ck check (
    char_length(correlation_id) between 1 and 256
  ),
  constraint agent_idempotency_records_tool_id_ck check (
    char_length(tool_id) between 1 and 128
  ),
  constraint agent_idempotency_records_tool_version_ck check (
    char_length(tool_version) between 1 and 64
  ),
  constraint agent_idempotency_records_resource_id_ck check (
    resource_id is null or char_length(resource_id) between 1 and 256
  ),
  constraint agent_idempotency_records_owner_token_hash_ck check (
    owner_token_hash is null
    or char_length(owner_token_hash) between 32 and 128
  ),
  constraint agent_idempotency_records_terminal_result_hash_ck check (
    terminal_result_hash is null
    or char_length(terminal_result_hash) between 1 and 128
  ),
  constraint agent_idempotency_records_failure_code_ck check (
    failure_code is null or char_length(failure_code) between 1 and 128
  ),
  -- Enums stables G1-C / G1-E (text + CHECK — évolutifs sans ALTER TYPE).
  constraint agent_idempotency_records_mode_ck check (
    mode in ('agir', 'conseiller', 'transmettre')
  ),
  constraint agent_idempotency_records_status_ck check (
    status in ('in_progress', 'succeeded', 'failed')
  ),
  constraint agent_idempotency_records_resource_kind_ck check (
    resource_kind is null
    or resource_kind in ('invoice', 'receivable', 'client', 'account')
  ),
  constraint agent_idempotency_records_resource_pair_ck check (
    (resource_kind is null and resource_id is null)
    or (resource_kind is not null and resource_id is not null)
  ),
  constraint agent_idempotency_records_expires_after_start_ck check (
    expires_at > started_at
  ),
  constraint agent_idempotency_records_state_ck check (
    (
      status = 'in_progress'
      and owner_token_hash is not null
      and completed_at is null
      and terminal_result is null
      and terminal_result_hash is null
      and failure_code is null
    )
    or (
      status = 'succeeded'
      and owner_token_hash is null
      and completed_at is not null
      and terminal_result is not null
      and terminal_result_hash is not null
      and failure_code is null
      and public.agent_idempotency_terminal_result_is_sanitized(terminal_result)
    )
    or (
      status = 'failed'
      and owner_token_hash is null
      and completed_at is not null
      and terminal_result is not null
      and terminal_result_hash is not null
      and failure_code is not null
      and public.agent_idempotency_terminal_result_is_sanitized(terminal_result)
    )
  )
);

comment on table public.agent_idempotency_records is
  'G1-G — enregistrements d''idempotence tool-call. Claim/complete/fail atomiques via RPC service_role ; lecture tenant-scopée.';

comment on column public.agent_idempotency_records.tenant_id is
  'Prestataire propriétaire — aligné sur public.current_prestataire_id().';

comment on column public.agent_idempotency_records.request_fingerprint is
  'Empreinte canonique de l''intention (pas timestamp / correlation / secrets).';

comment on column public.agent_idempotency_records.owner_token_hash is
  'Hash du token d''ownership du claim courant — jamais le token brut.';

comment on column public.agent_idempotency_records.terminal_result is
  'Résultat terminal sanitizé (objet JSON) — interdit stack / secret / args complets.';

comment on column public.agent_idempotency_records.status is
  'in_progress | succeeded | failed';

-- ---------------------------------------------------------------------------
-- 3. Index + updated_at
-- ---------------------------------------------------------------------------

create index agent_idempotency_records_tenant_status_expires_idx
  on public.agent_idempotency_records (tenant_id, status, expires_at);

create index agent_idempotency_records_correlation_id_idx
  on public.agent_idempotency_records (correlation_id);

create index agent_idempotency_records_tool_started_at_idx
  on public.agent_idempotency_records (tool_id, started_at);

create trigger agent_idempotency_records_set_updated_at
before update on public.agent_idempotency_records
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. RLS + privilèges (pattern G1-F / SID-SEC trust boundaries)
-- ---------------------------------------------------------------------------

alter table public.agent_idempotency_records enable row level security;

revoke all on table public.agent_idempotency_records
  from public, anon, authenticated, service_role;

-- Lecture prestataire courant uniquement. Aucune policy INSERT/UPDATE/DELETE
-- pour authenticated — mutations via service_role / RPC security definer.
create policy agent_idempotency_records_select_scope
  on public.agent_idempotency_records
  for select
  to authenticated
  using (tenant_id = public.current_prestataire_id());

grant select on table public.agent_idempotency_records to authenticated;

-- Chemin serveur : SELECT + INSERT + UPDATE (pas DELETE / TRUNCATE).
-- Les transitions critiques passent par les RPC atomiques ci-dessous.
grant select, insert, update on table public.agent_idempotency_records
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. RPC — claim_idempotency_key (atomique)
-- ---------------------------------------------------------------------------

create or replace function public.claim_idempotency_key(
  p_tenant_id uuid,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_correlation_id text,
  p_tool_id text,
  p_tool_version text,
  p_resource_kind text,
  p_resource_id text,
  p_mode text,
  p_owner_token_hash text,
  p_now timestamptz default null,
  p_ttl_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_fingerprint text := nullif(btrim(p_request_fingerprint), '');
  v_correlation text := nullif(btrim(p_correlation_id), '');
  v_tool_id text := nullif(btrim(p_tool_id), '');
  v_tool_version text := nullif(btrim(p_tool_version), '');
  v_mode text := nullif(btrim(p_mode), '');
  v_owner_hash text := nullif(btrim(p_owner_token_hash), '');
  v_resource_kind text := nullif(btrim(p_resource_kind), '');
  v_resource_id text := nullif(btrim(p_resource_id), '');
  v_expires_at timestamptz;
  v_row public.agent_idempotency_records;
begin
  if p_tenant_id is null then
    raise exception 'idempotency_tenant_required' using errcode = '22023';
  end if;
  if v_key is null or char_length(v_key) > 256 then
    raise exception 'idempotency_key_invalid' using errcode = '22023';
  end if;
  if v_fingerprint is null or char_length(v_fingerprint) > 128 then
    raise exception 'idempotency_fingerprint_invalid' using errcode = '22023';
  end if;
  if v_correlation is null or char_length(v_correlation) > 256 then
    raise exception 'idempotency_correlation_invalid' using errcode = '22023';
  end if;
  if v_tool_id is null or char_length(v_tool_id) > 128 then
    raise exception 'idempotency_tool_id_invalid' using errcode = '22023';
  end if;
  if v_tool_version is null or char_length(v_tool_version) > 64 then
    raise exception 'idempotency_tool_version_invalid' using errcode = '22023';
  end if;
  if v_mode is null or v_mode not in ('agir', 'conseiller', 'transmettre') then
    raise exception 'idempotency_mode_invalid' using errcode = '22023';
  end if;
  if v_owner_hash is null
    or char_length(v_owner_hash) < 32
    or char_length(v_owner_hash) > 128
  then
    raise exception 'idempotency_owner_token_hash_invalid' using errcode = '22023';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds < 15 or p_ttl_seconds > 3600 then
    raise exception 'idempotency_ttl_invalid' using errcode = '22023';
  end if;
  if (v_resource_kind is null) <> (v_resource_id is null) then
    raise exception 'idempotency_resource_pair_invalid' using errcode = '22023';
  end if;
  if v_resource_kind is not null
    and v_resource_kind not in ('invoice', 'receivable', 'client', 'account')
  then
    raise exception 'idempotency_resource_kind_invalid' using errcode = '22023';
  end if;

  -- Prestataire existant (évite INSERT orphelin hors FK race).
  perform 1 from public.prestataire p where p.id = p_tenant_id;
  if not found then
    raise exception 'idempotency_tenant_not_found' using errcode = 'P0002';
  end if;

  v_expires_at := v_now + make_interval(secs => p_ttl_seconds);

  begin
    insert into public.agent_idempotency_records (
      tenant_id,
      idempotency_key,
      request_fingerprint,
      correlation_id,
      tool_id,
      tool_version,
      resource_kind,
      resource_id,
      mode,
      status,
      owner_token_hash,
      started_at,
      expires_at
    ) values (
      p_tenant_id,
      v_key,
      v_fingerprint,
      v_correlation,
      v_tool_id,
      v_tool_version,
      v_resource_kind,
      v_resource_id,
      v_mode,
      'in_progress',
      v_owner_hash,
      v_now,
      v_expires_at
    )
    returning * into v_row;

    return jsonb_build_object(
      'decision', 'acquired',
      'record_id', v_row.id,
      'status', v_row.status,
      'started_at', v_row.started_at,
      'expires_at', v_row.expires_at
    );
  exception
    when unique_violation then
      null; -- course perdue : résolution sous verrou ci-dessous
  end;

  -- Sérialise les décisions concurrentes sur (tenant_id, idempotency_key).
  select r.* into v_row
  from public.agent_idempotency_records r
  where r.tenant_id = p_tenant_id
    and r.idempotency_key = v_key
  for update;

  if not found then
    -- Fenêtre rare : DELETE concurrent hors chemin normal — fail-closed.
    raise exception 'idempotency_claim_race' using errcode = 'P0002';
  end if;

  -- Même clé, intention différente → conflit (y compris in_progress expiré).
  if v_row.request_fingerprint is distinct from v_fingerprint then
    return jsonb_build_object(
      'decision', 'conflict',
      'record_id', v_row.id,
      'status', v_row.status
    );
  end if;

  if v_row.status = 'succeeded' then
    return jsonb_build_object(
      'decision', 'replay_succeeded',
      'record_id', v_row.id,
      'status', v_row.status,
      'terminal_result', v_row.terminal_result,
      'terminal_result_hash', v_row.terminal_result_hash,
      'completed_at', v_row.completed_at
    );
  end if;

  if v_row.status = 'failed' then
    return jsonb_build_object(
      'decision', 'replay_failed',
      'record_id', v_row.id,
      'status', v_row.status,
      'terminal_result', v_row.terminal_result,
      'terminal_result_hash', v_row.terminal_result_hash,
      'failure_code', v_row.failure_code,
      'completed_at', v_row.completed_at
    );
  end if;

  -- in_progress non expiré : ne pas voler le claim.
  if v_row.status = 'in_progress' and v_row.expires_at > v_now then
    return jsonb_build_object(
      'decision', 'in_progress',
      'record_id', v_row.id,
      'status', v_row.status,
      'started_at', v_row.started_at,
      'expires_at', v_row.expires_at
    );
  end if;

  -- in_progress expiré : reprise atomique avec nouveau owner token hash.
  if v_row.status = 'in_progress' and v_row.expires_at <= v_now then
    update public.agent_idempotency_records r
    set
      request_fingerprint = v_fingerprint,
      correlation_id = v_correlation,
      tool_id = v_tool_id,
      tool_version = v_tool_version,
      resource_kind = v_resource_kind,
      resource_id = v_resource_id,
      mode = v_mode,
      status = 'in_progress',
      owner_token_hash = v_owner_hash,
      started_at = v_now,
      expires_at = v_expires_at,
      completed_at = null,
      terminal_result = null,
      terminal_result_hash = null,
      failure_code = null
    where r.id = v_row.id
    returning r.* into v_row;

    return jsonb_build_object(
      'decision', 'expired_reacquired',
      'record_id', v_row.id,
      'status', v_row.status,
      'started_at', v_row.started_at,
      'expires_at', v_row.expires_at
    );
  end if;

  raise exception 'idempotency_claim_undetermined' using errcode = 'P0001';
end;
$$;

comment on function public.claim_idempotency_key(
  uuid, text, text, text, text, text, text, text, text, text, timestamptz, integer
) is
  'G1-G — claim atomique d''une clé d''idempotence. Décisions : acquired | replay_succeeded | replay_failed | conflict | in_progress | expired_reacquired.';

revoke all on function public.claim_idempotency_key(
  uuid, text, text, text, text, text, text, text, text, text, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.claim_idempotency_key(
  uuid, text, text, text, text, text, text, text, text, text, timestamptz, integer
) to service_role;

-- ---------------------------------------------------------------------------
-- 6. RPC — complete_idempotency_record
-- ---------------------------------------------------------------------------

create or replace function public.complete_idempotency_record(
  p_record_id uuid,
  p_owner_token_hash text,
  p_terminal_result jsonb,
  p_terminal_result_hash text,
  p_completed_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_completed_at, timezone('utc', now()));
  v_owner_hash text := nullif(btrim(p_owner_token_hash), '');
  v_result_hash text := nullif(btrim(p_terminal_result_hash), '');
  v_row public.agent_idempotency_records;
begin
  if p_record_id is null then
    raise exception 'idempotency_record_id_required' using errcode = '22023';
  end if;
  if v_owner_hash is null
    or char_length(v_owner_hash) < 32
    or char_length(v_owner_hash) > 128
  then
    raise exception 'idempotency_owner_token_hash_invalid' using errcode = '22023';
  end if;
  if v_result_hash is null or char_length(v_result_hash) > 128 then
    raise exception 'idempotency_terminal_result_hash_invalid' using errcode = '22023';
  end if;
  if not public.agent_idempotency_terminal_result_is_sanitized(p_terminal_result) then
    raise exception 'idempotency_terminal_result_unsanitized' using errcode = '22023';
  end if;

  select r.* into v_row
  from public.agent_idempotency_records r
  where r.id = p_record_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'not_found'
    );
  end if;

  if v_row.status is distinct from 'in_progress' then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'not_in_progress',
      'record_id', v_row.id,
      'status', v_row.status
    );
  end if;

  -- Fencing : seul le owner du claim courant peut terminer
  -- (y compris après expires_at tant qu'aucune reprise n'a eu lieu).
  if v_row.owner_token_hash is distinct from v_owner_hash then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'owner_mismatch',
      'record_id', v_row.id,
      'status', v_row.status
    );
  end if;

  update public.agent_idempotency_records r
  set
    status = 'succeeded',
    owner_token_hash = null,
    completed_at = v_now,
    terminal_result = p_terminal_result,
    terminal_result_hash = v_result_hash,
    failure_code = null
  where r.id = v_row.id
  returning r.* into v_row;

  return jsonb_build_object(
    'ok', true,
    'record_id', v_row.id,
    'status', v_row.status,
    'completed_at', v_row.completed_at,
    'terminal_result_hash', v_row.terminal_result_hash
  );
end;
$$;

comment on function public.complete_idempotency_record(
  uuid, text, jsonb, text, timestamptz
) is
  'G1-G — finalise un claim in_progress en succeeded si owner_token_hash correspond.';

revoke all on function public.complete_idempotency_record(
  uuid, text, jsonb, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_idempotency_record(
  uuid, text, jsonb, text, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- 7. RPC — fail_idempotency_record
-- ---------------------------------------------------------------------------

create or replace function public.fail_idempotency_record(
  p_record_id uuid,
  p_owner_token_hash text,
  p_terminal_result jsonb,
  p_terminal_result_hash text,
  p_failure_code text,
  p_completed_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_completed_at, timezone('utc', now()));
  v_owner_hash text := nullif(btrim(p_owner_token_hash), '');
  v_result_hash text := nullif(btrim(p_terminal_result_hash), '');
  v_failure_code text := nullif(btrim(p_failure_code), '');
  v_row public.agent_idempotency_records;
begin
  if p_record_id is null then
    raise exception 'idempotency_record_id_required' using errcode = '22023';
  end if;
  if v_owner_hash is null
    or char_length(v_owner_hash) < 32
    or char_length(v_owner_hash) > 128
  then
    raise exception 'idempotency_owner_token_hash_invalid' using errcode = '22023';
  end if;
  if v_result_hash is null or char_length(v_result_hash) > 128 then
    raise exception 'idempotency_terminal_result_hash_invalid' using errcode = '22023';
  end if;
  if v_failure_code is null or char_length(v_failure_code) > 128 then
    raise exception 'idempotency_failure_code_invalid' using errcode = '22023';
  end if;
  if not public.agent_idempotency_terminal_result_is_sanitized(p_terminal_result) then
    raise exception 'idempotency_terminal_result_unsanitized' using errcode = '22023';
  end if;

  select r.* into v_row
  from public.agent_idempotency_records r
  where r.id = p_record_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'not_found'
    );
  end if;

  if v_row.status is distinct from 'in_progress' then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'not_in_progress',
      'record_id', v_row.id,
      'status', v_row.status
    );
  end if;

  if v_row.owner_token_hash is distinct from v_owner_hash then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'owner_mismatch',
      'record_id', v_row.id,
      'status', v_row.status
    );
  end if;

  update public.agent_idempotency_records r
  set
    status = 'failed',
    owner_token_hash = null,
    completed_at = v_now,
    terminal_result = p_terminal_result,
    terminal_result_hash = v_result_hash,
    failure_code = v_failure_code
  where r.id = v_row.id
  returning r.* into v_row;

  return jsonb_build_object(
    'ok', true,
    'record_id', v_row.id,
    'status', v_row.status,
    'completed_at', v_row.completed_at,
    'failure_code', v_row.failure_code,
    'terminal_result_hash', v_row.terminal_result_hash
  );
end;
$$;

comment on function public.fail_idempotency_record(
  uuid, text, jsonb, text, text, timestamptz
) is
  'G1-G — finalise un claim in_progress en failed si owner_token_hash correspond.';

revoke all on function public.fail_idempotency_record(
  uuid, text, jsonb, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.fail_idempotency_record(
  uuid, text, jsonb, text, text, timestamptz
) to service_role;
