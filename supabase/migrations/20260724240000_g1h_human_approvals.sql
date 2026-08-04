-- G1-H — Human Approval Service persistant (create / decide / consume atomique).
--
-- Distinct de public.approval_request (registre métier / Stripe) et de
-- public.agent_idempotency_records (claim d'exécution).
-- Mutations réservées au chemin de confiance serveur (service_role + RPC).
-- Lecture authentifiée scoped au tenant via public.current_prestataire_id().
-- Une approbation lie une intention exacte (fingerprint + params_hash) et
-- ne peut être consommée qu'une seule fois, sans élévation d'autonomie.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

create table public.agent_human_approvals (
  approval_id uuid primary key default gen_random_uuid(),
  -- Tenant = prestataire (convention RLS / JWT du dépôt).
  tenant_id uuid not null
    references public.prestataire (id) on delete restrict,
  request_fingerprint text not null,
  params_hash text not null,
  tool_id text not null,
  tool_version text not null,
  mode text not null,
  requested_autonomy_level integer not null,
  resource_kind text,
  resource_id text,
  requester_actor_id text not null,
  requester_actor_type text not null,
  status text not null,
  requested_at timestamptz not null,
  expires_at timestamptz not null,
  decided_at timestamptz,
  decided_by_actor_id text,
  decision_reason_code text,
  consumed_at timestamptz,
  consumed_by_correlation_id text,
  -- Hash de clé d'idempotence uniquement — jamais la clé brute.
  consumed_idempotency_key_hash text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  constraint agent_human_approvals_fingerprint_ck check (
    char_length(btrim(request_fingerprint)) between 1 and 128
  ),
  constraint agent_human_approvals_params_hash_ck check (
    char_length(btrim(params_hash)) between 1 and 128
  ),
  constraint agent_human_approvals_tool_id_ck check (
    char_length(tool_id) between 1 and 128
  ),
  constraint agent_human_approvals_tool_version_ck check (
    char_length(tool_version) between 1 and 64
  ),
  constraint agent_human_approvals_requester_actor_id_ck check (
    char_length(requester_actor_id) between 1 and 256
  ),
  constraint agent_human_approvals_decided_by_actor_id_ck check (
    decided_by_actor_id is null
    or char_length(decided_by_actor_id) between 1 and 256
  ),
  constraint agent_human_approvals_decision_reason_code_ck check (
    decision_reason_code is null
    or char_length(decision_reason_code) between 1 and 128
  ),
  constraint agent_human_approvals_consumed_correlation_ck check (
    consumed_by_correlation_id is null
    or char_length(consumed_by_correlation_id) between 1 and 256
  ),
  constraint agent_human_approvals_consumed_idempotency_hash_ck check (
    consumed_idempotency_key_hash is null
    or char_length(consumed_idempotency_key_hash) between 32 and 128
  ),
  constraint agent_human_approvals_resource_id_ck check (
    resource_id is null or char_length(resource_id) between 1 and 256
  ),
  -- Enums stables G1-C / G1-E (text + CHECK — évolutifs sans ALTER TYPE).
  constraint agent_human_approvals_mode_ck check (
    mode in ('agir', 'conseiller', 'transmettre')
  ),
  constraint agent_human_approvals_autonomy_ck check (
    requested_autonomy_level in (0, 1, 2, 3)
  ),
  constraint agent_human_approvals_requester_actor_type_ck check (
    requester_actor_type in ('human', 'system')
  ),
  constraint agent_human_approvals_resource_kind_ck check (
    resource_kind is null
    or resource_kind in ('invoice', 'receivable', 'client', 'account')
  ),
  constraint agent_human_approvals_resource_pair_ck check (
    (resource_kind is null and resource_id is null)
    or (resource_kind is not null and resource_id is not null)
  ),
  constraint agent_human_approvals_status_ck check (
    status in (
      'pending',
      'approved',
      'rejected',
      'expired',
      'consumed',
      'cancelled'
    )
  ),
  constraint agent_human_approvals_expires_after_requested_ck check (
    expires_at > requested_at
  ),
  constraint agent_human_approvals_state_ck check (
    (
      status = 'pending'
      and decided_at is null
      and decided_by_actor_id is null
      and decision_reason_code is null
      and consumed_at is null
      and consumed_by_correlation_id is null
      and consumed_idempotency_key_hash is null
    )
    or (
      status = 'approved'
      and decided_at is not null
      and decided_by_actor_id is not null
      and consumed_at is null
      and consumed_by_correlation_id is null
      and consumed_idempotency_key_hash is null
    )
    or (
      status = 'rejected'
      and decided_at is not null
      and decided_by_actor_id is not null
      and consumed_at is null
      and consumed_by_correlation_id is null
      and consumed_idempotency_key_hash is null
    )
    or (
      status = 'expired'
      and consumed_at is null
      and consumed_by_correlation_id is null
      and consumed_idempotency_key_hash is null
      and (
        (decided_at is null and decided_by_actor_id is null)
        or (decided_at is not null and decided_by_actor_id is not null)
      )
    )
    or (
      status = 'consumed'
      and decided_at is not null
      and decided_by_actor_id is not null
      and consumed_at is not null
      and consumed_by_correlation_id is not null
    )
    or (
      status = 'cancelled'
      and consumed_at is null
      and consumed_by_correlation_id is null
      and consumed_idempotency_key_hash is null
    )
  )
);

comment on table public.agent_human_approvals is
  'G1-H — demandes de validation humaine tool-call. Create/decide/consume atomiques via RPC service_role ; lecture tenant-scopée.';

comment on column public.agent_human_approvals.tenant_id is
  'Prestataire propriétaire — aligné sur public.current_prestataire_id().';

comment on column public.agent_human_approvals.request_fingerprint is
  'Empreinte canonique de l''intention (alignée G1-G) — pas timestamp / correlation / secrets.';

comment on column public.agent_human_approvals.params_hash is
  'Hash des paramètres liés à l''approbation — jamais les arguments bruts.';

comment on column public.agent_human_approvals.consumed_idempotency_key_hash is
  'Hash de la clé d''idempotence ayant consommé l''approbation — jamais la clé brute.';

comment on column public.agent_human_approvals.status is
  'pending | approved | rejected | expired | consumed | cancelled';

-- ---------------------------------------------------------------------------
-- 2. Index + updated_at
-- ---------------------------------------------------------------------------

create index agent_human_approvals_tenant_status_expires_idx
  on public.agent_human_approvals (tenant_id, status, expires_at);

create index agent_human_approvals_tenant_tool_requested_at_idx
  on public.agent_human_approvals (tenant_id, tool_id, requested_at);

create index agent_human_approvals_fingerprint_idx
  on public.agent_human_approvals (tenant_id, request_fingerprint);

create trigger agent_human_approvals_set_updated_at
before update on public.agent_human_approvals
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Garde-fou transitions (service_role ne doit pas contourner les RPC)
-- ---------------------------------------------------------------------------

create or replace function public.guard_agent_human_approval_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'pending' then
      raise exception 'agent_human_approval_must_start_pending'
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- Champs d'intention immuables après création.
  if new.approval_id is distinct from old.approval_id
    or new.tenant_id is distinct from old.tenant_id
    or new.request_fingerprint is distinct from old.request_fingerprint
    or new.params_hash is distinct from old.params_hash
    or new.tool_id is distinct from old.tool_id
    or new.tool_version is distinct from old.tool_version
    or new.mode is distinct from old.mode
    or new.requested_autonomy_level is distinct from old.requested_autonomy_level
    or new.resource_kind is distinct from old.resource_kind
    or new.resource_id is distinct from old.resource_id
    or new.requester_actor_id is distinct from old.requester_actor_id
    or new.requester_actor_type is distinct from old.requester_actor_type
    or new.requested_at is distinct from old.requested_at
    or new.expires_at is distinct from old.expires_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'agent_human_approval_immutable_fields'
      using errcode = '23514';
  end if;

  -- Terminaux : consumed / cancelled / rejected ne bougent plus.
  if old.status in ('consumed', 'cancelled', 'rejected') then
    raise exception 'agent_human_approval_terminal'
      using errcode = '23514';
  end if;

  -- rejected ne devient jamais approved (couvert aussi par terminal ci-dessus).
  if old.status = 'rejected' and new.status = 'approved' then
    raise exception 'agent_human_approval_rejected_cannot_approve'
      using errcode = '23514';
  end if;

  if old.status = 'expired' and new.status is distinct from 'expired' then
    raise exception 'agent_human_approval_expired_terminal'
      using errcode = '23514';
  end if;

  if old.status = 'pending' and new.status not in (
    'pending', 'approved', 'rejected', 'expired', 'cancelled'
  ) then
    raise exception 'agent_human_approval_transition_invalid'
      using errcode = '23514';
  end if;

  if old.status = 'approved' and new.status not in (
    'approved', 'consumed', 'expired', 'cancelled'
  ) then
    raise exception 'agent_human_approval_transition_invalid'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.guard_agent_human_approval_transition() is
  'G1-H — bloque transitions / mutations de champs d''intention hors machine d''état.';

revoke all on function public.guard_agent_human_approval_transition()
  from public, anon, authenticated, service_role;

create trigger agent_human_approvals_transition_guard
before insert or update on public.agent_human_approvals
for each row execute function public.guard_agent_human_approval_transition();

-- ---------------------------------------------------------------------------
-- 4. RLS + privilèges (pattern G1-F / G1-G)
-- ---------------------------------------------------------------------------

alter table public.agent_human_approvals enable row level security;

revoke all on table public.agent_human_approvals
  from public, anon, authenticated, service_role;

-- Lecture prestataire courant uniquement. Aucune policy INSERT/UPDATE/DELETE
-- pour authenticated — mutations via service_role / RPC security definer.
create policy agent_human_approvals_select_scope
  on public.agent_human_approvals
  for select
  to authenticated
  using (tenant_id = public.current_prestataire_id());

grant select on table public.agent_human_approvals to authenticated;

-- Chemin serveur : SELECT + INSERT + UPDATE (pas DELETE / TRUNCATE).
-- Les transitions critiques passent par les RPC atomiques ci-dessous.
grant select, insert, update on table public.agent_human_approvals
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Helper — payload d'inspection (champs liés, sans secrets)
-- ---------------------------------------------------------------------------

create or replace function public.agent_human_approval_row_payload(
  p_row public.agent_human_approvals
)
returns jsonb
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'approval_id', p_row.approval_id,
    'tenant_id', p_row.tenant_id,
    'status', p_row.status,
    'request_fingerprint', p_row.request_fingerprint,
    'params_hash', p_row.params_hash,
    'tool_id', p_row.tool_id,
    'tool_version', p_row.tool_version,
    'mode', p_row.mode,
    'requested_autonomy_level', p_row.requested_autonomy_level,
    'resource_kind', p_row.resource_kind,
    'resource_id', p_row.resource_id,
    'requester_actor_id', p_row.requester_actor_id,
    'requester_actor_type', p_row.requester_actor_type,
    'requested_at', p_row.requested_at,
    'expires_at', p_row.expires_at,
    'decided_at', p_row.decided_at,
    'decided_by_actor_id', p_row.decided_by_actor_id,
    'decision_reason_code', p_row.decision_reason_code,
    'consumed_at', p_row.consumed_at,
    'consumed_by_correlation_id', p_row.consumed_by_correlation_id,
    'consumed_idempotency_key_hash', p_row.consumed_idempotency_key_hash
  );
$$;

comment on function public.agent_human_approval_row_payload(public.agent_human_approvals) is
  'G1-H — sérialise une ligne d''approbation (hashes / ids uniquement).';

revoke all on function public.agent_human_approval_row_payload(public.agent_human_approvals)
  from public, anon, authenticated;
grant execute on function public.agent_human_approval_row_payload(public.agent_human_approvals)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. RPC — create_human_approval
-- ---------------------------------------------------------------------------

create or replace function public.create_human_approval(
  p_tenant_id uuid,
  p_request_fingerprint text,
  p_params_hash text,
  p_tool_id text,
  p_tool_version text,
  p_mode text,
  p_requested_autonomy_level integer,
  p_resource_kind text,
  p_resource_id text,
  p_requester_actor_id text,
  p_requester_actor_type text,
  p_now timestamptz default null,
  p_expires_at timestamptz default null,
  p_ttl_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_fingerprint text := nullif(btrim(p_request_fingerprint), '');
  v_params_hash text := nullif(btrim(p_params_hash), '');
  v_tool_id text := nullif(btrim(p_tool_id), '');
  v_tool_version text := nullif(btrim(p_tool_version), '');
  v_mode text := nullif(btrim(p_mode), '');
  v_requester_id text := nullif(btrim(p_requester_actor_id), '');
  v_requester_type text := nullif(btrim(p_requester_actor_type), '');
  v_resource_kind text := nullif(btrim(p_resource_kind), '');
  v_resource_id text := nullif(btrim(p_resource_id), '');
  v_expires_at timestamptz;
  v_row public.agent_human_approvals;
begin
  if p_tenant_id is null then
    raise exception 'human_approval_tenant_required' using errcode = '22023';
  end if;
  if v_fingerprint is null or char_length(v_fingerprint) > 128 then
    raise exception 'human_approval_fingerprint_invalid' using errcode = '22023';
  end if;
  if v_params_hash is null or char_length(v_params_hash) > 128 then
    raise exception 'human_approval_params_hash_invalid' using errcode = '22023';
  end if;
  if v_tool_id is null or char_length(v_tool_id) > 128 then
    raise exception 'human_approval_tool_id_invalid' using errcode = '22023';
  end if;
  if v_tool_version is null or char_length(v_tool_version) > 64 then
    raise exception 'human_approval_tool_version_invalid' using errcode = '22023';
  end if;
  if v_mode is null or v_mode not in ('agir', 'conseiller', 'transmettre') then
    raise exception 'human_approval_mode_invalid' using errcode = '22023';
  end if;
  if p_requested_autonomy_level is null
    or p_requested_autonomy_level not in (0, 1, 2, 3)
  then
    raise exception 'human_approval_autonomy_invalid' using errcode = '22023';
  end if;
  if v_requester_id is null or char_length(v_requester_id) > 256 then
    raise exception 'human_approval_requester_actor_id_invalid' using errcode = '22023';
  end if;
  if v_requester_type is null or v_requester_type not in ('human', 'system') then
    raise exception 'human_approval_requester_actor_type_invalid' using errcode = '22023';
  end if;
  if (v_resource_kind is null) <> (v_resource_id is null) then
    raise exception 'human_approval_resource_pair_invalid' using errcode = '22023';
  end if;
  if v_resource_kind is not null
    and v_resource_kind not in ('invoice', 'receivable', 'client', 'account')
  then
    raise exception 'human_approval_resource_kind_invalid' using errcode = '22023';
  end if;

  if p_expires_at is not null and p_ttl_seconds is not null then
    raise exception 'human_approval_expiry_ambiguous' using errcode = '22023';
  end if;
  if p_expires_at is not null then
    v_expires_at := p_expires_at;
  elsif p_ttl_seconds is not null then
    if p_ttl_seconds < 60 or p_ttl_seconds > 604800 then
      raise exception 'human_approval_ttl_invalid' using errcode = '22023';
    end if;
    v_expires_at := v_now + make_interval(secs => p_ttl_seconds);
  else
    raise exception 'human_approval_expiry_required' using errcode = '22023';
  end if;

  if v_expires_at <= v_now then
    raise exception 'human_approval_expires_at_invalid' using errcode = '22023';
  end if;

  perform 1 from public.prestataire p where p.id = p_tenant_id;
  if not found then
    raise exception 'human_approval_tenant_not_found' using errcode = 'P0002';
  end if;

  insert into public.agent_human_approvals (
    tenant_id,
    request_fingerprint,
    params_hash,
    tool_id,
    tool_version,
    mode,
    requested_autonomy_level,
    resource_kind,
    resource_id,
    requester_actor_id,
    requester_actor_type,
    status,
    requested_at,
    expires_at
  ) values (
    p_tenant_id,
    v_fingerprint,
    v_params_hash,
    v_tool_id,
    v_tool_version,
    v_mode,
    p_requested_autonomy_level,
    v_resource_kind,
    v_resource_id,
    v_requester_id,
    v_requester_type,
    'pending',
    v_now,
    v_expires_at
  )
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'result', 'created',
    'approval_id', v_row.approval_id,
    'status', v_row.status,
    'requested_at', v_row.requested_at,
    'expires_at', v_row.expires_at
  );
end;
$$;

comment on function public.create_human_approval(
  uuid, text, text, text, text, text, integer, text, text, text, text,
  timestamptz, timestamptz, integer
) is
  'G1-H — crée une demande d''approbation pending liée à une intention exacte.';

revoke all on function public.create_human_approval(
  uuid, text, text, text, text, text, integer, text, text, text, text,
  timestamptz, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.create_human_approval(
  uuid, text, text, text, text, text, integer, text, text, text, text,
  timestamptz, timestamptz, integer
) to service_role;

-- ---------------------------------------------------------------------------
-- 7. RPC — decide_human_approval
-- ---------------------------------------------------------------------------

create or replace function public.decide_human_approval(
  p_approval_id uuid,
  p_tenant_id uuid,
  p_decision text,
  p_decided_by_actor_id text,
  p_decision_reason_code text default null,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_decision text := nullif(btrim(p_decision), '');
  v_actor text := nullif(btrim(p_decided_by_actor_id), '');
  v_reason text := nullif(btrim(p_decision_reason_code), '');
  v_new_status text;
  v_row public.agent_human_approvals;
begin
  if p_approval_id is null then
    raise exception 'human_approval_id_required' using errcode = '22023';
  end if;
  if p_tenant_id is null then
    raise exception 'human_approval_tenant_required' using errcode = '22023';
  end if;
  if v_decision is null or v_decision not in ('approve', 'reject') then
    raise exception 'human_approval_decision_invalid' using errcode = '22023';
  end if;
  if v_actor is null or char_length(v_actor) > 256 then
    raise exception 'human_approval_decided_by_actor_id_invalid' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 128 then
    raise exception 'human_approval_decision_reason_code_invalid' using errcode = '22023';
  end if;

  select r.* into v_row
  from public.agent_human_approvals r
  where r.approval_id = p_approval_id
    and r.tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'result', 'not_found'
    );
  end if;

  -- Expiration lazy (pending / approved non consommée).
  if v_row.status in ('pending', 'approved') and v_row.expires_at <= v_now then
    update public.agent_human_approvals r
    set status = 'expired'
    where r.approval_id = v_row.approval_id
      and r.status = v_row.status
    returning r.* into v_row;

    return jsonb_build_object(
      'ok', false,
      'result', 'expired',
      'approval_id', v_row.approval_id,
      'status', v_row.status,
      'expires_at', v_row.expires_at
    );
  end if;

  if v_row.status = 'expired' then
    return jsonb_build_object(
      'ok', false,
      'result', 'expired',
      'approval_id', v_row.approval_id,
      'status', v_row.status,
      'expires_at', v_row.expires_at
    );
  end if;

  if v_row.status = 'consumed' then
    return jsonb_build_object(
      'ok', false,
      'result', 'already_consumed',
      'approval_id', v_row.approval_id,
      'status', v_row.status
    );
  end if;

  if v_row.status in ('rejected', 'cancelled', 'approved') then
    return jsonb_build_object(
      'ok', false,
      'result', 'unavailable',
      'approval_id', v_row.approval_id,
      'status', v_row.status
    );
  end if;

  if v_row.status is distinct from 'pending' then
    return jsonb_build_object(
      'ok', false,
      'result', 'unavailable',
      'approval_id', v_row.approval_id,
      'status', v_row.status
    );
  end if;

  v_new_status := case when v_decision = 'approve' then 'approved' else 'rejected' end;

  update public.agent_human_approvals r
  set
    status = v_new_status,
    decided_at = v_now,
    decided_by_actor_id = v_actor,
    decision_reason_code = v_reason
  where r.approval_id = v_row.approval_id
    and r.status = 'pending'
  returning r.* into v_row;

  if not found then
    -- Course rare : une autre session a transitionné entre FOR UPDATE et UPDATE.
    return jsonb_build_object(
      'ok', false,
      'result', 'unavailable'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'result', v_new_status,
    'approval_id', v_row.approval_id,
    'status', v_row.status,
    'decided_at', v_row.decided_at,
    'decided_by_actor_id', v_row.decided_by_actor_id,
    'decision_reason_code', v_row.decision_reason_code,
    'expires_at', v_row.expires_at
  );
end;
$$;

comment on function public.decide_human_approval(
  uuid, uuid, text, text, text, timestamptz
) is
  'G1-H — décide approve|reject sur une approbation pending (expiration lazy).';

revoke all on function public.decide_human_approval(
  uuid, uuid, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.decide_human_approval(
  uuid, uuid, text, text, text, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- 8. RPC — consume_human_approval (atomique — un seul gagnant concurrent)
-- ---------------------------------------------------------------------------

create or replace function public.consume_human_approval(
  p_approval_id uuid,
  p_tenant_id uuid,
  p_request_fingerprint text,
  p_params_hash text,
  p_tool_id text,
  p_tool_version text,
  p_mode text,
  p_requested_autonomy_level integer,
  p_resource_kind text,
  p_resource_id text,
  p_correlation_id text,
  p_idempotency_key_hash text default null,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_fingerprint text := nullif(btrim(p_request_fingerprint), '');
  v_params_hash text := nullif(btrim(p_params_hash), '');
  v_tool_id text := nullif(btrim(p_tool_id), '');
  v_tool_version text := nullif(btrim(p_tool_version), '');
  v_mode text := nullif(btrim(p_mode), '');
  v_correlation text := nullif(btrim(p_correlation_id), '');
  v_idem_hash text := nullif(btrim(p_idempotency_key_hash), '');
  v_resource_kind text := nullif(btrim(p_resource_kind), '');
  v_resource_id text := nullif(btrim(p_resource_id), '');
  v_row public.agent_human_approvals;
begin
  if p_approval_id is null then
    raise exception 'human_approval_id_required' using errcode = '22023';
  end if;
  if p_tenant_id is null then
    raise exception 'human_approval_tenant_required' using errcode = '22023';
  end if;
  if v_fingerprint is null or char_length(v_fingerprint) > 128 then
    raise exception 'human_approval_fingerprint_invalid' using errcode = '22023';
  end if;
  if v_params_hash is null or char_length(v_params_hash) > 128 then
    raise exception 'human_approval_params_hash_invalid' using errcode = '22023';
  end if;
  if v_tool_id is null or char_length(v_tool_id) > 128 then
    raise exception 'human_approval_tool_id_invalid' using errcode = '22023';
  end if;
  if v_tool_version is null or char_length(v_tool_version) > 64 then
    raise exception 'human_approval_tool_version_invalid' using errcode = '22023';
  end if;
  if v_mode is null or v_mode not in ('agir', 'conseiller', 'transmettre') then
    raise exception 'human_approval_mode_invalid' using errcode = '22023';
  end if;
  if p_requested_autonomy_level is null
    or p_requested_autonomy_level not in (0, 1, 2, 3)
  then
    raise exception 'human_approval_autonomy_invalid' using errcode = '22023';
  end if;
  if v_correlation is null or char_length(v_correlation) > 256 then
    raise exception 'human_approval_correlation_invalid' using errcode = '22023';
  end if;
  if v_idem_hash is not null
    and (
      char_length(v_idem_hash) < 32
      or char_length(v_idem_hash) > 128
    )
  then
    raise exception 'human_approval_idempotency_key_hash_invalid' using errcode = '22023';
  end if;
  if (v_resource_kind is null) <> (v_resource_id is null) then
    raise exception 'human_approval_resource_pair_invalid' using errcode = '22023';
  end if;
  if v_resource_kind is not null
    and v_resource_kind not in ('invoice', 'receivable', 'client', 'account')
  then
    raise exception 'human_approval_resource_kind_invalid' using errcode = '22023';
  end if;

  -- Verrou ligne puis transition : sérialise les consommations concurrentes
  -- dans la même transaction RPC (pas de SELECT+UPDATE client-side).
  select r.* into v_row
  from public.agent_human_approvals r
  where r.approval_id = p_approval_id
    and r.tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'result', 'not_found'
    );
  end if;

  if v_row.status = 'consumed' then
    return jsonb_build_object(
      'ok', false,
      'result', 'already_consumed',
      'approval_id', v_row.approval_id,
      'status', v_row.status,
      'consumed_at', v_row.consumed_at,
      'consumed_by_correlation_id', v_row.consumed_by_correlation_id
    );
  end if;

  if v_row.status = 'pending' then
    if v_row.expires_at <= v_now then
      update public.agent_human_approvals r
      set status = 'expired'
      where r.approval_id = v_row.approval_id
        and r.status = 'pending'
      returning r.* into v_row;

      return jsonb_build_object(
        'ok', false,
        'result', 'expired',
        'approval_id', v_row.approval_id,
        'status', v_row.status,
        'expires_at', v_row.expires_at
      );
    end if;

    return jsonb_build_object(
      'ok', false,
      'result', 'pending',
      'approval_id', v_row.approval_id,
      'status', v_row.status,
      'expires_at', v_row.expires_at
    );
  end if;

  if v_row.status = 'rejected' then
    return jsonb_build_object(
      'ok', false,
      'result', 'rejected',
      'approval_id', v_row.approval_id,
      'status', v_row.status
    );
  end if;

  if v_row.status = 'expired' then
    return jsonb_build_object(
      'ok', false,
      'result', 'expired',
      'approval_id', v_row.approval_id,
      'status', v_row.status,
      'expires_at', v_row.expires_at
    );
  end if;

  if v_row.status = 'cancelled' then
    return jsonb_build_object(
      'ok', false,
      'result', 'unavailable',
      'approval_id', v_row.approval_id,
      'status', v_row.status
    );
  end if;

  if v_row.status is distinct from 'approved' then
    return jsonb_build_object(
      'ok', false,
      'result', 'unavailable',
      'approval_id', v_row.approval_id,
      'status', v_row.status
    );
  end if;

  -- approved : expiration lazy avant toute consommation.
  if v_row.expires_at <= v_now then
    update public.agent_human_approvals r
    set status = 'expired'
    where r.approval_id = v_row.approval_id
      and r.status = 'approved'
    returning r.* into v_row;

    return jsonb_build_object(
      'ok', false,
      'result', 'expired',
      'approval_id', v_row.approval_id,
      'status', v_row.status,
      'expires_at', v_row.expires_at
    );
  end if;

  -- Scope / intention (fingerprint, outil, mode, autonomie, ressource).
  if v_row.request_fingerprint is distinct from v_fingerprint
    or v_row.tool_id is distinct from v_tool_id
    or v_row.tool_version is distinct from v_tool_version
    or v_row.mode is distinct from v_mode
    or v_row.requested_autonomy_level is distinct from p_requested_autonomy_level
    or v_row.resource_kind is distinct from v_resource_kind
    or v_row.resource_id is distinct from v_resource_id
  then
    return jsonb_build_object(
      'ok', false,
      'result', 'scope_mismatch',
      'approval_id', v_row.approval_id,
      'status', v_row.status
    );
  end if;

  if v_row.params_hash is distinct from v_params_hash then
    return jsonb_build_object(
      'ok', false,
      'result', 'params_mismatch',
      'approval_id', v_row.approval_id,
      'status', v_row.status
    );
  end if;

  -- Transition approved → consumed sous le même verrou FOR UPDATE.
  -- Le prédicat status='approved' garantit un seul gagnant concurrent.
  update public.agent_human_approvals r
  set
    status = 'consumed',
    consumed_at = v_now,
    consumed_by_correlation_id = v_correlation,
    consumed_idempotency_key_hash = v_idem_hash
  where r.approval_id = v_row.approval_id
    and r.status = 'approved'
  returning r.* into v_row;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'result', 'unavailable'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'result', 'consumed',
    'approval_id', v_row.approval_id,
    'status', v_row.status,
    'consumed_at', v_row.consumed_at,
    'consumed_by_correlation_id', v_row.consumed_by_correlation_id,
    'consumed_idempotency_key_hash', v_row.consumed_idempotency_key_hash,
    'expires_at', v_row.expires_at
  );
end;
$$;

comment on function public.consume_human_approval(
  uuid, uuid, text, text, text, text, text, integer, text, text, text, text,
  timestamptz
) is
  'G1-H — consomme atomiquement une approbation approved. Résultats : consumed | pending | rejected | expired | already_consumed | scope_mismatch | params_mismatch | not_found | unavailable.';

revoke all on function public.consume_human_approval(
  uuid, uuid, text, text, text, text, text, integer, text, text, text, text,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.consume_human_approval(
  uuid, uuid, text, text, text, text, text, integer, text, text, text, text,
  timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- 9. RPC — get_human_approval_status
-- ---------------------------------------------------------------------------

create or replace function public.get_human_approval_status(
  p_approval_id uuid,
  p_tenant_id uuid,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_row public.agent_human_approvals;
begin
  if p_approval_id is null then
    raise exception 'human_approval_id_required' using errcode = '22023';
  end if;
  if p_tenant_id is null then
    raise exception 'human_approval_tenant_required' using errcode = '22023';
  end if;

  select r.* into v_row
  from public.agent_human_approvals r
  where r.approval_id = p_approval_id
    and r.tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'result', 'not_found'
    );
  end if;

  if v_row.status in ('pending', 'approved') and v_row.expires_at <= v_now then
    update public.agent_human_approvals r
    set status = 'expired'
    where r.approval_id = v_row.approval_id
      and r.status = v_row.status
    returning r.* into v_row;
  end if;

  return jsonb_build_object(
    'ok', true,
    'result', v_row.status,
    'approval', public.agent_human_approval_row_payload(v_row)
  );
end;
$$;

comment on function public.get_human_approval_status(
  uuid, uuid, timestamptz
) is
  'G1-H — inspecte le statut d''une approbation (expiration lazy pending/approved).';

revoke all on function public.get_human_approval_status(
  uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.get_human_approval_status(
  uuid, uuid, timestamptz
) to service_role;
