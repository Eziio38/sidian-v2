-- SID-PROD-002 — commandes métier du suivi et de l'annulation.
--
-- Cette migration reste additive et conserve les frontières SID-SEC-002..005 :
--   * les tables financières et probatoires restent SELECT-only pour authenticated ;
--   * chaque mutation passe par une commande SECURITY DEFINER tenant-scopée ;
--   * l'identité humaine vient exclusivement du JWT vérifié ;
--   * l'ordre de verrouillage est creance -> payment_link -> tentative_paiement
--     -> dossier_suivi, comme le provisioning Checkout (creance -> lien -> tentative) ;
--   * une annulation ne concurrence jamais silencieusement un paiement Stripe.
--
-- PRD V2 §4.6 et §8 : les règlements hors Sidian sont explicitement hors MVP.
-- Aucun enum, paiement ni RPC de déclaration manuelle n'est donc ajouté ici.

-- ---------------------------------------------------------------------------
-- 1. Matrice relationnelle bornée du dossier de suivi
-- ---------------------------------------------------------------------------

create or replace function public.is_dossier_suivi_transition_allowed(
  p_from public.dossier_suivi_etat,
  p_to public.dossier_suivi_etat,
  p_creance_etat public.creance_etat
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select case
    when p_from is null or p_to is null or p_creance_etat is null then false
    when p_from = p_to then true
    -- CLOS est terminal pour le dossier (Architecture V2 §2.4).
    when p_from = 'CLOS' then false
    -- Le scanner de clôture peut fermer un dossier financier terminal ;
    -- ESCALADE_HUMAINE -> CLOS est la transition explicite de la machine.
    when p_to = 'CLOS' then
      p_from = 'ESCALADE_HUMAINE'
      or p_creance_etat in ('REGLEE', 'ANNULEE', 'IRRECOUVRABLE')
    -- Progression chronologique normale.
    when p_from = 'PREVENTION' then
      p_to in (
        'ECHEANCE',
        'PAUSE_LITIGE',
        'ATTENTE_CLIENT',
        'ATTENTE_PRESTATAIRE',
        'ESCALADE_HUMAINE'
      )
    when p_from = 'ECHEANCE' then
      p_to in (
        'SUIVI_AMIABLE',
        'PAUSE_LITIGE',
        'ATTENTE_CLIENT',
        'ATTENTE_PRESTATAIRE',
        'ESCALADE_HUMAINE'
      )
    -- Les pauses et attentes peuvent reprendre en suivi amiable ou changer
    -- de cause, mais jamais revenir artificiellement avant l'échéance.
    when p_from = 'SUIVI_AMIABLE' then
      p_to in (
        'PAUSE_LITIGE',
        'ATTENTE_CLIENT',
        'ATTENTE_PRESTATAIRE',
        'ESCALADE_HUMAINE'
      )
    when p_from = 'PAUSE_LITIGE' then
      p_to in (
        'SUIVI_AMIABLE',
        'ATTENTE_CLIENT',
        'ATTENTE_PRESTATAIRE',
        'ESCALADE_HUMAINE'
      )
    when p_from = 'ATTENTE_CLIENT' then
      p_to in (
        'SUIVI_AMIABLE',
        'PAUSE_LITIGE',
        'ATTENTE_PRESTATAIRE',
        'ESCALADE_HUMAINE'
      )
    when p_from = 'ATTENTE_PRESTATAIRE' then
      p_to in (
        'SUIVI_AMIABLE',
        'PAUSE_LITIGE',
        'ATTENTE_CLIENT',
        'ESCALADE_HUMAINE'
      )
    else false
  end;
$$;

comment on function public.is_dossier_suivi_transition_allowed(
  public.dossier_suivi_etat,
  public.dossier_suivi_etat,
  public.creance_etat
) is
  'SID-PROD-002 — matrice interne des transitions relationnelles. CLOS reste terminal et indépendant de l’état financier.';

revoke all on function public.is_dossier_suivi_transition_allowed(
  public.dossier_suivi_etat,
  public.dossier_suivi_etat,
  public.creance_etat
) from public, anon, authenticated, service_role;

-- Crée au plus un dossier pour un paiement à recevoir déjà ouvert. L'état
-- initial est déterministe : litige -> pause, échéance atteinte -> échéance,
-- sinon prévention. Une créance terminale obtient un dossier déjà clos afin
-- que l'historique reste complet sans réouvrir une action relationnelle.
create or replace function public.ensure_current_dossier_suivi(
  p_creance_id uuid
)
returns public.dossier_suivi
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_prestataire_id uuid := public.require_current_prestataire_id();
  v_creance public.creance;
  v_dossier public.dossier_suivi;
  v_initial_state public.dossier_suivi_etat;
  v_now timestamptz;
  v_created boolean := false;
begin
  if p_creance_id is null then
    raise exception 'payment_receivable_id_required' using errcode = '22023';
  end if;

  -- Premier verrou de toutes les commandes de ce lot : la créance tenant-safe.
  select c.* into v_creance
  from public.creance as c
  where c.id = p_creance_id
    and c.prestataire_id = v_prestataire_id
  for update;

  if not found then
    raise exception 'payment_receivable_not_found' using errcode = 'P0002';
  end if;
  if v_creance.archived_at is not null then
    raise exception 'payment_receivable_archived' using errcode = '22023';
  end if;
  if v_creance.etat = 'BROUILLON' then
    raise exception 'payment_receivable_not_open' using errcode = '22023';
  end if;

  select d.* into v_dossier
  from public.dossier_suivi as d
  where d.creance_id = v_creance.id
  for update;

  if found then
    return v_dossier;
  end if;

  v_now := clock_timestamp();
  v_initial_state := case
    when v_creance.etat in ('REGLEE', 'ANNULEE', 'IRRECOUVRABLE') then 'CLOS'
    when v_creance.etat = 'EN_LITIGE' then 'PAUSE_LITIGE'
    when v_creance.date_echeance <= (v_now at time zone 'utc')::date then 'ECHEANCE'
    else 'PREVENTION'
  end;

  insert into public.dossier_suivi as d (
    creance_id,
    etat,
    next_action_at,
    clos_at
  )
  values (
    v_creance.id,
    v_initial_state,
    null,
    case when v_initial_state = 'CLOS' then v_now else null end
  )
  on conflict (creance_id) do nothing
  returning d.* into v_dossier;

  v_created := found;

  if not v_created then
    -- Backstop d'idempotence si une écriture privilégiée historique n'a pas
    -- respecté le verrou de créance mais a gagné l'unicité creance_id.
    select d.* into v_dossier
    from public.dossier_suivi as d
    where d.creance_id = v_creance.id
    for update;
  end if;

  if v_dossier.id is null then
    raise exception 'follow_up_case_creation_failed';
  end if;

  if v_created then
    insert into public.audit_log (
      prestataire_id,
      actor_type,
      action,
      entity_type,
      entity_id,
      metadata
    )
    values (
      v_prestataire_id,
      'human',
      'FOLLOW_UP_CASE_CREATED',
      'creance',
      v_creance.id,
      jsonb_build_object(
        'dossier_suivi_id', v_dossier.id,
        'initial_state', v_dossier.etat::text,
        'performed_by_user_id', v_uid
      )
    );
  end if;

  return v_dossier;
end;
$$;

comment on function public.ensure_current_dossier_suivi(uuid) is
  'SID-PROD-002 — crée idempotemment le dossier tenant-scopé d’un paiement à recevoir ouvert et journalise sa provenance.';

revoke all on function public.ensure_current_dossier_suivi(uuid)
  from public, anon, service_role;
grant execute on function public.ensure_current_dossier_suivi(uuid)
  to authenticated;

-- Commande relationnelle humaine. Le navigateur ne choisit ni le tenant, ni
-- la provenance, ni les écritures d'audit ; il ne fournit que l'intention
-- bornée (état cible et planification) à la commande déterministe.
create or replace function public.update_current_dossier_suivi(
  p_creance_id uuid,
  p_target_state public.dossier_suivi_etat,
  p_next_action_at timestamptz,
  p_escalation_reason text
)
returns public.dossier_suivi
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_prestataire_id uuid := public.require_current_prestataire_id();
  v_creance public.creance;
  v_existing public.dossier_suivi;
  v_row public.dossier_suivi;
  v_reason text := nullif(btrim(coalesce(p_escalation_reason, '')), '');
  v_effective_reason text;
  v_effective_next_action_at timestamptz;
  v_effective_clos_at timestamptz;
  v_now timestamptz;
  v_changed boolean;
begin
  if p_creance_id is null then
    raise exception 'payment_receivable_id_required' using errcode = '22023';
  end if;
  if p_target_state is null then
    raise exception 'follow_up_case_target_state_required' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'follow_up_case_reason_too_long' using errcode = '22023';
  end if;

  -- Même premier verrou que ensure/cancel et les flux financiers Stripe.
  select c.* into v_creance
  from public.creance as c
  where c.id = p_creance_id
    and c.prestataire_id = v_prestataire_id
  for update;

  if not found then
    raise exception 'payment_receivable_not_found' using errcode = 'P0002';
  end if;
  if v_creance.archived_at is not null then
    raise exception 'payment_receivable_archived' using errcode = '22023';
  end if;
  if v_creance.etat = 'BROUILLON' then
    raise exception 'payment_receivable_not_open' using errcode = '22023';
  end if;

  -- Réentrant sous le verrou de créance : crée le dossier si nécessaire et
  -- le verrouille jusqu'au commit de cette commande.
  v_existing := public.ensure_current_dossier_suivi(v_creance.id);

  if not public.is_dossier_suivi_transition_allowed(
    v_existing.etat,
    p_target_state,
    v_creance.etat
  ) then
    raise exception 'follow_up_case_transition_invalid' using errcode = '23514';
  end if;

  if p_target_state = 'CLOS' and p_next_action_at is not null then
    raise exception 'follow_up_case_closed_has_next_action' using errcode = '23514';
  end if;

  v_effective_reason := case
    when p_target_state in ('PAUSE_LITIGE', 'ESCALADE_HUMAINE') then
      coalesce(v_reason, v_existing.escalation_reason)
    when p_target_state = 'CLOS' then
      coalesce(v_reason, v_existing.escalation_reason)
    else v_reason
  end;

  if p_target_state in ('PAUSE_LITIGE', 'ESCALADE_HUMAINE')
    and v_effective_reason is null
  then
    raise exception 'follow_up_case_reason_required' using errcode = '22023';
  end if;

  v_now := clock_timestamp();
  v_effective_next_action_at := case
    when p_target_state = 'CLOS' then null
    else p_next_action_at
  end;
  v_effective_clos_at := case
    when p_target_state = 'CLOS' then coalesce(v_existing.clos_at, v_now)
    else null
  end;

  v_changed :=
    v_existing.etat is distinct from p_target_state
    or v_existing.next_action_at is distinct from v_effective_next_action_at
    or v_existing.escalation_reason is distinct from v_effective_reason
    or v_existing.clos_at is distinct from v_effective_clos_at;

  if not v_changed then
    return v_existing;
  end if;

  update public.dossier_suivi as d
  set
    etat = p_target_state,
    next_action_at = v_effective_next_action_at,
    escalation_reason = v_effective_reason,
    clos_at = v_effective_clos_at,
    updated_at = v_now
  where d.id = v_existing.id
  returning d.* into v_row;

  insert into public.audit_log (
    prestataire_id,
    actor_type,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_prestataire_id,
    'human',
    'FOLLOW_UP_CASE_UPDATED',
    'creance',
    v_creance.id,
    jsonb_build_object(
      'dossier_suivi_id', v_row.id,
      'from_state', v_existing.etat::text,
      'to_state', v_row.etat::text,
      'next_action_at', v_row.next_action_at,
      'reason_present', v_row.escalation_reason is not null,
      'performed_by_user_id', v_uid
    )
  );

  return v_row;
end;
$$;

comment on function public.update_current_dossier_suivi(
  uuid,
  public.dossier_suivi_etat,
  timestamptz,
  text
) is
  'SID-PROD-002 — transitionne et planifie un dossier tenant-scopé selon une matrice déterministe, avec CLOS terminal et audit idempotent.';

revoke all on function public.update_current_dossier_suivi(
  uuid,
  public.dossier_suivi_etat,
  timestamptz,
  text
) from public, anon, service_role;
grant execute on function public.update_current_dossier_suivi(
  uuid,
  public.dossier_suivi_etat,
  timestamptz,
  text
) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Annulation sûre du paiement à recevoir
-- ---------------------------------------------------------------------------

create or replace function public.cancel_current_payment_receivable(
  p_creance_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_prestataire_id uuid := public.require_current_prestataire_id();
  v_creance public.creance;
  v_dossier public.dossier_suivi;
  v_active_attempt_id uuid;
  v_paid bigint;
  v_now timestamptz;
  v_changed boolean;
  v_dossier_changed boolean := false;
  v_dossier_created boolean := false;
  v_revoked_link_count integer := 0;
  v_audit_exists boolean;
begin
  if p_creance_id is null then
    raise exception 'payment_receivable_id_required' using errcode = '22023';
  end if;

  -- 1. Créance : sérialise Checkout, webhooks financiers et cette commande.
  select c.* into v_creance
  from public.creance as c
  where c.id = p_creance_id
    and c.prestataire_id = v_prestataire_id
  for update;

  if not found then
    raise exception 'payment_receivable_not_found' using errcode = 'P0002';
  end if;
  if v_creance.archived_at is not null then
    raise exception 'payment_receivable_archived' using errcode = '22023';
  end if;
  if v_creance.etat not in ('OUVERTE', 'EN_LITIGE', 'ANNULEE') then
    raise exception 'payment_receivable_cancellation_not_allowed' using errcode = '23514';
  end if;

  -- 2. Lien, puis 3. tentative : ordre identique à claim_checkout_provisioning.
  perform 1
  from public.payment_link as pl
  where pl.creance_id = v_creance.id
    and pl.status = 'active'
  for update;

  select t.id into v_active_attempt_id
  from public.tentative_paiement as t
  where t.creance_id = v_creance.id
    and t.etat in ('CREEE', 'NECESSITE_ACTION_CLIENT', 'EN_TRAITEMENT')
  order by t.created_at, t.id
  limit 1
  for update;

  if v_active_attempt_id is not null then
    -- SQL ne peut pas prétendre annuler une Session/PI Stripe en vol. Le flux
    -- serveur doit attendre son terminal ou effectuer une réconciliation Stripe.
    raise exception 'payment_receivable_payment_in_progress' using errcode = '55000';
  end if;

  select coalesce(sum(p.montant), 0) into v_paid
  from public.paiement as p
  where p.creance_id = v_creance.id;

  if v_creance.etat <> 'ANNULEE' and v_paid > 0 then
    -- PARTIELLEMENT_REGLEE est déjà refusé par la machine ; ce backstop couvre
    -- aussi une projection historique incohérente OUVERTE avec fonds confirmés.
    raise exception 'payment_receivable_has_confirmed_payment' using errcode = '23514';
  end if;

  -- 4. Dossier : toutes les autres commandes dossier verrouillent d'abord la
  -- créance, donc aucune inversion d'ordre n'est introduite.
  select d.* into v_dossier
  from public.dossier_suivi as d
  where d.creance_id = v_creance.id
  for update;

  v_now := clock_timestamp();
  v_changed := v_creance.etat <> 'ANNULEE';

  if v_changed then
    update public.creance as c
    set
      etat = 'ANNULEE',
      updated_at = v_now
    where c.id = v_creance.id;
  end if;

  with revoked as (
    update public.payment_link as pl
    set
      status = 'revoked',
      revoked_at = coalesce(pl.revoked_at, v_now),
      updated_at = v_now
    where pl.creance_id = v_creance.id
      and pl.status = 'active'
    returning pl.id
  )
  select count(*)::integer into v_revoked_link_count
  from revoked;

  if v_dossier.id is null then
    insert into public.dossier_suivi as d (
      creance_id,
      etat,
      next_action_at,
      clos_at
    )
    values (
      v_creance.id,
      'CLOS',
      null,
      v_now
    )
    returning d.* into v_dossier;
    v_dossier_created := true;
    v_dossier_changed := true;
  elsif v_dossier.etat <> 'CLOS'
    or v_dossier.next_action_at is not null
    or v_dossier.clos_at is null
  then
    update public.dossier_suivi as d
    set
      etat = 'CLOS',
      next_action_at = null,
      clos_at = coalesce(d.clos_at, v_now),
      updated_at = v_now
    where d.id = v_dossier.id
    returning d.* into v_dossier;
    v_dossier_changed := true;
  end if;

  -- Le verrou de créance rend ce test + insert sûr sous concurrence. Il permet
  -- aussi de rapprocher une ancienne ligne ANNULEE sans dupliquer l'historique.
  select exists (
    select 1
    from public.audit_log as a
    where a.prestataire_id = v_prestataire_id
      and a.entity_type = 'creance'
      and a.entity_id = v_creance.id
      and a.action = 'PAYMENT_RECEIVABLE_CANCELLED'
  ) into v_audit_exists;

  if not v_audit_exists then
    insert into public.audit_log (
      prestataire_id,
      actor_type,
      action,
      entity_type,
      entity_id,
      metadata
    )
    values (
      v_prestataire_id,
      'human',
      'PAYMENT_RECEIVABLE_CANCELLED',
      'creance',
      v_creance.id,
      jsonb_build_object(
        'from_state', v_creance.etat::text,
        'to_state', 'ANNULEE',
        'confirmed_amount', v_paid,
        'revoked_payment_link_count', v_revoked_link_count,
        'dossier_suivi_id', v_dossier.id,
        'performed_by_user_id', v_uid
      )
    );
  end if;

  if v_dossier_changed then
    insert into public.audit_log (
      prestataire_id,
      actor_type,
      action,
      entity_type,
      entity_id,
      metadata
    )
    values (
      v_prestataire_id,
      'human',
      'FOLLOW_UP_CASE_CLOSED',
      'creance',
      v_creance.id,
      jsonb_build_object(
        'dossier_suivi_id', v_dossier.id,
        'created_during_cancellation', v_dossier_created,
        'reason', 'payment_receivable_cancelled',
        'performed_by_user_id', v_uid
      )
    );
  end if;

  return jsonb_build_object(
    'creance_id', v_creance.id,
    'creance_state', 'ANNULEE',
    'changed', v_changed,
    'confirmed_amount', v_paid,
    'revoked_payment_link_count', v_revoked_link_count,
    'dossier_suivi_id', v_dossier.id,
    'dossier_state', v_dossier.etat::text,
    'dossier_changed', v_dossier_changed,
    'cancelled_at', v_dossier.clos_at
  );
end;
$$;

comment on function public.cancel_current_payment_receivable(uuid) is
  'SID-PROD-002 — annulation humaine tenant-safe, atomique et idempotente. Refuse les fonds confirmés et toute tentative Stripe non terminale, révoque le lien, clôt le dossier et audite.';

revoke all on function public.cancel_current_payment_receivable(uuid)
  from public, anon, service_role;
grant execute on function public.cancel_current_payment_receivable(uuid)
  to authenticated;

-- L'ancien enum detecte_hors_sidian reste réservé à l'architecture différée.
-- Il n'est exposé par aucune commande authenticated et ne doit pas être utilisé
-- tant que le PRD V2 maintient l'agrégation/réconciliation hors du MVP.
comment on type public.paiement_source is
  'Sources de règlements confirmés. detecte_hors_sidian est historique/réservé et non utilisable au MVP ; aucun règlement hors Sidian n’est déclaré manuellement.';
