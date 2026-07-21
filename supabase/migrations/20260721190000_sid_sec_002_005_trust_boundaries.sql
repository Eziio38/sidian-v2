-- SID-SEC-002..005 — frontières de confiance du registre et des transitions.
--
-- Les tables ci-dessous restent lisibles par le prestataire courant via RLS,
-- mais leur provenance ou leur état ne peuvent plus être forgés depuis
-- PostgREST authenticated. Les écritures serveur/service_role restent
-- disponibles pour les primitives métier déterministes et les webhooks Stripe.

-- 1. Supprimer les chemins DML navigateur historiques.
drop policy if exists audit_log_insert_scope on public.audit_log;

drop policy if exists message_insert_scope on public.message;

drop policy if exists approval_request_insert_scope on public.approval_request;
drop policy if exists approval_request_update_scope on public.approval_request;

drop policy if exists regle_insert_scope on public.regle;
drop policy if exists regle_update_scope on public.regle;
drop policy if exists regle_delete_scope on public.regle;

drop policy if exists dossier_suivi_insert_scope on public.dossier_suivi;
drop policy if exists dossier_suivi_update_scope on public.dossier_suivi;

-- Une conversation porte le scope probatoire des messages. Sa création et son
-- rattachement doivent donc, eux aussi, passer par une primitive serveur.
drop policy if exists conversation_insert_scope on public.conversation;
drop policy if exists conversation_update_scope on public.conversation;

revoke all privileges on table public.audit_log from public, anon, authenticated;
revoke all privileges on table public.message from public, anon, authenticated;
revoke all privileges on table public.approval_request from public, anon, authenticated;
revoke all privileges on table public.regle from public, anon, authenticated;
revoke all privileges on table public.dossier_suivi from public, anon, authenticated;
revoke all privileges on table public.conversation from public, anon, authenticated;

-- Lecture tenant-scopée uniquement. Les policies SELECT existantes restent la
-- seconde barrière et service_role conserve ses grants antérieurs.
grant select on table public.audit_log to authenticated;
grant select on table public.message to authenticated;
grant select on table public.approval_request to authenticated;
grant select on table public.regle to authenticated;
grant select on table public.dossier_suivi to authenticated;
grant select on table public.conversation to authenticated;

-- 2. Une demande naît pending. Son identité et son payload sont immuables ;
-- seule la décision structurée peut évoluer depuis pending vers un terminal.
create or replace function public.guard_approval_request_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending'
      or new.approved_by is not null
      or new.decided_at is not null
    then
      raise exception 'approval_request_must_start_pending'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if new.id is distinct from old.id
    or new.prestataire_id is distinct from old.prestataire_id
    or new.creance_id is distinct from old.creance_id
    or new.type is distinct from old.type
    or new.requested_by_actor_type is distinct from old.requested_by_actor_type
    or new.requested_by_provider is distinct from old.requested_by_provider
    or new.payload is distinct from old.payload
    or new.created_at is distinct from old.created_at
    or new.expires_at is distinct from old.expires_at
  then
    raise exception 'approval_request_immutable_fields'
      using errcode = '42501';
  end if;

  if old.status <> 'pending' then
    if new.status is distinct from old.status
      or new.approved_by is distinct from old.approved_by
      or new.decided_at is distinct from old.decided_at
    then
      raise exception 'approval_request_terminal'
        using errcode = '23514';
    end if;

    return new;
  end if;

  case new.status
    when 'pending' then
      if new.approved_by is not null or new.decided_at is not null then
        raise exception 'approval_request_pending_has_decision'
          using errcode = '23514';
      end if;
    when 'approved', 'rejected' then
      if new.approved_by is null or new.decided_at is null then
        raise exception 'approval_request_human_decision_incomplete'
          using errcode = '23514';
      end if;
    when 'expired' then
      if new.approved_by is not null or new.decided_at is null then
        raise exception 'approval_request_expiry_invalid'
          using errcode = '23514';
      end if;
  end case;

  return new;
end;
$$;

drop trigger if exists approval_request_transition_guard
  on public.approval_request;

create trigger approval_request_transition_guard
before insert or update on public.approval_request
for each row execute function public.guard_approval_request_transition();

comment on function public.guard_approval_request_transition() is
  'SID-SEC-003 — impose une création pending, un payload/une identité immuables et des transitions de décision terminales bornées.';

revoke all on function public.guard_approval_request_transition() from public;
revoke all on function public.guard_approval_request_transition() from anon;
revoke all on function public.guard_approval_request_transition() from authenticated;
revoke all on function public.guard_approval_request_transition() from service_role;

-- 3. Commande humaine étroite : l'identité du décideur et le tenant viennent du
-- JWT vérifié, jamais des paramètres. Le verrou porte sur une seule demande ;
-- une répétition identique du même décideur est idempotente.
create or replace function public.decide_current_approval_request(
  p_approval_request_id uuid,
  p_decision public.approval_request_status
)
returns public.approval_request
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_prestataire_id uuid;
  v_existing public.approval_request;
  v_row public.approval_request;
begin
  if v_uid is null then
    raise exception 'not_authenticated'
      using errcode = '42501';
  end if;

  if p_approval_request_id is null then
    raise exception 'approval_request_id_required'
      using errcode = '22023';
  end if;

  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'approval_request_decision_invalid'
      using errcode = '22023';
  end if;

  select p.id
    into v_prestataire_id
  from public.prestataire as p
  where p.user_id = v_uid;

  if v_prestataire_id is null then
    raise exception 'approval_request_not_found'
      using errcode = 'P0002';
  end if;

  select ar.*
    into v_existing
  from public.approval_request as ar
  where ar.id = p_approval_request_id
    and ar.prestataire_id = v_prestataire_id
  for update;

  if not found then
    -- Même réponse pour un identifiant absent et un identifiant cross-tenant.
    raise exception 'approval_request_not_found'
      using errcode = 'P0002';
  end if;

  if v_existing.status = p_decision
    and v_existing.approved_by = v_uid
    and v_existing.decided_at is not null
  then
    return v_existing;
  end if;

  if v_existing.status <> 'pending' then
    raise exception 'approval_request_transition_invalid'
      using errcode = '23514';
  end if;

  if v_existing.expires_at is not null
    and v_existing.expires_at <= statement_timestamp()
  then
    update public.approval_request as ar
    set
      status = 'expired',
      approved_by = null,
      decided_at = statement_timestamp()
    where ar.id = v_existing.id
    returning ar.* into v_row;

    return v_row;
  end if;

  update public.approval_request as ar
  set
    status = p_decision,
    approved_by = v_uid,
    decided_at = statement_timestamp()
  where ar.id = v_existing.id
  returning ar.* into v_row;

  return v_row;
end;
$$;

comment on function public.decide_current_approval_request(uuid, public.approval_request_status) is
  'SID-SEC-003 — approuve ou rejette une demande pending du prestataire courant. Identité JWT, verrou de ligne, décision terminale et replay identique idempotent.';

revoke all on function public.decide_current_approval_request(uuid, public.approval_request_status)
  from public;
revoke all on function public.decide_current_approval_request(uuid, public.approval_request_status)
  from anon;
revoke all on function public.decide_current_approval_request(uuid, public.approval_request_status)
  from service_role;
grant execute on function public.decide_current_approval_request(uuid, public.approval_request_status)
  to authenticated;
