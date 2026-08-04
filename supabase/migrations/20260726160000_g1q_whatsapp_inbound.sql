-- G1-Q — WhatsApp inbound persistence
--
-- Messages entrants, sessions d'interaction (paiement partiel), et état
-- de confirmation Guide — séparés de paiement_source / detecte_hors_sidian.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

create type public.communication_inbound_processing_status as enum (
  'received',
  'validated',
  'correlated',
  'processing',
  'processed',
  'unresolved',
  'rejected',
  'failed'
);

create type public.communication_interaction_session_kind as enum (
  'payment_partial_amount_collection'
);

create type public.communication_interaction_session_status as enum (
  'awaiting_input',
  'completed',
  'expired',
  'cancelled',
  'failed'
);

create type public.guide_payment_confirmation_status as enum (
  'awaiting_guide_response',
  'confirmed_received',
  'confirmed_not_received',
  'verification_in_progress',
  'partially_received'
);

comment on type public.guide_payment_confirmation_status is
  'Décision Guide explicite (G1-Q). Ne pas confondre avec paiement_source.detecte_hors_sidian.';

-- ---------------------------------------------------------------------------
-- 2. communication_inbound_messages
-- ---------------------------------------------------------------------------

create table public.communication_inbound_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid
    references public.prestataire (id) on delete restrict,
  channel_id uuid
    references public.communication_channel (id) on delete restrict,
  provider_kind public.communication_provider_kind not null,
  provider_event_id text not null,
  provider_message_id text not null,
  reply_to_provider_message_id text,
  sender_reference text not null,
  interaction_kind text not null,
  action_key text,
  normalized_text text,
  processing_status public.communication_inbound_processing_status not null
    default 'received',
  correlated_outbound_message_id uuid
    references public.communication_messages (id) on delete set null,
  business_command_id text,
  received_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  failure_message text,
  payload_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  constraint communication_inbound_messages_provider_event_id_ck check (
    char_length(trim(provider_event_id)) between 1 and 512
  ),
  constraint communication_inbound_messages_provider_message_id_ck check (
    char_length(trim(provider_message_id)) between 1 and 512
  ),
  constraint communication_inbound_messages_sender_reference_ck check (
    char_length(trim(sender_reference)) between 1 and 256
    and sender_reference !~ '^\+?[0-9]{8,15}$'
  ),
  constraint communication_inbound_messages_interaction_kind_ck check (
    interaction_kind in ('button', 'text')
  ),
  constraint communication_inbound_messages_action_key_ck check (
    action_key is null
    or action_key in (
      'payment_received_yes',
      'payment_received_no',
      'payment_received_partial',
      'payment_received_checking'
    )
  ),
  constraint communication_inbound_messages_payload_object_ck check (
    jsonb_typeof(payload_snapshot) = 'object'
  )
);

comment on table public.communication_inbound_messages is
  'Messages entrants normalisés (G1-Q). Déduplication (provider_kind, provider_event_id).';

comment on column public.communication_inbound_messages.sender_reference is
  'Référence opaque expéditeur. Interdit : numéro E.164.';

comment on column public.communication_inbound_messages.payload_snapshot is
  'Snapshot sécurisé sans secrets / sans numéro.';

create unique index communication_inbound_messages_provider_event_uidx
  on public.communication_inbound_messages (provider_kind, provider_event_id);

create index communication_inbound_messages_reply_to_idx
  on public.communication_inbound_messages (reply_to_provider_message_id)
  where reply_to_provider_message_id is not null;

create index communication_inbound_messages_correlated_outbound_idx
  on public.communication_inbound_messages (correlated_outbound_message_id)
  where correlated_outbound_message_id is not null;

create index communication_inbound_messages_status_idx
  on public.communication_inbound_messages (processing_status, received_at);

create index communication_inbound_messages_tenant_idx
  on public.communication_inbound_messages (tenant_id)
  where tenant_id is not null;

create trigger communication_inbound_messages_set_updated_at
before update on public.communication_inbound_messages
for each row execute function public.set_updated_at();

-- Scope canal ↔ tenant lorsque les deux sont présents
create or replace function public.enforce_communication_inbound_channel_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_channel_tenant uuid;
begin
  if new.channel_id is null or new.tenant_id is null then
    return new;
  end if;

  select prestataire_id into v_channel_tenant
  from public.communication_channel
  where id = new.channel_id;

  if v_channel_tenant is null then
    raise exception 'communication_channel introuvable';
  end if;
  if v_channel_tenant <> new.tenant_id then
    raise exception 'communication_inbound channel hors tenant';
  end if;
  return new;
end;
$$;

create trigger communication_inbound_messages_channel_scope
before insert or update on public.communication_inbound_messages
for each row execute function public.enforce_communication_inbound_channel_scope();

-- ---------------------------------------------------------------------------
-- 3. communication_interaction_sessions
-- ---------------------------------------------------------------------------

create table public.communication_interaction_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null
    references public.prestataire (id) on delete restrict,
  channel_id uuid not null
    references public.communication_channel (id) on delete restrict,
  guide_id uuid not null,
  inbound_message_id uuid not null
    references public.communication_inbound_messages (id) on delete restrict,
  outbound_message_id uuid not null
    references public.communication_messages (id) on delete restrict,
  session_kind public.communication_interaction_session_kind not null,
  status public.communication_interaction_session_status not null
    default 'awaiting_input',
  business_entity_type text not null,
  business_entity_id text not null,
  expected_input_kind text not null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  expires_at timestamptz not null,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  constraint communication_interaction_sessions_entity_type_ck check (
    char_length(trim(business_entity_type)) between 1 and 64
  ),
  constraint communication_interaction_sessions_entity_id_ck check (
    char_length(trim(business_entity_id)) between 1 and 128
  ),
  constraint communication_interaction_sessions_expected_input_ck check (
    expected_input_kind = 'amount_eur_cents'
  ),
  constraint communication_interaction_sessions_attempts_ck check (
    attempt_count >= 0
    and max_attempts >= 1
    and attempt_count <= max_attempts + 1
  )
);

comment on table public.communication_interaction_sessions is
  'Mini-flow conversationnel inbound (ex. collecte montant partiel G1-Q).';

create index communication_interaction_sessions_active_idx
  on public.communication_interaction_sessions (
    tenant_id,
    channel_id,
    guide_id,
    status
  )
  where status = 'awaiting_input';

create index communication_interaction_sessions_expires_idx
  on public.communication_interaction_sessions (expires_at)
  where status = 'awaiting_input';

create trigger communication_interaction_sessions_set_updated_at
before update on public.communication_interaction_sessions
for each row execute function public.set_updated_at();

create or replace function public.enforce_communication_interaction_session_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_channel_tenant uuid;
begin
  select prestataire_id into v_channel_tenant
  from public.communication_channel
  where id = new.channel_id;

  if v_channel_tenant is null then
    raise exception 'communication_channel introuvable';
  end if;
  if v_channel_tenant <> new.tenant_id then
    raise exception 'communication_interaction_session channel hors tenant';
  end if;
  return new;
end;
$$;

create trigger communication_interaction_sessions_channel_scope
before insert or update on public.communication_interaction_sessions
for each row execute function public.enforce_communication_interaction_session_scope();

-- ---------------------------------------------------------------------------
-- 4. guide_payment_confirmation_state
-- ---------------------------------------------------------------------------

create table public.guide_payment_confirmation_state (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null
    references public.prestataire (id) on delete restrict,
  protection_id text not null,
  occurrence_id text not null,
  state public.guide_payment_confirmation_status not null
    default 'awaiting_guide_response',
  amount_due_cents integer not null,
  amount_received_cents integer not null default 0,
  currency text not null default 'EUR',
  confirmed_by_guide_id uuid,
  source_outbound_message_id uuid
    references public.communication_messages (id) on delete set null,
  last_inbound_message_id uuid
    references public.communication_inbound_messages (id) on delete set null,
  last_business_command_id text,
  confirmed_at timestamptz,
  verification_initiated_at timestamptz,
  auto_debit_neutralized boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  constraint guide_payment_confirmation_protection_id_ck check (
    char_length(trim(protection_id)) between 1 and 128
  ),
  constraint guide_payment_confirmation_occurrence_id_ck check (
    char_length(trim(occurrence_id)) between 1 and 128
  ),
  constraint guide_payment_confirmation_currency_ck check (
    currency = 'EUR'
  ),
  constraint guide_payment_confirmation_amount_due_ck check (
    amount_due_cents > 0
  ),
  constraint guide_payment_confirmation_amount_received_ck check (
    amount_received_cents >= 0
    and amount_received_cents <= amount_due_cents
  )
);

comment on table public.guide_payment_confirmation_state is
  'État de confirmation Guide (G1-Q). Source d''autorité séparée de paiement_source.';

create unique index guide_payment_confirmation_business_uidx
  on public.guide_payment_confirmation_state (
    tenant_id,
    protection_id,
    occurrence_id
  );

create index guide_payment_confirmation_state_idx
  on public.guide_payment_confirmation_state (tenant_id, state);

create trigger guide_payment_confirmation_state_set_updated_at
before update on public.guide_payment_confirmation_state
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------

alter table public.communication_inbound_messages enable row level security;
alter table public.communication_interaction_sessions enable row level security;
alter table public.guide_payment_confirmation_state enable row level security;

revoke all on table public.communication_inbound_messages from anon, authenticated;
revoke all on table public.communication_interaction_sessions from anon, authenticated;
revoke all on table public.guide_payment_confirmation_state from anon, authenticated;

grant all on table public.communication_inbound_messages to service_role;
grant all on table public.communication_interaction_sessions to service_role;
grant all on table public.guide_payment_confirmation_state to service_role;

-- Lecture tenant authentifiée (pas d'écriture navigateur)
grant select on table public.communication_inbound_messages to authenticated;
grant select on table public.communication_interaction_sessions to authenticated;
grant select on table public.guide_payment_confirmation_state to authenticated;

create policy communication_inbound_messages_select_scope
  on public.communication_inbound_messages
  for select
  to authenticated
  using (
    tenant_id is not null
    and tenant_id = public.current_prestataire_id()
  );

create policy communication_interaction_sessions_select_scope
  on public.communication_interaction_sessions
  for select
  to authenticated
  using (tenant_id = public.current_prestataire_id());

create policy guide_payment_confirmation_state_select_scope
  on public.guide_payment_confirmation_state
  for select
  to authenticated
  using (tenant_id = public.current_prestataire_id());

-- Pas d'INSERT/UPDATE/DELETE authenticated : écriture service_role uniquement.
-- communication_webhook_events (G1-P) reste service_role only — réutilisé tel quel.
