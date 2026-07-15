-- Sidian V2 — contraintes de scope et invariants complémentaires (revue Phase 2)

-- is_default n'est autorisé que sur une autorisation ACTIVE (cf. 03 §2.3)
alter table public.payment_authorization
  add constraint payment_authorization_default_requires_active
  check (not is_default or etat = 'ACTIVE');

-- approval_request : creance_id doit appartenir au prestataire
create or replace function public.enforce_approval_request_scope()
returns trigger
language plpgsql
as $$
declare
  v_prestataire_id uuid;
begin
  if new.creance_id is null then
    return new;
  end if;

  select c.prestataire_id into v_prestataire_id
  from public.creance c
  where c.id = new.creance_id;

  if v_prestataire_id is distinct from new.prestataire_id then
    raise exception 'approval_request.creance_id hors scope prestataire';
  end if;

  return new;
end;
$$;

create trigger approval_request_scope_check
before insert or update on public.approval_request
for each row execute function public.enforce_approval_request_scope();

-- paiement : tentative_paiement_id doit référencer la même créance
create or replace function public.enforce_paiement_tentative_scope()
returns trigger
language plpgsql
as $$
declare
  v_creance_id uuid;
begin
  if new.tentative_paiement_id is null then
    return new;
  end if;

  select tp.creance_id into v_creance_id
  from public.tentative_paiement tp
  where tp.id = new.tentative_paiement_id;

  if v_creance_id is null then
    raise exception 'tentative_paiement introuvable pour paiement';
  end if;

  if v_creance_id is distinct from new.creance_id then
    raise exception 'paiement.tentative_paiement_id hors scope creance';
  end if;

  return new;
end;
$$;

create trigger paiement_tentative_scope_check
before insert or update on public.paiement
for each row execute function public.enforce_paiement_tentative_scope();

-- regle : client_payeur_id doit appartenir au prestataire
create or replace function public.enforce_regle_client_scope()
returns trigger
language plpgsql
as $$
declare
  v_prestataire_id uuid;
begin
  if new.client_payeur_id is null then
    return new;
  end if;

  select cp.prestataire_id into v_prestataire_id
  from public.client_payeur cp
  where cp.id = new.client_payeur_id;

  if v_prestataire_id is distinct from new.prestataire_id then
    raise exception 'regle.client_payeur_id hors scope prestataire';
  end if;

  return new;
end;
$$;

create trigger regle_client_scope_check
before insert or update on public.regle
for each row execute function public.enforce_regle_client_scope();

-- audit_log : prestataire_id doit correspondre à l'entité ciblée lorsqu'elle est résolvable
create or replace function public.enforce_audit_log_scope()
returns trigger
language plpgsql
as $$
declare
  v_prestataire_id uuid;
begin
  if new.entity_id is null then
    return new;
  end if;

  case new.entity_type
    when 'creance' then
      select c.prestataire_id into v_prestataire_id
      from public.creance c
      where c.id = new.entity_id;
    when 'client_payeur' then
      select cp.prestataire_id into v_prestataire_id
      from public.client_payeur cp
      where cp.id = new.entity_id;
    when 'conversation' then
      select conv.prestataire_id into v_prestataire_id
      from public.conversation conv
      where conv.id = new.entity_id;
    when 'approval_request' then
      select ar.prestataire_id into v_prestataire_id
      from public.approval_request ar
      where ar.id = new.entity_id;
  else
    return new;
  end case;

  if v_prestataire_id is not null
    and v_prestataire_id is distinct from new.prestataire_id then
    raise exception 'audit_log.prestataire_id incohérent avec entity_id';
  end if;

  return new;
end;
$$;

create trigger audit_log_scope_check
before insert or update on public.audit_log
for each row execute function public.enforce_audit_log_scope();
