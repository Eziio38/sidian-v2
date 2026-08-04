-- G1 security hardening — search_path sur triggers communication + channel RPC.
-- Additive ; ne change pas les ACL / grants.

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

revoke all on function public.ensure_whatsapp_sidian_channel(uuid)
  from public, anon, authenticated;
grant execute on function public.ensure_whatsapp_sidian_channel(uuid)
  to service_role;
