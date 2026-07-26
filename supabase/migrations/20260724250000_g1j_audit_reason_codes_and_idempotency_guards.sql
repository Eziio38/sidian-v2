-- G1-J — Consolidation Gate G1
-- 1) Étendre CHECK reason_code (agent_audit_events) pour aligner AUDIT_REASON_CODES
--    (codes G1-G/H manquants + APPROVAL_AUTONOMY_MISMATCH + AUDIT_BUILD_FAILED).
-- 2) Guard transitions agent_idempotency_records (terminaux immuables) — analog G1-H.
-- Ne réécrit pas les migrations historiques G1-F / G1-G / G1-H.

-- ---------------------------------------------------------------------------
-- 1. CHECK reason_code — drop + recreate
-- ---------------------------------------------------------------------------

alter table public.agent_audit_events
  drop constraint if exists agent_audit_events_reason_code_ck;

alter table public.agent_audit_events
  add constraint agent_audit_events_reason_code_ck check (
    reason_code is null
    or reason_code in (
      -- SUCCESS ∪ permissions (G1-C) ∪ router (G1-D…H) — dédupliqués
      'SUCCESS',
      'ALLOW',
      'INPUT_INVALID',
      'PERMISSION_MISSING',
      'PERMISSION_DENIED',
      'TENANT_SCOPE_MISMATCH',
      'RESOURCE_SCOPE_MISMATCH',
      'TOOL_UNRESOLVED',
      'TOOL_NOT_CALLABLE',
      'MODE_NOT_ALLOWED',
      'AUTONOMY_EXCEEDED',
      'VALIDATION_REQUIRED',
      'VALIDATION_PENDING',
      'VALIDATION_REJECTED',
      'VALIDATION_EXPIRED',
      'VALIDATION_SCOPE_MISMATCH',
      'POLICY_EVALUATION_FAILED',
      'ROUTER_INPUT_INVALID',
      'TOOL_UNKNOWN',
      'INPUT_SCHEMA_UNRESOLVED',
      'INVALID_ARGUMENT',
      'APPROVAL_REQUIRED',
      'APPROVAL_NOT_FOUND',
      'APPROVAL_UNAVAILABLE',
      'APPROVAL_PENDING',
      'APPROVAL_REJECTED',
      'APPROVAL_EXPIRED',
      'APPROVAL_ALREADY_CONSUMED',
      'APPROVAL_SCOPE_MISMATCH',
      'APPROVAL_PARAMS_MISMATCH',
      'APPROVAL_AUTONOMY_MISMATCH',
      'APPROVAL_CONSUMPTION_FAILED',
      'APPROVAL_CONSUMED_EXECUTION_NOT_STARTED',
      'EXECUTOR_UNAVAILABLE',
      'EXECUTOR_TECHNICAL_ERROR',
      'EXECUTOR_BUSINESS_ERROR',
      'OUTPUT_SCHEMA_UNRESOLVED',
      'INVALID_TOOL_OUTPUT',
      'AUDIT_PERSISTENCE_FAILED',
      'AUDIT_BUILD_FAILED',
      'IDEMPOTENCY_KEY_CONFLICT',
      'IDEMPOTENCY_IN_PROGRESS',
      'IDEMPOTENCY_UNAVAILABLE',
      'IDEMPOTENCY_REPLAY_FAILURE',
      'IDEMPOTENCY_COMPLETION_FAILED',
      'ROUTER_INTERNAL_ERROR'
    )
  );

comment on constraint agent_audit_events_reason_code_ck on public.agent_audit_events is
  'G1-J — reason_code aligné AUDIT_REASON_CODES (permissions ∪ router G1-D…H + AUDIT_BUILD_FAILED).';

-- ---------------------------------------------------------------------------
-- 2. Guard transitions idempotency — terminaux immuables
-- ---------------------------------------------------------------------------

create or replace function public.guard_agent_idempotency_record_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'in_progress' then
      raise exception 'agent_idempotency_record_must_start_in_progress'
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- Identité de clé immuable. Les champs d'intention (fingerprint, tool, …)
  -- restent mutables en `in_progress` pour la reprise TTL (claim expired_reacquired).
  if new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.idempotency_key is distinct from old.idempotency_key
    or new.created_at is distinct from old.created_at
  then
    raise exception 'agent_idempotency_record_immutable_fields'
      using errcode = '23514';
  end if;

  -- Terminaux : succeeded / failed ne bougent plus (y compris via service_role).
  if old.status in ('succeeded', 'failed') then
    raise exception 'agent_idempotency_record_terminal'
      using errcode = '23514';
  end if;

  if old.status = 'in_progress' and new.status not in (
    'in_progress', 'succeeded', 'failed'
  ) then
    raise exception 'agent_idempotency_record_transition_invalid'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.guard_agent_idempotency_record_transition() is
  'G1-J — bloque mutations hors machine d''état ; terminaux succeeded/failed immuables.';

revoke all on function public.guard_agent_idempotency_record_transition()
  from public, anon, authenticated, service_role;

drop trigger if exists agent_idempotency_records_transition_guard
  on public.agent_idempotency_records;

create trigger agent_idempotency_records_transition_guard
before insert or update on public.agent_idempotency_records
for each row execute function public.guard_agent_idempotency_record_transition();
