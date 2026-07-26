-- Communication channels — abstraction de provider (WhatsApp Sidian aujourd'hui,
-- WhatsApp Business personnel demain) sans coupler le métier à un numéro.
--
-- Invariant : aucune table métier / service métier ne stocke ni n'exige un
-- numéro WhatsApp en clair pour décider d'envoyer. Le numéro (si requis) reste
-- dans la config d'adaptateur / secrets, jamais exposé hors couche provider.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

create type public.communication_provider_kind as enum (
  'whatsapp_sidian',
  'whatsapp_business_personal'
);

create type public.communication_channel_status as enum (
  'inactive',
  'active',
  'degraded',
  'revoked'
);

comment on type public.communication_provider_kind is
  'Fournisseur technique du canal. whatsapp_sidian = numéro plateforme Sidian ; whatsapp_business_personal = WABA du prestataire (futur).';

-- Journal message : ajouter WhatsApp sans casser email / interface
alter type public.message_canal add value 'whatsapp';

-- ---------------------------------------------------------------------------
-- 2. Table communication_channel
-- ---------------------------------------------------------------------------

create table public.communication_channel (
  id uuid primary key default gen_random_uuid(),
  prestataire_id uuid not null
    references public.prestataire (id) on delete restrict,
  provider_kind public.communication_provider_kind not null,
  status public.communication_channel_status not null default 'inactive',
  display_name text not null,
  -- Référence opaque côté fournisseur (ex. "sidian_platform") — jamais un E.164.
  provider_ref text not null,
  is_default boolean not null default false,
  -- Métadonnées non secrètes (labels, capacités). Interdit : numéro, token, secret.
  public_metadata jsonb not null default '{}'::jsonb,
  activated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  constraint communication_channel_display_name_ck check (
    char_length(trim(display_name)) between 1 and 120
  ),
  constraint communication_channel_provider_ref_ck check (
    char_length(trim(provider_ref)) between 1 and 128
    and provider_ref !~ '^\+?[0-9]{8,15}$'
  ),
  constraint communication_channel_revoked_ck check (
    (status = 'revoked' and revoked_at is not null)
    or (status <> 'revoked' and revoked_at is null)
  ),
  constraint communication_channel_active_activated_ck check (
    (status = 'active' and activated_at is not null)
    or (status <> 'active')
  ),
  constraint communication_channel_public_metadata_object_ck check (
    jsonb_typeof(public_metadata) = 'object'
  )
);

comment on table public.communication_channel is
  'Canal de communication prestataire-scopé. Sélection métier via id / provider_kind ; jamais via numéro WhatsApp.';

comment on column public.communication_channel.provider_ref is
  'Identifiant opaque du provider. Ne doit jamais être un numéro de téléphone E.164.';

comment on column public.communication_channel.public_metadata is
  'Métadonnées non secrètes uniquement. Secrets et numéros vivent hors DB métier (adaptateur / vault).';

create unique index communication_channel_prestataire_provider_ref_uidx
  on public.communication_channel (prestataire_id, provider_kind, provider_ref);

-- Un seul canal défaut actif par prestataire
create unique index communication_channel_one_default_uidx
  on public.communication_channel (prestataire_id)
  where is_default = true and status = 'active';

create index communication_channel_prestataire_status_idx
  on public.communication_channel (prestataire_id, status);

create trigger communication_channel_set_updated_at
before update on public.communication_channel
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------

alter table public.communication_channel enable row level security;

revoke all on table public.communication_channel from anon;
revoke all on table public.communication_channel from authenticated;
grant select on table public.communication_channel to authenticated;
grant all on table public.communication_channel to service_role;

create policy communication_channel_select_scope
  on public.communication_channel
  for select
  to authenticated
  using (prestataire_id = public.current_prestataire_id());

-- Pas d'INSERT/UPDATE/DELETE authenticated : provisioning serveur uniquement.

-- ---------------------------------------------------------------------------
-- 4. Ensure default WhatsApp Sidian (opaque, sans numéro)
-- ---------------------------------------------------------------------------

create or replace function public.ensure_whatsapp_sidian_channel(
  p_prestataire_id uuid
)
returns public.communication_channel
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.communication_channel;
begin
  if p_prestataire_id is null then
    raise exception 'prestataire_id requis';
  end if;

  select *
  into v_row
  from public.communication_channel
  where prestataire_id = p_prestataire_id
    and provider_kind = 'whatsapp_sidian'
    and provider_ref = 'sidian_platform'
  limit 1;

  if found then
    return v_row;
  end if;

  insert into public.communication_channel (
    prestataire_id,
    provider_kind,
    status,
    display_name,
    provider_ref,
    is_default,
    public_metadata,
    activated_at
  )
  values (
    p_prestataire_id,
    'whatsapp_sidian',
    'active',
    'WhatsApp Sidian',
    'sidian_platform',
    true,
    jsonb_build_object(
      'transport', 'whatsapp',
      'ownership', 'sidian_platform'
    ),
    timezone('utc', now())
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.ensure_whatsapp_sidian_channel(uuid) from public;
revoke all on function public.ensure_whatsapp_sidian_channel(uuid) from anon;
revoke all on function public.ensure_whatsapp_sidian_channel(uuid) from authenticated;
grant execute on function public.ensure_whatsapp_sidian_channel(uuid) to service_role;
