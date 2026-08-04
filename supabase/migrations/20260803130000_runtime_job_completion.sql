-- SID-RUNTIME-CONSUMER — fermeture de la chaîne d'automatisation
--
-- `claim_runtime_jobs` existait sans contrepartie : aucune fonction ne
-- permettait de terminer ni d'échouer un job. Les scanners écrivaient donc
-- dans `runtime_job` sans qu'aucun consommateur ne puisse acquitter le
-- travail. Cette migration ajoute les deux fonctions manquantes, plus la
-- clôture de dossier — le seul effet métier entièrement interne, qui ne
-- dépend d'aucun fournisseur externe ni d'aucun arbitrage produit.
--
-- Aucun effet Stripe / WhatsApp / Email / LLM ici.

-- ---------------------------------------------------------------------------
-- 1. complete_runtime_job — acquittement clôturé par le lease
-- ---------------------------------------------------------------------------

create or replace function public.complete_runtime_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_now timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_updated integer;
begin
  -- Le lease fait office de jeton de fencing : un worker dont le lease a
  -- expiré (et dont le job a été repris par un autre) ne peut plus acquitter.
  update public.runtime_job j
  set
    status = 'completed',
    lease_token = null,
    lease_expires_at = null,
    last_error_code = null,
    completed_at = v_now
  where j.id = p_job_id
    and j.status = 'claimed'
    and j.lease_token = p_lease_token
    and j.lease_expires_at > v_now;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

comment on function public.complete_runtime_job(uuid, uuid, timestamptz) is
  'Acquitte un runtime_job claimé. Retourne false si le lease est perdu ou expiré.';

revoke all on function public.complete_runtime_job(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.complete_runtime_job(uuid, uuid, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. fail_runtime_job — backoff exponentiel et plafond de tentatives
-- ---------------------------------------------------------------------------

create or replace function public.fail_runtime_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_retryable boolean default true,
  p_max_attempts integer default 5,
  p_backoff_base_seconds integer default 60,
  p_now timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_max integer := greatest(1, least(coalesce(p_max_attempts, 5), 32));
  v_base integer := greatest(1, least(coalesce(p_backoff_base_seconds, 60), 3600));
  v_job public.runtime_job;
  v_status public.runtime_job_status;
  v_delay integer;
begin
  select j.* into v_job
  from public.runtime_job j
  where j.id = p_job_id
    and j.status = 'claimed'
    and j.lease_token = p_lease_token
    and j.lease_expires_at > v_now
  for update;

  if not found then
    -- Lease perdu : un autre worker détient le job, on ne touche à rien.
    return 'lease_lost';
  end if;

  -- Une erreur non rejouable, ou l'épuisement des tentatives, met le job en
  -- échec terminal : il sort de la file au lieu de la bloquer indéfiniment.
  if coalesce(p_retryable, true) = false or v_job.attempt_count >= v_max then
    v_status := 'failed_terminal';

    update public.runtime_job j
    set
      status = v_status,
      lease_token = null,
      lease_expires_at = null,
      last_error_code = left(nullif(btrim(p_error_code), ''), 100),
      completed_at = v_now
    where j.id = v_job.id;

    return v_status::text;
  end if;

  -- Backoff exponentiel borné : 60 s, 120 s, 240 s… plafonné à 1 h.
  v_delay := least(v_base * power(2, greatest(0, v_job.attempt_count - 1))::integer, 3600);
  v_status := 'failed_retryable';

  update public.runtime_job j
  set
    status = v_status,
    lease_token = null,
    lease_expires_at = null,
    last_error_code = left(nullif(btrim(p_error_code), ''), 100),
    available_at = v_now + make_interval(secs => v_delay),
    completed_at = null
  where j.id = v_job.id;

  return v_status::text;
end;
$$;

comment on function public.fail_runtime_job(
  uuid, uuid, text, boolean, integer, integer, timestamptz
) is
  'Échec d''un runtime_job : backoff exponentiel borné, puis échec terminal au plafond de tentatives.';

revoke all on function public.fail_runtime_job(
  uuid, uuid, text, boolean, integer, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.fail_runtime_job(
  uuid, uuid, text, boolean, integer, integer, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- 3. runtime_close_dossier — effet métier du job closure_close_dossier
-- ---------------------------------------------------------------------------
--
-- Piloté par un worker service_role, donc sans `auth.uid()` : le périmètre
-- vient de la créance elle-même, jamais d'un identifiant fourni par l'appelant
-- au-delà de l'identifiant de créance déjà porté par le job.
--
-- La transition est soumise à `is_dossier_suivi_transition_allowed`, qui
-- n'autorise CLOS que depuis ESCALADE_HUMAINE ou lorsque la créance est dans
-- un état financier terminal. Le worker ne contourne donc aucune règle.

create or replace function public.runtime_close_dossier(
  p_creance_id uuid,
  p_now timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_creance public.creance;
  v_dossier public.dossier_suivi;
begin
  if p_creance_id is null then
    raise exception 'runtime_close_dossier_creance_required' using errcode = '22023';
  end if;

  select c.* into v_creance
  from public.creance as c
  where c.id = p_creance_id
  for update;

  if not found then
    return 'creance_not_found';
  end if;

  -- Garde-fou indépendant du scanner : seule une créance financièrement
  -- terminale peut entraîner la clôture automatique de son dossier.
  if v_creance.etat not in ('REGLEE', 'ANNULEE', 'IRRECOUVRABLE') then
    return 'creance_not_terminal';
  end if;

  select d.* into v_dossier
  from public.dossier_suivi as d
  where d.creance_id = v_creance.id
  for update;

  if not found then
    -- Créance terminale sans dossier : on le crée directement clos, plutôt
    -- que de laisser un dossier fantôme derrière une créance réglée.
    insert into public.dossier_suivi as d (creance_id, etat, clos_at)
    values (v_creance.id, 'CLOS', v_now)
    on conflict (creance_id) do nothing
    returning d.* into v_dossier;

    if v_dossier.id is null then
      -- Course avec un autre worker : l'autre a créé le dossier, on relit.
      select d.* into v_dossier
      from public.dossier_suivi as d
      where d.creance_id = v_creance.id;
    else
      insert into public.audit_log (
        prestataire_id, actor_type, action, entity_type, entity_id, metadata
      ) values (
        v_creance.prestataire_id, 'system', 'dossier_suivi.closed_by_runtime',
        'dossier_suivi', v_dossier.id,
        jsonb_build_object('creance_etat', v_creance.etat, 'created_closed', true)
      );
      return 'closed';
    end if;
  end if;

  -- Idempotence : rejouer le job sur un dossier déjà clos est un succès.
  if v_dossier.etat = 'CLOS' then
    return 'already_closed';
  end if;

  if not public.is_dossier_suivi_transition_allowed(
    v_dossier.etat, 'CLOS', v_creance.etat
  ) then
    return 'transition_forbidden';
  end if;

  update public.dossier_suivi as d
  set
    etat = 'CLOS',
    clos_at = v_now,
    next_action_at = null,
    last_agent_action_at = v_now
  where d.id = v_dossier.id;

  insert into public.audit_log (
    prestataire_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    v_creance.prestataire_id, 'system', 'dossier_suivi.closed_by_runtime',
    'dossier_suivi', v_dossier.id,
    jsonb_build_object(
      'creance_etat', v_creance.etat,
      'previous_etat', v_dossier.etat,
      'created_closed', false
    )
  );

  return 'closed';
end;
$$;

comment on function public.runtime_close_dossier(uuid, timestamptz) is
  'Clôture pilotée par le worker runtime — idempotente, soumise aux transitions du dossier, tracée dans audit_log.';

revoke all on function public.runtime_close_dossier(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.runtime_close_dossier(uuid, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Observabilité : profondeur de file par type de job
-- ---------------------------------------------------------------------------
--
-- Sans cette vue, un type de job sans consommateur s'accumule en silence.

create or replace function public.runtime_job_backlog(
  p_now timestamptz default null
)
returns table (
  job_kind public.runtime_job_kind,
  status public.runtime_job_status,
  total bigint,
  due_now bigint,
  oldest_created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    j.job_kind,
    j.status,
    count(*) as total,
    count(*) filter (
      where j.available_at <= coalesce(p_now, timezone('utc', now()))
    ) as due_now,
    min(j.created_at) as oldest_created_at
  from public.runtime_job j
  where j.status in ('pending', 'claimed', 'failed_retryable')
  group by j.job_kind, j.status;
$$;

revoke all on function public.runtime_job_backlog(timestamptz)
  from public, anon, authenticated;
grant execute on function public.runtime_job_backlog(timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Relâchement d'un job claimé mais non traité
-- ---------------------------------------------------------------------------
--
-- Le consommateur borne son lot au budget du cron : quand la deadline tombe au
-- milieu d'un lot, les jobs déjà claimés n'ont pas été tentés. Sans relâchement
-- explicite ils restent `claimed` jusqu'à expiration du lease, puis sont
-- repris par `claim_runtime_jobs` — qui incrémente `attempt_count` à chaque
-- reprise. Un job pris en fin de lot à chaque passage épuisait donc ses
-- tentatives sans avoir jamais été exécuté, et finissait par violer la
-- contrainte `attempt_count <= 32`, faisant échouer la RPC pour tout le lot.
--
-- On rend la tentative : elle n'a pas eu lieu.

create or replace function public.release_runtime_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_now timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_updated integer;
begin
  update public.runtime_job j
  set
    status = 'pending',
    lease_token = null,
    lease_expires_at = null,
    -- La tentative est rendue : le job n'a pas été exécuté.
    attempt_count = greatest(0, j.attempt_count - 1),
    last_error_code = null
  where j.id = p_job_id
    and j.status = 'claimed'
    and j.lease_token = p_lease_token
    and j.lease_expires_at > v_now;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

comment on function public.release_runtime_job(uuid, uuid, timestamptz) is
  'Rend au pool un job claimé mais non tenté, sans consommer de tentative.';

revoke all on function public.release_runtime_job(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.release_runtime_job(uuid, uuid, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. Garde-fou de dernier recours sur claim_runtime_jobs
-- ---------------------------------------------------------------------------
--
-- Défense en profondeur : même si un job échappait au relâchement ci-dessus
-- (crash du worker, lease expiré sans reprise), il ne doit jamais atteindre la
-- borne de la contrainte et faire échouer le claim de tout le lot. Au-delà du
-- plafond, il cesse simplement d'être éligible et reste visible dans le
-- backlog pour inspection.

create or replace function public.claim_runtime_jobs(
  p_now timestamptz,
  p_lease_seconds integer,
  p_batch_size integer,
  p_job_kinds public.runtime_job_kind[] default null
)
returns setof public.runtime_job
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_lease integer := coalesce(p_lease_seconds, 120);
  v_batch integer := coalesce(p_batch_size, 50);
  v_token uuid := gen_random_uuid();
begin
  if v_lease < 30 or v_lease > 600 then
    raise exception 'runtime_lease_seconds_invalid';
  end if;
  if v_batch < 1 or v_batch > 200 then
    raise exception 'runtime_batch_size_invalid';
  end if;

  return query
  with picked as (
    select j.id
    from public.runtime_job j
    where j.available_at <= v_now
      -- Borne haute stricte : `attempt_count` est incrémenté par ce claim,
      -- et la contrainte de table plafonne à 32.
      and j.attempt_count < 32
      and (
        j.status = 'pending'
        or j.status = 'failed_retryable'
        or (j.status = 'claimed' and j.lease_expires_at <= v_now)
      )
      and (
        p_job_kinds is null
        or j.job_kind = any (p_job_kinds)
      )
    order by j.available_at, j.created_at
    for update skip locked
    limit v_batch
  )
  update public.runtime_job j
  set
    status = 'claimed',
    attempt_count = j.attempt_count + 1,
    lease_token = v_token,
    lease_expires_at = v_now + make_interval(secs => v_lease),
    last_error_code = null
  from picked p
  where j.id = p.id
  returning j.*;
end;
$$;

revoke all on function public.claim_runtime_jobs(
  timestamptz, integer, integer, public.runtime_job_kind[]
) from public, anon, authenticated;
grant execute on function public.claim_runtime_jobs(
  timestamptz, integer, integer, public.runtime_job_kind[]
) to service_role;
