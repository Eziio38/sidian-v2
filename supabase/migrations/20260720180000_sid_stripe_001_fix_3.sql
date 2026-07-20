-- SID-STRIPE-001-FIX-3 — fencing de l'effet account.updated,
-- writer dedie aux Customer bindings et ACL minimales.

-- ---------------------------------------------------------------------------
-- 1. Effet account.updated fence par le claim webhook courant
-- ---------------------------------------------------------------------------

create or replace function public.apply_account_updated_projection(
  p_stripe_event_id text,
  p_processing_attempt integer,
  p_lease_token uuid,
  p_stripe_object_id text,
  p_prestataire_id uuid,
  p_stripe_account_id text,
  p_charges_enabled boolean,
  p_payouts_enabled boolean,
  p_details_submitted boolean,
  p_sepa_debit_payments_status public.stripe_capability_status,
  p_onboarding_status public.stripe_onboarding_status,
  p_currently_due jsonb,
  p_pending_verification jsonb,
  p_past_due jsonb,
  p_disabled_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_event public.processed_webhook_event;
  v_effect_registered boolean := false;
  v_projection_applied boolean := false;
  v_now timestamptz := timezone('utc', now());
begin
  select e.* into v_event
  from public.processed_webhook_event e
  where e.id = p_stripe_event_id
  for update;

  if not found
    or v_event.processing_status is distinct from 'processing'
    or v_event.processing_attempts is distinct from p_processing_attempt
    or v_event.lease_token is distinct from p_lease_token
    or v_event.lease_expires_at is null
    or v_event.lease_expires_at <= v_now
    or v_event.type is distinct from 'account.updated'
    or v_event.stripe_connected_account_id is distinct from p_stripe_account_id
  then
    raise exception 'webhook_lease_lost' using errcode = 'P0002';
  end if;

  if p_stripe_object_id is distinct from p_stripe_account_id then
    raise exception 'webhook_account_object_mismatch';
  end if;

  perform 1
  from public.prestataire p
  where p.id = p_prestataire_id
    and p.stripe_account_id = p_stripe_account_id;
  if not found then
    raise exception 'webhook_prestataire_scope_mismatch';
  end if;

  insert into public.stripe_webhook_effect (
    stripe_event_id,
    stripe_object_id,
    effect_type
  )
  values (p_stripe_event_id, p_stripe_object_id, 'account.updated.projection')
  on conflict do nothing;
  v_effect_registered := found;

  update public.prestataire p
  set
    stripe_charges_enabled = coalesce(p_charges_enabled, false),
    stripe_payouts_enabled = coalesce(p_payouts_enabled, false),
    stripe_details_submitted = coalesce(p_details_submitted, false),
    stripe_sepa_debit_payments_status = coalesce(
      p_sepa_debit_payments_status,
      'inactive'
    ),
    stripe_onboarding_status = p_onboarding_status,
    stripe_requirements_currently_due = coalesce(p_currently_due, '[]'::jsonb),
    stripe_requirements_pending_verification = coalesce(
      p_pending_verification,
      '[]'::jsonb
    ),
    stripe_requirements_past_due = coalesce(p_past_due, '[]'::jsonb),
    stripe_disabled_reason = nullif(btrim(p_disabled_reason), ''),
    stripe_status_synced_at = v_now
  where p.id = p_prestataire_id
    and p.stripe_account_id = p_stripe_account_id;
  v_projection_applied := found;

  if not v_projection_applied then
    raise exception 'webhook_prestataire_scope_mismatch';
  end if;

  return jsonb_build_object(
    'effect_registered', v_effect_registered,
    'projection_applied', v_projection_applied,
    'effect_type', 'account.updated.projection'
  );
end;
$$;

comment on function public.apply_account_updated_projection(
  text, integer, uuid, text, uuid, text, boolean, boolean, boolean,
  public.stripe_capability_status, public.stripe_onboarding_status,
  jsonb, jsonb, jsonb, text
) is
  'Projection idempotente account.updated fencee. La reapplication live est reservee aux projections idempotentes et ne doit pas etre generalisee aux effets financiers.';

revoke all on function public.apply_account_updated_projection(
  text, integer, uuid, text, uuid, text, boolean, boolean, boolean,
  public.stripe_capability_status, public.stripe_onboarding_status,
  jsonb, jsonb, jsonb, text
) from public, anon, authenticated;
grant execute on function public.apply_account_updated_projection(
  text, integer, uuid, text, uuid, text, boolean, boolean, boolean,
  public.stripe_capability_status, public.stripe_onboarding_status,
  jsonb, jsonb, jsonb, text
) to service_role;

revoke all on function public.apply_account_updated_projection(
  text, text, uuid, text, boolean, boolean, boolean,
  public.stripe_capability_status, public.stripe_onboarding_status,
  jsonb, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
drop function public.apply_account_updated_projection(
  text, text, uuid, text, boolean, boolean, boolean,
  public.stripe_capability_status, public.stripe_onboarding_status,
  jsonb, jsonb, jsonb, text
);

-- ---------------------------------------------------------------------------
-- 2. Principal dedie au remplacement verifie des Customer bindings
-- ---------------------------------------------------------------------------

do $$
declare
  v_role pg_catalog.pg_roles;
begin
  select r.* into v_role
  from pg_catalog.pg_roles r
  where r.rolname = 'stripe_customer_binding_writer';

  if not found then
    create role stripe_customer_binding_writer
      nologin
      noinherit
      nobypassrls;
  elsif v_role.rolcanlogin or v_role.rolinherit or v_role.rolbypassrls then
    raise exception 'stripe_customer_binding_writer_role_incompatible';
  end if;
end;
$$;

revoke stripe_customer_binding_writer from anon, authenticated, service_role;
grant stripe_customer_binding_writer to authenticator
  with inherit false, set true;

-- PostgreSQL 17 attribue au CREATE ROLE non-superuser une appartenance
-- administrative au createur (postgres), sans INHERIT et sans SET. Elle ne
-- permet pas d'endosser le writer ; seul authenticator recoit SET TRUE.

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles member_role on member_role.oid = membership.member
    join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
    where granted_role.rolname = 'stripe_customer_binding_writer'
      and member_role.rolname <> 'authenticator'
      and (membership.inherit_option or membership.set_option)
  ) then
    raise exception 'stripe_customer_binding_writer_membership_incompatible';
  end if;
end;
$$;

grant usage on schema public to stripe_customer_binding_writer;

create or replace function public.replace_verified_stripe_customer_binding(
  p_prestataire_id uuid,
  p_client_payeur_id uuid,
  p_stripe_account_id text,
  p_stripe_customer_id text,
  p_sidian_environment text
)
returns public.stripe_customer_binding
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_claims jsonb;
  v_new public.stripe_customer_binding;
  v_persisted_account_id text;
begin
  begin
    v_claims := coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb,
      '{}'::jsonb
    );
  exception when others then
    raise exception 'stripe_binding_writer_identity_invalid';
  end;

  if v_claims->>'role' is distinct from 'stripe_customer_binding_writer'
    or v_claims->>'sidian_environment' is distinct from p_sidian_environment
    or p_sidian_environment not in ('local', 'staging', 'production')
  then
    raise exception 'stripe_binding_writer_identity_invalid';
  end if;

  if nullif(btrim(p_stripe_account_id), '') is null then
    raise exception 'stripe_account_id_required';
  end if;
  if nullif(btrim(p_stripe_customer_id), '') is null then
    raise exception 'stripe_customer_id_required';
  end if;

  select p.stripe_account_id into v_persisted_account_id
  from public.prestataire p
  where p.id = p_prestataire_id
  for update;

  if not found then
    raise exception 'prestataire_not_found' using errcode = 'P0002';
  end if;
  if v_persisted_account_id is null then
    raise exception 'stripe_account_not_configured';
  end if;
  if v_persisted_account_id is distinct from p_stripe_account_id then
    raise exception 'stripe_account_scope_mismatch';
  end if;

  perform 1
  from public.client_payeur cp
  where cp.id = p_client_payeur_id
    and cp.prestataire_id = p_prestataire_id
  for update;
  if not found then
    raise exception 'client_payeur_not_found' using errcode = 'P0002';
  end if;

  update public.stripe_customer_binding b
  set
    status = 'superseded',
    superseded_at = timezone('utc', now())
  where b.prestataire_id = p_prestataire_id
    and b.client_payeur_id = p_client_payeur_id
    and b.status = 'active';

  insert into public.stripe_customer_binding (
    prestataire_id,
    client_payeur_id,
    stripe_account_id,
    stripe_customer_id,
    status
  )
  values (
    p_prestataire_id,
    p_client_payeur_id,
    p_stripe_account_id,
    p_stripe_customer_id,
    'active'
  )
  returning * into v_new;

  return v_new;
end;
$$;

revoke all on function public.replace_verified_stripe_customer_binding(
  uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.replace_verified_stripe_customer_binding(
  uuid, uuid, text, text, text
) to stripe_customer_binding_writer;

revoke all on function public.replace_stripe_customer_binding(
  uuid, uuid, text
) from public, anon, authenticated, service_role;
drop function public.replace_stripe_customer_binding(uuid, uuid, text);

revoke all on table public.stripe_customer_binding from service_role;
grant select on table public.stripe_customer_binding to service_role;
revoke all on table public.stripe_customer_binding
  from stripe_customer_binding_writer;

comment on function public.replace_verified_stripe_customer_binding(
  uuid, uuid, text, text, text
) is
  'Rotation Customer binding apres verification Stripe live par le wrapper serveur. Executee exclusivement avec le JWT du role writer et son environnement.';
