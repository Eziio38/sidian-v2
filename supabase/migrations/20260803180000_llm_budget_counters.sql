-- SID-OPS-001 — Compteurs de budget LLM durables + tête de migration exposée.
--
-- POURQUOI (budget) : `src/lib/llm/budget.ts` tenait ses compteurs dans un
-- `new Map()` process-local. Sur une plateforme serverless chaque instance
-- possède sa propre copie : le plafond configuré (SIDIAN_LLM_BUDGET_MAX_*)
-- est de fait multiplié par le nombre d'instances vivantes, facteur inconnu
-- et non borné. Le compteur doit donc vivre dans une ressource partagée et
-- l'incrément doit être atomique (lecture + écriture dans la même
-- transaction, ligne verrouillée), sinon deux requêtes concurrentes lisent
-- la même valeur et franchissent le plafond ensemble.
--
-- POURQUOI (empreinte) : le scope n'est jamais stocké en clair. L'application
-- envoie une empreinte SHA-256 (64 hex) ; aucun identifiant de tenant, aucune
-- adresse, aucun contenu métier ne transite ni ne persiste dans cette table.
-- La contrainte de format ci-dessous rend cette règle non contournable.
--
-- POURQUOI (tête de migration) : /api/health doit pouvoir répondre « quel
-- schéma tourne réellement » lors d'un incident, sans accès psql au projet.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Table de compteurs fenêtrés
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.llm_budget_counter (
  scope_fingerprint text not null,
  window_kind text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  token_count bigint not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint llm_budget_counter_pkey
    primary key (scope_fingerprint, window_kind, window_start),
  constraint llm_budget_counter_window_kind_check
    check (window_kind in ('minute', 'hour')),
  -- 'global' est le seul littéral admis ; tout le reste doit être une
  -- empreinte SHA-256 hexadécimale minuscule. Interdit de facto d'écrire
  -- un identifiant métier ou une donnée personnelle dans cette colonne.
  constraint llm_budget_counter_scope_fingerprint_check
    check (
      scope_fingerprint = 'global'
      or scope_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  constraint llm_budget_counter_counts_check
    check (request_count >= 0 and token_count >= 0)
);

comment on table public.llm_budget_counter is
  'Compteurs de budget LLM partagés entre instances. Une ligne par (scope, type de fenêtre, début de fenêtre). '
  'scope_fingerprint = ''global'' ou empreinte SHA-256 : jamais de donnée métier en clair.';

create index if not exists llm_budget_counter_expires_at_idx
  on public.llm_budget_counter (expires_at);

alter table public.llm_budget_counter enable row level security;

-- Aucune policy n'est créée : la table est inaccessible à anon et authenticated.
-- Seul service_role (qui contourne RLS) et les fonctions SECURITY DEFINER
-- ci-dessous y touchent.
revoke all on table public.llm_budget_counter from public;
revoke all on table public.llm_budget_counter from anon;
revoke all on table public.llm_budget_counter from authenticated;

-- service_role obtient la lecture (diagnostic d'incident, cf. docs/OPERATIONS.md)
-- et la suppression (réinitialisation d'urgence d'une fenêtre), mais PAS
-- insert/update : les compteurs ne sont écrits que par les fonctions
-- ci-dessous, seul endroit où l'incrément est atomique et vérifié.
grant select, delete on table public.llm_budget_counter to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Réservation atomique (incrémente et vérifie dans la même transaction)
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.llm_budget_consume(
  p_scope_fingerprint text,
  p_estimated_tokens integer,
  p_max_requests_per_minute integer,
  p_max_tokens_per_minute integer,
  p_max_requests_per_scope_per_hour integer,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_minute_start timestamptz := date_trunc('minute', v_now);
  v_hour_start timestamptz := date_trunc('hour', v_now);
  v_tokens integer := greatest(coalesce(p_estimated_tokens, 0), 0);
  v_global_requests integer;
  v_global_tokens bigint;
  v_scope_requests integer := 0;
begin
  if p_max_requests_per_minute is null or p_max_requests_per_minute < 1
    or p_max_tokens_per_minute is null or p_max_tokens_per_minute < 1
    or p_max_requests_per_scope_per_hour is null
    or p_max_requests_per_scope_per_hour < 1
  then
    raise exception 'llm_budget_limits_invalid' using errcode = '22023';
  end if;

  if p_scope_fingerprint is not null
    and p_scope_fingerprint <> ''
    and p_scope_fingerprint !~ '^[0-9a-f]{64}$'
  then
    -- Fail-closed : un scope non haché signale un appelant qui n'applique pas
    -- la redaction. On refuse plutôt que d'écrire une donnée potentiellement
    -- personnelle.
    raise exception 'llm_budget_scope_not_fingerprinted' using errcode = '22023';
  end if;

  -- Ordre stable fenêtre globale → fenêtre de scope : deux transactions
  -- concurrentes verrouillent les lignes dans le même ordre, pas d'interblocage.
  -- L'upsert « neutre » sert uniquement à créer la ligne si absente ET à la
  -- verrouiller : la lecture qui suit ne peut plus être doublée.
  insert into public.llm_budget_counter as c (
    scope_fingerprint, window_kind, window_start, expires_at
  )
  values ('global', 'minute', v_minute_start, v_minute_start + interval '10 minutes')
  on conflict (scope_fingerprint, window_kind, window_start)
    do update set expires_at = c.expires_at
  returning c.request_count, c.token_count
  into v_global_requests, v_global_tokens;

  if v_global_requests >= p_max_requests_per_minute then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'llm_rpm_exceeded',
      'global_requests', v_global_requests,
      'global_tokens', v_global_tokens,
      'scope_requests', 0
    );
  end if;

  if v_global_tokens + v_tokens > p_max_tokens_per_minute then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'llm_tpm_exceeded',
      'global_requests', v_global_requests,
      'global_tokens', v_global_tokens,
      'scope_requests', 0
    );
  end if;

  if p_scope_fingerprint is not null and p_scope_fingerprint <> '' then
    insert into public.llm_budget_counter as c (
      scope_fingerprint, window_kind, window_start, expires_at
    )
    values (p_scope_fingerprint, 'hour', v_hour_start, v_hour_start + interval '3 hours')
    on conflict (scope_fingerprint, window_kind, window_start)
      do update set expires_at = c.expires_at
    returning c.request_count
    into v_scope_requests;

    if v_scope_requests >= p_max_requests_per_scope_per_hour then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'llm_scope_hourly_exceeded',
        'global_requests', v_global_requests,
        'global_tokens', v_global_tokens,
        'scope_requests', v_scope_requests
      );
    end if;

    update public.llm_budget_counter as c
      set request_count = c.request_count + 1,
          updated_at = v_now
    where c.scope_fingerprint = p_scope_fingerprint
      and c.window_kind = 'hour'
      and c.window_start = v_hour_start
    returning c.request_count into v_scope_requests;
  end if;

  update public.llm_budget_counter as c
    set request_count = c.request_count + 1,
        token_count = c.token_count + v_tokens,
        updated_at = v_now
  where c.scope_fingerprint = 'global'
    and c.window_kind = 'minute'
    and c.window_start = v_minute_start
  returning c.request_count, c.token_count
  into v_global_requests, v_global_tokens;

  return jsonb_build_object(
    'allowed', true,
    'reason', null,
    'global_requests', v_global_requests,
    'global_tokens', v_global_tokens,
    'scope_requests', v_scope_requests
  );
end;
$$;

comment on function public.llm_budget_consume(text, integer, integer, integer, integer, timestamptz) is
  'Réserve une requête LLM de façon atomique et partagée entre instances. '
  'Retourne {allowed, reason, global_requests, global_tokens, scope_requests}. '
  'Les plafonds sont fournis par l''appelant (SIDIAN_LLM_BUDGET_MAX_*). '
  'p_now permet des fenêtres déterministes en test.';

revoke all on function public.llm_budget_consume(text, integer, integer, integer, integer, timestamptz)
  from public;
revoke all on function public.llm_budget_consume(text, integer, integer, integer, integer, timestamptz)
  from anon;
revoke all on function public.llm_budget_consume(text, integer, integer, integer, integer, timestamptz)
  from authenticated;
grant execute on function public.llm_budget_consume(text, integer, integer, integer, integer, timestamptz)
  to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Enregistrement de la consommation réelle (après succès du provider)
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.llm_budget_record_usage(
  p_tokens integer,
  p_now timestamptz default null
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_minute_start timestamptz := date_trunc('minute', v_now);
  v_tokens integer := greatest(coalesce(p_tokens, 0), 0);
  v_total bigint;
begin
  insert into public.llm_budget_counter as c (
    scope_fingerprint, window_kind, window_start, token_count, expires_at
  )
  values ('global', 'minute', v_minute_start, v_tokens, v_minute_start + interval '10 minutes')
  on conflict (scope_fingerprint, window_kind, window_start)
    do update set token_count = c.token_count + v_tokens,
                  updated_at = v_now
  returning c.token_count into v_total;

  return v_total;
end;
$$;

comment on function public.llm_budget_record_usage(integer, timestamptz) is
  'Ajoute la consommation réelle de tokens à la fenêtre minute globale. '
  'Appelé après succès du provider ; ne refuse jamais.';

revoke all on function public.llm_budget_record_usage(integer, timestamptz) from public;
revoke all on function public.llm_budget_record_usage(integer, timestamptz) from anon;
revoke all on function public.llm_budget_record_usage(integer, timestamptz) from authenticated;
grant execute on function public.llm_budget_record_usage(integer, timestamptz)
  to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Purge des fenêtres expirées (même contrat que les rate-limits publics)
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.purge_expired_llm_budget_counters(
  p_batch_size integer default 1000,
  p_now timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_deleted integer;
  v_now timestamptz := coalesce(p_now, now());
begin
  if p_batch_size < 1 or p_batch_size > 10000 then
    raise exception 'llm_budget_purge_batch_invalid' using errcode = '22023';
  end if;

  with expired as (
    select c.scope_fingerprint, c.window_kind, c.window_start
    from public.llm_budget_counter c
    where c.expires_at <= v_now
    order by c.expires_at asc, c.scope_fingerprint asc, c.window_start asc
    limit p_batch_size
    for update skip locked
  )
  delete from public.llm_budget_counter c
  using expired e
  where c.scope_fingerprint = e.scope_fingerprint
    and c.window_kind = e.window_kind
    and c.window_start = e.window_start;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.purge_expired_llm_budget_counters(integer, timestamptz) is
  'Purge par lots les fenêtres de budget LLM expirées. Les appelants doivent boucler jusqu''à 0.';

revoke all on function public.purge_expired_llm_budget_counters(integer, timestamptz) from public;
revoke all on function public.purge_expired_llm_budget_counters(integer, timestamptz) from anon;
revoke all on function public.purge_expired_llm_budget_counters(integer, timestamptz) from authenticated;
grant execute on function public.purge_expired_llm_budget_counters(integer, timestamptz)
  to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Tête de migration — diagnostic /api/health authentifié
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.schema_migration_head()
returns text
language sql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select max(m.version)
  from supabase_migrations.schema_migrations m;
$$;

comment on function public.schema_migration_head() is
  'Version de la dernière migration appliquée. Diagnostic opérationnel uniquement : '
  'exposé par /api/health derrière CRON_SECRET, jamais publiquement.';

revoke all on function public.schema_migration_head() from public;
revoke all on function public.schema_migration_head() from anon;
revoke all on function public.schema_migration_head() from authenticated;
grant execute on function public.schema_migration_head() to service_role;
