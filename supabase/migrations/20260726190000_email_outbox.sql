-- Email transactional outbox (P0 Runtime)
-- Provider-agnostic queue ; delivery via EmailProvider (Resend HTTP, stub, …).
-- Statuses: queued / processing / sent / failed / dead_letter

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

create type public.email_delivery_status as enum (
  'queued',
  'processing',
  'sent',
  'failed',
  'dead_letter'
);

create type public.email_template_key as enum (
  'reminder_before_due',
  'reminder_after_due',
  'payment_received',
  'payment_failed',
  'update_payment_method',
  'cancellation_notice',
  'partial_payment_notice',
  'guide_internal_notice'
);

-- ---------------------------------------------------------------------------
-- 2. email_outbox
-- ---------------------------------------------------------------------------

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null
    references public.prestataire (id) on delete restrict,
  template_key public.email_template_key not null,
  template_locale text not null default 'fr',
  -- Adresse canonique (lower/btrim) — nécessaire à l'envoi ; jamais loggée en clair côté app
  recipient_email text not null,
  recipient_name text,
  -- Empreinte stable pour corrélation / logs sans PII
  recipient_email_hash text not null,
  subject text not null,
  -- Corps rendus déterministes (snapshot au enqueue)
  body_text text not null,
  body_html text not null,
  -- Variables métier non secrètes (montants libellés, dates, URLs allowlistées)
  variables_snapshot jsonb not null default '{}'::jsonb,
  related_entity_type text,
  related_entity_id uuid,
  status public.email_delivery_status not null default 'queued',
  idempotency_key text not null,
  provider_kind text not null default 'resend',
  provider_message_id text,
  attempt_count integer not null default 0,
  max_attempts integer not null default 4,
  last_error_code text,
  last_error_message text,
  queued_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  constraint email_outbox_locale_ck check (
    template_locale in ('fr')
  ),
  constraint email_outbox_recipient_email_ck check (
    char_length(recipient_email) between 3 and 254
    and recipient_email = lower(btrim(recipient_email))
    and recipient_email !~ '\s'
    and position('@' in recipient_email) > 1
  ),
  constraint email_outbox_recipient_name_ck check (
    recipient_name is null
    or char_length(btrim(recipient_name)) between 1 and 200
  ),
  constraint email_outbox_recipient_hash_ck check (
    char_length(recipient_email_hash) = 64
    and recipient_email_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint email_outbox_subject_ck check (
    char_length(btrim(subject)) between 1 and 200
  ),
  constraint email_outbox_body_text_ck check (
    char_length(body_text) between 1 and 100000
  ),
  constraint email_outbox_body_html_ck check (
    char_length(body_html) between 1 and 200000
  ),
  constraint email_outbox_variables_object_ck check (
    jsonb_typeof(variables_snapshot) = 'object'
  ),
  constraint email_outbox_related_entity_type_ck check (
    related_entity_type is null
    or related_entity_type in (
      'creance',
      'paiement',
      'tentative_paiement',
      'client_payeur',
      'protection',
      'guide'
    )
  ),
  constraint email_outbox_idempotency_key_ck check (
    char_length(trim(idempotency_key)) between 8 and 256
  ),
  constraint email_outbox_provider_kind_ck check (
    provider_kind in ('resend', 'stub')
  ),
  constraint email_outbox_attempt_count_ck check (
    attempt_count >= 0 and attempt_count <= 20
  ),
  constraint email_outbox_max_attempts_ck check (
    max_attempts >= 1 and max_attempts <= 10
  )
);

comment on table public.email_outbox is
  'Outbox emails transactionnels. Idempotence (tenant_id, idempotency_key). Domaine découplé du vendor.';

comment on column public.email_outbox.recipient_email is
  'Adresse canonique pour livraison. Ne jamais journaliser en clair côté application.';

comment on column public.email_outbox.recipient_email_hash is
  'SHA-256 hex de recipient_email — corrélation / logs sans PII.';

comment on column public.email_outbox.provider_message_id is
  'Identifiant fournisseur (ex. Resend id) après envoi réussi.';

create unique index email_outbox_tenant_idempotency_uidx
  on public.email_outbox (tenant_id, idempotency_key);

create unique index email_outbox_provider_message_uidx
  on public.email_outbox (provider_kind, provider_message_id)
  where provider_message_id is not null;

create index email_outbox_status_queued_idx
  on public.email_outbox (status, queued_at)
  where status in ('queued', 'failed');

create index email_outbox_tenant_template_idx
  on public.email_outbox (tenant_id, template_key, created_at desc);

create index email_outbox_related_entity_idx
  on public.email_outbox (related_entity_type, related_entity_id)
  where related_entity_id is not null;

create trigger email_outbox_set_updated_at
before update on public.email_outbox
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS — service_role écrit ; authenticated lecture tenant uniquement
-- ---------------------------------------------------------------------------

alter table public.email_outbox enable row level security;

revoke all on table public.email_outbox from anon, authenticated;
grant all on table public.email_outbox to service_role;

grant select on table public.email_outbox to authenticated;

create policy email_outbox_select_scope
  on public.email_outbox
  for select
  to authenticated
  using (tenant_id = public.current_prestataire_id());
