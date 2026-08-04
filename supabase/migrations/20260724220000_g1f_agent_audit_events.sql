-- G1-F — persistance append-only des événements d'audit agent (tool-call).
--
-- Distinct de public.audit_log (registre métier / Stripe).
-- Écriture réservée au chemin de confiance serveur (service_role).
-- Lecture authentifiée scoped au tenant via public.current_prestataire_id().
-- Pas d'immutabilité crypto/juridique : garde-fou SQL (privileges + trigger).

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

create table public.agent_audit_events (
  -- Identifiant applicatif G1-E (ex. aud_<hex>), pas un uuid technique.
  audit_id text primary key,
  schema_version text not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default timezone('utc', now()),
  correlation_id text not null,
  -- Tenant = prestataire (convention RLS / JWT du dépôt).
  tenant_id uuid not null
    references public.prestataire (id) on delete restrict,
  actor_id text not null,
  actor_type text not null,
  tool_id text,
  tool_version text,
  mode text,
  requested_autonomy_level integer,
  decision text not null,
  result_status text not null,
  reason_code text,
  resource_kind text,
  resource_id text,
  params_hash text,
  output_hash text,
  executor_id text,
  -- Événement structuré déjà rédigé (hashes, pas de payload outil / secret).
  event_payload jsonb not null,

  constraint agent_audit_events_schema_version_ck check (
    char_length(schema_version) between 1 and 32
  ),
  constraint agent_audit_events_audit_id_ck check (
    char_length(audit_id) between 1 and 128
  ),
  constraint agent_audit_events_correlation_id_ck check (
    char_length(correlation_id) between 1 and 256
  ),
  constraint agent_audit_events_actor_id_ck check (
    char_length(actor_id) between 1 and 256
  ),
  -- Enums stables G1-C / G1-E (text + CHECK — évolutifs sans ALTER TYPE).
  constraint agent_audit_events_actor_type_ck check (
    actor_type in ('human', 'system')
  ),
  constraint agent_audit_events_mode_ck check (
    mode is null or mode in ('agir', 'conseiller', 'transmettre')
  ),
  constraint agent_audit_events_autonomy_ck check (
    requested_autonomy_level is null
    or requested_autonomy_level in (0, 1, 2, 3)
  ),
  constraint agent_audit_events_decision_ck check (
    decision in ('allow', 'deny', 'require_approval', 'none')
  ),
  constraint agent_audit_events_result_status_ck check (
    result_status in (
      'success',
      'denied',
      'approval_required',
      'validation_error',
      'technical_error',
      'business_error'
    )
  ),
  constraint agent_audit_events_resource_kind_ck check (
    resource_kind is null
    or resource_kind in ('invoice', 'receivable', 'client', 'account')
  ),
  -- SUCCESS ∪ reason codes permissions ∪ error codes router (dédupliqués).
  constraint agent_audit_events_reason_code_ck check (
    reason_code is null
    or reason_code in (
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
      'EXECUTOR_UNAVAILABLE',
      'EXECUTOR_TECHNICAL_ERROR',
      'EXECUTOR_BUSINESS_ERROR',
      'OUTPUT_SCHEMA_UNRESOLVED',
      'INVALID_TOOL_OUTPUT',
      'AUDIT_PERSISTENCE_FAILED',
      'ROUTER_INTERNAL_ERROR'
    )
  ),
  constraint agent_audit_events_params_hash_ck check (
    params_hash is null or char_length(params_hash) between 1 and 128
  ),
  constraint agent_audit_events_output_hash_ck check (
    output_hash is null or char_length(output_hash) between 1 and 128
  ),
  constraint agent_audit_events_payload_object_ck check (
    jsonb_typeof(event_payload) = 'object'
  )
);

comment on table public.agent_audit_events is
  'G1-F — journal append-only des AuditEvent tool-call agent. Écriture service_role uniquement ; lecture tenant-scopée. Garde-fou SQL, pas une preuve crypto.';

comment on column public.agent_audit_events.audit_id is
  'Identifiant stable G1-E (text, ex. aud_<hex>) — distinct de audit_log.id uuid.';

comment on column public.agent_audit_events.tenant_id is
  'Prestataire propriétaire — aligné sur public.current_prestataire_id().';

comment on column public.agent_audit_events.occurred_at is
  'Horodatage métier injecté (AuditEvent.timestamp) — jamais d''horloge implicite côté builder.';

comment on column public.agent_audit_events.recorded_at is
  'Horodatage d''insertion serveur (append).';

comment on column public.agent_audit_events.event_payload is
  'Copie JSON structurée et rédigée de l''événement ; interdit secrets / PAN / stack / arguments bruts.';

-- ---------------------------------------------------------------------------
-- 2. Index
-- ---------------------------------------------------------------------------

create index agent_audit_events_tenant_occurred_at_idx
  on public.agent_audit_events (tenant_id, occurred_at);

create index agent_audit_events_correlation_id_idx
  on public.agent_audit_events (correlation_id);

create index agent_audit_events_tool_occurred_at_idx
  on public.agent_audit_events (tool_id, occurred_at);

-- ---------------------------------------------------------------------------
-- 3. Append-only — trigger (même famille que audit_log / message)
-- ---------------------------------------------------------------------------

create or replace function public.prevent_agent_audit_events_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'agent_audit_events_immutable'
    using errcode = '42501';
end;
$$;

comment on function public.prevent_agent_audit_events_mutation() is
  'G1-F — bloque UPDATE/DELETE sur agent_audit_events (append-only applicatif).';

revoke all on function public.prevent_agent_audit_events_mutation()
  from public, anon, authenticated, service_role;

create trigger agent_audit_events_prevent_update
before update on public.agent_audit_events
for each row execute function public.prevent_agent_audit_events_mutation();

create trigger agent_audit_events_prevent_delete
before delete on public.agent_audit_events
for each row execute function public.prevent_agent_audit_events_mutation();

-- ---------------------------------------------------------------------------
-- 4. RLS + privilèges (pattern SID-SEC trust boundaries / audit_log)
-- ---------------------------------------------------------------------------

alter table public.agent_audit_events enable row level security;

revoke all on table public.agent_audit_events
  from public, anon, authenticated, service_role;

-- Lecture prestataire courant uniquement. Aucune policy INSERT/UPDATE/DELETE
-- pour authenticated — écriture via service_role (bypass RLS côté PostgREST).
create policy agent_audit_events_select_scope
  on public.agent_audit_events
  for select
  to authenticated
  using (tenant_id = public.current_prestataire_id());

grant select on table public.agent_audit_events to authenticated;

-- Append serveur : SELECT + INSERT uniquement (pas UPDATE / DELETE / TRUNCATE).
grant select, insert on table public.agent_audit_events to service_role;
