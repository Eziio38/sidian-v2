-- G1-M — Conversation-to-Protection Draft
--
-- Brouillons conversationnels uniquement (pas de client_payeur / creance
-- avant confirmation explicite). Mutations via RPC service_role / confiance.
-- Création métier atomique : client_payeur + creance en une transaction.
-- Aucun envoi client / WhatsApp / SMS / e-mail / prélèvement dans ce lot.

-- ---------------------------------------------------------------------------
-- 1. Table brouillon conversationnel
-- ---------------------------------------------------------------------------

create table public.agent_protection_drafts (
  draft_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null
    references public.prestataire (id) on delete restrict,
  actor_id text not null,
  conversation_id uuid,
  state text not null,
  -- Champs structurés + provenance (agent_proposed | user_provided | user_corrected | confirmed)
  fields jsonb not null default '{}'::jsonb,
  missing_fields text[] not null default '{}'::text[],
  pending_question text,
  -- Ambiguïtés ouvertes (dates, devise…) — confirmation utilisateur requise
  open_ambiguities jsonb not null default '[]'::jsonb,
  -- Pièces jointes facultatives : métadonnées seules (pas d’OCR / contenu)
  attachments jsonb not null default '[]'::jsonb,
  -- Clés d’idempotence de création métier (fixées à la 1re confirmation)
  client_creation_key uuid,
  creance_creation_key uuid,
  confirmation_nonce text,
  confirmed_at timestamptz,
  -- Résultats métier après CREATION_ATOMIQUE (null tant que non confirmé)
  client_payeur_id uuid
    references public.client_payeur (id) on delete set null,
  creance_id uuid
    references public.creance (id) on delete set null,
  expires_at timestamptz not null,
  cancelled_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  constraint agent_protection_drafts_actor_id_ck check (
    char_length(actor_id) between 1 and 256
  ),
  constraint agent_protection_drafts_conversation_id_ck check (
    conversation_id is null
    or conversation_id is not null
  ),
  constraint agent_protection_drafts_state_ck check (
    state in (
      'MESSAGE_RECU',
      'EXTRACTION_BROUILLON',
      'INFORMATIONS_MANQUANTES',
      'QUESTION_CIBLEE',
      'BROUILLON_COMPLET',
      'RECAPITULATIF',
      'CONFIRMATION_EXPLICITE',
      'CREATION_ATOMIQUE',
      'TERMINE',
      'ANNULE',
      'EXPIRE'
    )
  ),
  constraint agent_protection_drafts_confirmation_nonce_ck check (
    confirmation_nonce is null
    or char_length(confirmation_nonce) between 8 and 128
  ),
  constraint agent_protection_drafts_expires_after_created_ck check (
    expires_at > created_at
  ),
  constraint agent_protection_drafts_terminal_client_ck check (
    (state = 'TERMINE' and client_payeur_id is not null and creance_id is not null)
    or (state <> 'TERMINE')
  ),
  constraint agent_protection_drafts_cancelled_ck check (
    (state = 'ANNULE' and cancelled_at is not null)
    or (state <> 'ANNULE' and cancelled_at is null)
  )
);

comment on table public.agent_protection_drafts is
  'G1-M — brouillon conversationnel collaboration/protection. '
  'Aucune écriture métier (client_payeur/creance) avant confirmation explicite.';

create index agent_protection_drafts_tenant_idx
  on public.agent_protection_drafts (tenant_id, updated_at desc);

create index agent_protection_drafts_tenant_actor_state_idx
  on public.agent_protection_drafts (tenant_id, actor_id, state);

create unique index agent_protection_drafts_creance_key_uidx
  on public.agent_protection_drafts (tenant_id, creance_creation_key)
  where creance_creation_key is not null;

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------

alter table public.agent_protection_drafts enable row level security;

revoke all privileges on table public.agent_protection_drafts from public;
revoke all privileges on table public.agent_protection_drafts from anon;
revoke all privileges on table public.agent_protection_drafts from authenticated;
grant select on table public.agent_protection_drafts to authenticated;
grant all on table public.agent_protection_drafts to service_role;

create policy agent_protection_drafts_select_scope
  on public.agent_protection_drafts
  for select
  to authenticated
  using (tenant_id = public.current_prestataire_id());

-- Pas d’INSERT/UPDATE/DELETE authenticated — mutations via RPC confiance.

-- ---------------------------------------------------------------------------
-- 3. Trigger immutabilité partielle (pas de DELETE applicatif)
-- ---------------------------------------------------------------------------

create or replace function public.agent_protection_drafts_forbid_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'agent_protection_drafts_delete_forbidden'
    using errcode = '42501';
end;
$$;

revoke all on function public.agent_protection_drafts_forbid_delete() from public;
revoke all on function public.agent_protection_drafts_forbid_delete() from anon;
revoke all on function public.agent_protection_drafts_forbid_delete() from authenticated;

create trigger agent_protection_drafts_no_delete
  before delete on public.agent_protection_drafts
  for each row
  execute function public.agent_protection_drafts_forbid_delete();

-- ---------------------------------------------------------------------------
-- 4. RPC — upsert / lecture / annulation / expiration / confirm atomique
-- ---------------------------------------------------------------------------

create or replace function public.upsert_agent_protection_draft(
  p_tenant_id uuid,
  p_actor_id text,
  p_draft_id uuid,
  p_conversation_id uuid,
  p_state text,
  p_fields jsonb,
  p_missing_fields text[],
  p_pending_question text,
  p_open_ambiguities jsonb,
  p_attachments jsonb,
  p_client_creation_key uuid,
  p_creance_creation_key uuid,
  p_confirmation_nonce text,
  p_expires_at timestamptz,
  p_now timestamptz default timezone('utc', now())
)
returns public.agent_protection_drafts
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.agent_protection_drafts;
begin
  if p_tenant_id is null or p_actor_id is null or char_length(btrim(p_actor_id)) = 0 then
    raise exception 'protection_draft_input_invalid' using errcode = '22023';
  end if;

  if p_draft_id is null then
    insert into public.agent_protection_drafts as d (
      tenant_id,
      actor_id,
      conversation_id,
      state,
      fields,
      missing_fields,
      pending_question,
      open_ambiguities,
      attachments,
      client_creation_key,
      creance_creation_key,
      confirmation_nonce,
      expires_at,
      created_at,
      updated_at
    )
    values (
      p_tenant_id,
      btrim(p_actor_id),
      p_conversation_id,
      p_state,
      coalesce(p_fields, '{}'::jsonb),
      coalesce(p_missing_fields, '{}'::text[]),
      p_pending_question,
      coalesce(p_open_ambiguities, '[]'::jsonb),
      coalesce(p_attachments, '[]'::jsonb),
      p_client_creation_key,
      p_creance_creation_key,
      p_confirmation_nonce,
      p_expires_at,
      p_now,
      p_now
    )
    returning d.* into v_row;
    return v_row;
  end if;

  update public.agent_protection_drafts as d
  set
    conversation_id = coalesce(p_conversation_id, d.conversation_id),
    state = p_state,
    fields = coalesce(p_fields, d.fields),
    missing_fields = coalesce(p_missing_fields, d.missing_fields),
    pending_question = p_pending_question,
    open_ambiguities = coalesce(p_open_ambiguities, d.open_ambiguities),
    attachments = coalesce(p_attachments, d.attachments),
    client_creation_key = coalesce(p_client_creation_key, d.client_creation_key),
    creance_creation_key = coalesce(p_creance_creation_key, d.creance_creation_key),
    confirmation_nonce = coalesce(p_confirmation_nonce, d.confirmation_nonce),
    expires_at = coalesce(p_expires_at, d.expires_at),
    updated_at = p_now
  where d.draft_id = p_draft_id
    and d.tenant_id = p_tenant_id
  returning d.* into v_row;

  if not found then
    raise exception 'protection_draft_not_found' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

comment on function public.upsert_agent_protection_draft is
  'G1-M — crée ou met à jour un brouillon conversationnel (tenant trusted).';

revoke all on function public.upsert_agent_protection_draft(
  uuid, text, uuid, uuid, text, jsonb, text[], text, jsonb, jsonb, uuid, uuid, text, timestamptz, timestamptz
) from public;
revoke all on function public.upsert_agent_protection_draft(
  uuid, text, uuid, uuid, text, jsonb, text[], text, jsonb, jsonb, uuid, uuid, text, timestamptz, timestamptz
) from anon;
revoke all on function public.upsert_agent_protection_draft(
  uuid, text, uuid, uuid, text, jsonb, text[], text, jsonb, jsonb, uuid, uuid, text, timestamptz, timestamptz
) from authenticated;
grant execute on function public.upsert_agent_protection_draft(
  uuid, text, uuid, uuid, text, jsonb, text[], text, jsonb, jsonb, uuid, uuid, text, timestamptz, timestamptz
) to service_role;

create or replace function public.get_agent_protection_draft(
  p_tenant_id uuid,
  p_draft_id uuid,
  p_now timestamptz default timezone('utc', now())
)
returns public.agent_protection_drafts
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.agent_protection_drafts;
begin
  select d.* into v_row
  from public.agent_protection_drafts as d
  where d.draft_id = p_draft_id
    and d.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'protection_draft_not_found' using errcode = 'P0002';
  end if;

  -- Expiration lazy (hors TERMINE / ANNULE)
  if v_row.state not in ('TERMINE', 'ANNULE', 'EXPIRE')
     and v_row.expires_at <= p_now
  then
    update public.agent_protection_drafts as d
    set state = 'EXPIRE', updated_at = p_now
    where d.draft_id = v_row.draft_id
      and d.tenant_id = p_tenant_id
    returning d.* into v_row;
  end if;

  return v_row;
end;
$$;

revoke all on function public.get_agent_protection_draft(uuid, uuid, timestamptz) from public;
revoke all on function public.get_agent_protection_draft(uuid, uuid, timestamptz) from anon;
revoke all on function public.get_agent_protection_draft(uuid, uuid, timestamptz) from authenticated;
grant execute on function public.get_agent_protection_draft(uuid, uuid, timestamptz) to service_role;

create or replace function public.cancel_agent_protection_draft(
  p_tenant_id uuid,
  p_actor_id text,
  p_draft_id uuid,
  p_now timestamptz default timezone('utc', now())
)
returns public.agent_protection_drafts
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.agent_protection_drafts;
begin
  select d.* into v_row
  from public.agent_protection_drafts as d
  where d.draft_id = p_draft_id
    and d.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'protection_draft_not_found' using errcode = 'P0002';
  end if;

  if v_row.state in ('TERMINE', 'ANNULE') then
    return v_row;
  end if;

  if v_row.state = 'EXPIRE' or v_row.expires_at <= p_now then
    update public.agent_protection_drafts as d
    set state = 'EXPIRE', updated_at = p_now
    where d.draft_id = p_draft_id
      and d.tenant_id = p_tenant_id
    returning d.* into v_row;
    return v_row;
  end if;

  update public.agent_protection_drafts as d
  set
    state = 'ANNULE',
    cancelled_at = p_now,
    updated_at = p_now,
    pending_question = null
  where d.draft_id = p_draft_id
    and d.tenant_id = p_tenant_id
  returning d.* into v_row;

  return v_row;
end;
$$;

revoke all on function public.cancel_agent_protection_draft(uuid, text, uuid, timestamptz) from public;
revoke all on function public.cancel_agent_protection_draft(uuid, text, uuid, timestamptz) from anon;
revoke all on function public.cancel_agent_protection_draft(uuid, text, uuid, timestamptz) from authenticated;
grant execute on function public.cancel_agent_protection_draft(uuid, text, uuid, timestamptz) to service_role;

-- Création atomique client_payeur + creance après confirmation explicite.
-- Idempotente via creance_creation_key / draft déjà TERMINE.
create or replace function public.confirm_agent_protection_draft(
  p_tenant_id uuid,
  p_actor_id text,
  p_draft_id uuid,
  p_confirmation_nonce text,
  p_now timestamptz default timezone('utc', now())
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_draft public.agent_protection_drafts;
  v_fields jsonb;
  v_client public.client_payeur;
  v_creance public.creance;
  v_nom text;
  v_email text;
  v_montant bigint;
  v_devise text;
  v_date date;
  v_libelle text;
  v_reference text;
  v_client_key uuid;
  v_creance_key uuid;
begin
  if p_confirmation_nonce is null or char_length(btrim(p_confirmation_nonce)) < 8 then
    raise exception 'protection_draft_confirmation_required' using errcode = '22023';
  end if;

  select d.* into v_draft
  from public.agent_protection_drafts as d
  where d.draft_id = p_draft_id
    and d.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'protection_draft_not_found' using errcode = 'P0002';
  end if;

  -- Replay idempotent si déjà créé
  if v_draft.state = 'TERMINE'
     and v_draft.client_payeur_id is not null
     and v_draft.creance_id is not null
  then
    if v_draft.confirmation_nonce is distinct from btrim(p_confirmation_nonce) then
      raise exception 'protection_draft_confirmation_mismatch' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome', 'replay',
      'draft_id', v_draft.draft_id,
      'state', v_draft.state,
      'client_payeur_id', v_draft.client_payeur_id,
      'creance_id', v_draft.creance_id
    );
  end if;

  if v_draft.state in ('ANNULE', 'EXPIRE') then
    raise exception 'protection_draft_not_confirmable' using errcode = '22023';
  end if;

  if v_draft.expires_at <= p_now then
    update public.agent_protection_drafts as d
    set state = 'EXPIRE', updated_at = p_now
    where d.draft_id = p_draft_id;
    raise exception 'protection_draft_expired' using errcode = '22023';
  end if;

  if v_draft.state not in ('RECAPITULATIF', 'CONFIRMATION_EXPLICITE', 'BROUILLON_COMPLET') then
    raise exception 'protection_draft_not_ready' using errcode = '22023';
  end if;

  if v_draft.confirmation_nonce is null
     or v_draft.confirmation_nonce is distinct from btrim(p_confirmation_nonce)
  then
    raise exception 'protection_draft_confirmation_mismatch' using errcode = '22023';
  end if;

  if coalesce(array_length(v_draft.missing_fields, 1), 0) > 0 then
    raise exception 'protection_draft_missing_fields' using errcode = '22023';
  end if;

  if jsonb_typeof(v_draft.open_ambiguities) = 'array'
     and jsonb_array_length(v_draft.open_ambiguities) > 0
  then
    raise exception 'protection_draft_ambiguities_open' using errcode = '22023';
  end if;

  v_fields := v_draft.fields;
  v_nom := nullif(btrim(coalesce(v_fields->'client_name'->>'value', '')), '');
  v_email := nullif(btrim(coalesce(v_fields->'client_email'->>'value', '')), '');
  v_montant := nullif(v_fields->'expected_amount_minor'->>'value', '')::bigint;
  v_devise := coalesce(nullif(btrim(coalesce(v_fields->'currency'->>'value', '')), ''), 'EUR');
  v_date := nullif(btrim(coalesce(v_fields->'due_date'->>'value', '')), '')::date;
  v_libelle := nullif(btrim(coalesce(v_fields->'libelle'->>'value', '')), '');
  v_reference := nullif(btrim(coalesce(v_fields->'reference_externe'->>'value', '')), '');

  if v_nom is null or v_email is null or v_montant is null or v_date is null then
    raise exception 'protection_draft_missing_fields' using errcode = '22023';
  end if;

  v_client_key := coalesce(v_draft.client_creation_key, gen_random_uuid());
  v_creance_key := coalesce(v_draft.creance_creation_key, gen_random_uuid());

  -- Marque CREATION_ATOMIQUE avant écritures métier
  update public.agent_protection_drafts as d
  set
    state = 'CREATION_ATOMIQUE',
    client_creation_key = v_client_key,
    creance_creation_key = v_creance_key,
    confirmed_at = coalesce(d.confirmed_at, p_now),
    updated_at = p_now
  where d.draft_id = p_draft_id
    and d.tenant_id = p_tenant_id
  returning d.* into v_draft;

  -- Client (idempotent par creation_key)
  select c.* into v_client
  from public.client_payeur as c
  where c.prestataire_id = p_tenant_id
    and c.creation_key = v_client_key;

  if not found then
    insert into public.client_payeur as c (
      prestataire_id, nom, email, creation_key
    )
    values (
      p_tenant_id,
      public.normalize_person_name(v_nom),
      public.canonicalize_email(v_email),
      v_client_key
    )
    returning c.* into v_client;
  else
    if v_client.nom is distinct from public.normalize_person_name(v_nom)
       or v_client.email is distinct from public.canonicalize_email(v_email)
    then
      raise exception 'idempotency_payload_conflict' using errcode = '22023';
    end if;
  end if;

  -- Créance (idempotent par creation_key)
  select cr.* into v_creance
  from public.creance as cr
  where cr.prestataire_id = p_tenant_id
    and cr.creation_key = v_creance_key;

  if not found then
    insert into public.creance as cr (
      prestataire_id,
      client_payeur_id,
      montant,
      devise,
      origine,
      reference_externe,
      date_echeance,
      etat,
      libelle,
      creation_key
    )
    values (
      p_tenant_id,
      v_client.id,
      public.normalize_creance_montant(v_montant),
      public.normalize_creance_devise(v_devise),
      'import_manuel',
      v_reference,
      v_date,
      'BROUILLON',
      v_libelle,
      v_creance_key
    )
    returning cr.* into v_creance;
  else
    if v_creance.client_payeur_id is distinct from v_client.id
       or v_creance.montant is distinct from public.normalize_creance_montant(v_montant)
       or v_creance.date_echeance is distinct from v_date
    then
      raise exception 'idempotency_payload_conflict' using errcode = '22023';
    end if;
  end if;

  update public.agent_protection_drafts as d
  set
    state = 'TERMINE',
    client_payeur_id = v_client.id,
    creance_id = v_creance.id,
    pending_question = null,
    updated_at = p_now
  where d.draft_id = p_draft_id
    and d.tenant_id = p_tenant_id
  returning d.* into v_draft;

  -- Audit métier (registre encadré) — provenance confirmée
  insert into public.audit_log (
    prestataire_id,
    actor_type,
    actor_provider,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    p_tenant_id,
    'human',
    'agent.protection_draft',
    'protection_draft.confirmed_create',
    'creance',
    v_creance.id,
    jsonb_build_object(
      'draft_id', v_draft.draft_id,
      'client_payeur_id', v_client.id,
      'creance_id', v_creance.id,
      'actor_id', p_actor_id,
      'field_provenance', v_fields,
      'source', 'g1m_explicit_confirmation'
    )
  );

  return jsonb_build_object(
    'outcome', 'created',
    'draft_id', v_draft.draft_id,
    'state', v_draft.state,
    'client_payeur_id', v_client.id,
    'creance_id', v_creance.id
  );
end;
$$;

comment on function public.confirm_agent_protection_draft(uuid, text, uuid, text, timestamptz) is
  'G1-M — confirmation explicite → création atomique client_payeur + creance (idempotente). '
  'Aucun message client / paiement / prélèvement.';

revoke all on function public.confirm_agent_protection_draft(uuid, text, uuid, text, timestamptz) from public;
revoke all on function public.confirm_agent_protection_draft(uuid, text, uuid, text, timestamptz) from anon;
revoke all on function public.confirm_agent_protection_draft(uuid, text, uuid, text, timestamptz) from authenticated;
grant execute on function public.confirm_agent_protection_draft(uuid, text, uuid, text, timestamptz) to service_role;
