-- Sidian V2 — triggers d'intégrité et immutabilité

create trigger creance_set_updated_at
before update on public.creance
for each row execute function public.set_updated_at();

create trigger dossier_suivi_set_updated_at
before update on public.dossier_suivi
for each row execute function public.set_updated_at();

create trigger conversation_set_updated_at
before update on public.conversation
for each row execute function public.set_updated_at();

-- Protection des champs sensibles prestataire côté authenticated
create or replace function public.protect_prestataire_sensitive_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'authenticated' then
    if new.subscription_status is distinct from old.subscription_status
      or new.pricing_version is distinct from old.pricing_version
      or new.subscription_started_at is distinct from old.subscription_started_at
      or new.early_access_price_locked_until is distinct from old.early_access_price_locked_until
      or new.platform_fee_basis_points is distinct from old.platform_fee_basis_points
      or new.user_id is distinct from old.user_id
    then
      raise exception 'Modification des champs sensibles prestataire interdite';
    end if;
  end if;

  return new;
end;
$$;

create trigger prestataire_protect_sensitive_columns
before update on public.prestataire
for each row execute function public.protect_prestataire_sensitive_columns();

-- Immutabilité message
create or replace function public.prevent_message_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Les messages sont immuables';
end;
$$;

create trigger message_prevent_update
before update on public.message
for each row execute function public.prevent_message_mutation();

create trigger message_prevent_delete
before delete on public.message
for each row execute function public.prevent_message_mutation();

-- Immutabilité audit_log
create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Les audit_log sont immuables';
end;
$$;

create trigger audit_log_prevent_update
before update on public.audit_log
for each row execute function public.prevent_audit_log_mutation();

create trigger audit_log_prevent_delete
before delete on public.audit_log
for each row execute function public.prevent_audit_log_mutation();

-- Cohérence conversation : creance/client doivent appartenir au prestataire
create or replace function public.enforce_conversation_scope()
returns trigger
language plpgsql
as $$
declare
  v_prestataire_id uuid;
begin
  if new.creance_id is not null then
    select c.prestataire_id into v_prestataire_id
    from public.creance c
    where c.id = new.creance_id;

    if v_prestataire_id is distinct from new.prestataire_id then
      raise exception 'conversation.creance_id hors scope prestataire';
    end if;
  end if;

  if new.client_payeur_id is not null then
    select cp.prestataire_id into v_prestataire_id
    from public.client_payeur cp
    where cp.id = new.client_payeur_id;

    if v_prestataire_id is distinct from new.prestataire_id then
      raise exception 'conversation.client_payeur_id hors scope prestataire';
    end if;
  end if;

  return new;
end;
$$;

create trigger conversation_scope_check
before insert or update on public.conversation
for each row execute function public.enforce_conversation_scope();

-- Message : conversation doit appartenir au prestataire courant via RLS côté insert
create or replace function public.enforce_message_conversation_scope()
returns trigger
language plpgsql
as $$
declare
  v_prestataire_id uuid;
begin
  select c.prestataire_id into v_prestataire_id
  from public.conversation c
  where c.id = new.conversation_id;

  if v_prestataire_id is null then
    raise exception 'conversation introuvable pour message';
  end if;

  return new;
end;
$$;

create trigger message_conversation_exists
before insert on public.message
for each row execute function public.enforce_message_conversation_scope();
