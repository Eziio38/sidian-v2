-- G1-P — WhatsApp Cloud transport (outbound + webhook events)
--
-- Persist messages sortants et événements webhook sans exposer de numéro
-- dans les API métier. provider_kind whatsapp_sidian uniquement pour ce lot.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

create type public.communication_message_direction as enum (
  'outbound',
  'inbound'
);

create type public.communication_message_status as enum (
  'queued',
  'sending',
  'accepted',
  'sent',
  'delivered',
  'read',
  'failed',
  'cancelled'
);

create type public.communication_webhook_processing_status as enum (
  'received',
  'processed',
  'ignored',
  'failed'
);

-- ---------------------------------------------------------------------------
-- 2. communication_messages
-- ---------------------------------------------------------------------------

create table public.communication_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null
    references public.prestataire (id) on delete restrict,
  channel_id uuid not null
    references public.communication_channel (id) on delete restrict,
  provider_kind public.communication_provider_kind not null,
  direction public.communication_message_direction not null default 'outbound',
  -- Référence opaque destinataire (ex. guide:<uuid>) — jamais un E.164
  recipient_reference text not null,
  message_kind text not null,
  template_key text,
  template_locale text,
  payload_snapshot jsonb not null default '{}'::jsonb,
  status public.communication_message_status not null default 'queued',
  idempotency_key text not null,
  provider_message_id text,
  attempt_count integer not null default 0,
  last_error_code text,
  last_error_message text,
  queued_at timestamptz not null default timezone('utc', now()),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  constraint communication_messages_recipient_reference_ck check (
    char_length(trim(recipient_reference)) between 1 and 256
    and recipient_reference !~ '^\+?[0-9]{8,15}$'
  ),
  constraint communication_messages_message_kind_ck check (
    char_length(trim(message_kind)) between 1 and 64
  ),
  constraint communication_messages_idempotency_key_ck check (
    char_length(trim(idempotency_key)) between 8 and 256
  ),
  constraint communication_messages_attempt_count_ck check (
    attempt_count >= 0 and attempt_count <= 10
  ),
  constraint communication_messages_payload_object_ck check (
    jsonb_typeof(payload_snapshot) = 'object'
  ),
  constraint communication_messages_provider_kind_outbound_ck check (
    provider_kind in ('whatsapp_sidian', 'whatsapp_business_personal')
  )
);

comment on table public.communication_messages is
  'Intentions / messages de communication (G1-P). Idempotence par (tenant_id, idempotency_key).';

comment on column public.communication_messages.recipient_reference is
  'Référence opaque destinataire. Interdit : numéro E.164.';

create unique index communication_messages_tenant_idempotency_uidx
  on public.communication_messages (tenant_id, idempotency_key);

create unique index communication_messages_provider_message_uidx
  on public.communication_messages (provider_kind, provider_message_id)
  where provider_message_id is not null;

create index communication_messages_status_queued_idx
  on public.communication_messages (status, queued_at)
  where status in ('queued', 'sending');

create index communication_messages_channel_idx
  on public.communication_messages (channel_id);

create trigger communication_messages_set_updated_at
before update on public.communication_messages
for each row execute function public.set_updated_at();

-- Scope : channel doit appartenir au tenant
create or replace function public.enforce_communication_message_channel_scope()
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
    raise exception 'communication_message channel hors tenant';
  end if;
  return new;
end;
$$;

create trigger communication_messages_channel_scope
before insert or update on public.communication_messages
for each row execute function public.enforce_communication_message_channel_scope();

-- ---------------------------------------------------------------------------
-- 3. communication_webhook_events
-- ---------------------------------------------------------------------------

create table public.communication_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider_kind public.communication_provider_kind not null,
  -- Clé de déduplication fournisseur (wamid + statut ou id Meta)
  dedupe_key text not null,
  provider_event_id text,
  payload_snapshot jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  processing_status public.communication_webhook_processing_status not null
    default 'received',
  processing_error text,
  communication_message_id uuid
    references public.communication_messages (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),

  constraint communication_webhook_events_dedupe_ck check (
    char_length(trim(dedupe_key)) between 1 and 512
  ),
  constraint communication_webhook_events_payload_object_ck check (
    jsonb_typeof(payload_snapshot) = 'object'
  )
);

create unique index communication_webhook_events_dedupe_uidx
  on public.communication_webhook_events (provider_kind, dedupe_key);

create index communication_webhook_events_message_idx
  on public.communication_webhook_events (communication_message_id)
  where communication_message_id is not null;

comment on table public.communication_webhook_events is
  'Événements webhook WhatsApp dédupliqués (G1-P). Trust boundary : signature avant parse.';

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------

alter table public.communication_messages enable row level security;
alter table public.communication_webhook_events enable row level security;

revoke all on table public.communication_messages from anon, authenticated;
revoke all on table public.communication_webhook_events from anon, authenticated;
grant all on table public.communication_messages to service_role;
grant all on table public.communication_webhook_events to service_role;

-- Lecture tenant authentifiée (pas d'écriture navigateur)
grant select on table public.communication_messages to authenticated;

create policy communication_messages_select_scope
  on public.communication_messages
  for select
  to authenticated
  using (tenant_id = public.current_prestataire_id());

-- Webhook events : service_role uniquement (pas de policy authenticated)
