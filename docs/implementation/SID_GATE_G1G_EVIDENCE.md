# SIDIAN — Preuve de lot G1-G (synthèse versionnée)

**Lot :** G1-G — Idempotency Service persistant fail-closed + pont Router  
**Gate G1 global :** toujours **NOT EXECUTED / non PASS**  
**Date UTC :** 2026-07-24T21:32:00Z  
**SHA testé :** `f7c64ff8146c7d9170e31847c895eb2cb7e49ddf`  
*(SHA = HEAD au moment de la validation Vitest / harness ; working tree non commitée.)*

> Synthèse humaine. Non réécrite automatiquement par le harness.

## Fichiers livrés

### Multitask (service + migration + tests)

| Fichier | Rôle |
|---|---|
| `supabase/migrations/20260724230000_g1g_agent_idempotency.sql` | Table `agent_idempotency_records` + RPC atomiques `claim_idempotency_key` / `complete_idempotency_record` / `fail_idempotency_record` |
| `src/lib/agent/idempotency/**` | `createIdempotencyService`, `buildRequestFingerprint`, repository Supabase injecté |
| `src/lib/agent/idempotency/*.test.ts` + fixtures | 22 tests unitaires (fingerprint + claim/complete/fail) |
| `scripts/test-g1-g-agent-idempotency.mjs` | 16 assertions SQL / RLS / concurrence (Postgres local) |

### Intégration Router (ce lot)

| Fichier | Rôle |
|---|---|
| `src/lib/agent/router/types.ts` | `idempotencyService?: IdempotencyService` + `idempotency_key?` sur `ToolRouteRequest` |
| `src/lib/agent/router/request-schema.ts` | `idempotency_key` schéma strict |
| `src/lib/agent/router/error-codes.ts` | `IDEMPOTENCY_KEY_CONFLICT` / `IN_PROGRESS` / `UNAVAILABLE` / `REPLAY_FAILURE` / `COMPLETION_FAILED` |
| `src/lib/agent/router/router.ts` | Ordre : validate → resolve → args → authorize → fingerprint → claim → exécuteur **ssi acquired** → complete/fail → audit → return |
| `src/lib/agent/router/audit-emit.ts` | `hashIdempotencyKey` + champs audit G1-G |
| `src/lib/agent/router/router.test.ts` | +9 tests G1-G (acquired / replay / conflict / fail / completion / taxonomie) |
| `src/lib/agent/router/test-fixtures/idempotency-service.ts` | Spy / controlled IdempotencyService |

### Audit G1-E (extension sanitizée)

| Champ | Sens |
|---|---|
| `idempotency_key_hash` | SHA-256 de la clé — **jamais** la clé brute dans le chemin Router |
| `idempotency_status` | décision / issue (acquired, replay_*, conflict, completed, failed, …) |
| `replayed` | true si rejeu sans nouvel effet |
| `request_fingerprint` | empreinte d’intention claimée |
| `execution_outcome` | `not_started` \| `executed` \| `replayed` \| `indeterminate` |

`idempotency_key` en clair reste accepté en schéma (fixtures G1-E legacy) — le Router n’émet que le hash.

### Catalogue / scripts / preuve

| Fichier | Changement |
|---|---|
| `package.json` | `test:g1-g`, `test:g1-g:sql` |
| `scripts/g1/catalog.yaml` | TOOL-013/015 → **partial** ; TOOL-022 partial enrichi ; TOOL-026 **exact** + codes idempotence |
| `docs/implementation/SID_GATE_G1G_EVIDENCE.md` | cette preuve |

## Architecture

```
route(request, context.now)
  1. validation requête + contexte
  2. resolve outil / callable
  3. validate args
  4. authorize (Permission)
  5. si idempotency_key :
       fingerprint → claim
  6. traiter décision claim
       replay_* / conflict / in_progress / unavailable → blocked|success, JAMAIS exécuteur
  7. exécuteur **ssi** acquired (ou pas de clé) — une seule fois, pas de retry
  8. validate sortie
  9. complete (succès) | fail (erreur métier/technique) — sanitizé
 10. audit.build (+ append si sink)
 11. return
```

### Règles critiques

| Règle | Comportement |
|---|---|
| Pas de claim avant args+auth | deny / INVALID_ARGUMENT → `claimCount = 0` |
| Pas d’exécuteur sans `acquired` | conflict / in_progress / unavailable / replay → `callCount = 0` |
| `complete` avant return succès | record `succeeded` avant audit |
| Échec `complete` après effet | `IDEMPOTENCY_COMPLETION_FAILED` + `execution_outcome=indeterminate` — **ne prétend pas** effet annulé |
| Échec audit après `complete` | `AUDIT_PERSISTENCE_FAILED` (fail-closed G1-F) ; record idempotent **reste terminal** |
| Clé sans service | `IDEMPOTENCY_UNAVAILABLE` fail-closed |
| Pas de clé | compat G1-D/E/F (pas de claim) |

### Contenu interdit

Clé brute dans audit Router, owner_token, secrets, stack, SQL PostgREST, arguments/sortie bruts dans `terminal_result`.

## Migration / RPC (résumé)

- Table `public.agent_idempotency_records` — UNIQUE `(tenant_id, idempotency_key)`.
- Statuts : `in_progress` | `succeeded` | `failed`.
- Claim atomique (INSERT … ON CONFLICT / `FOR UPDATE`) — décisions SQL : `acquired` | `replay_succeeded` | `replay_failed` | `conflict` | `in_progress` | `expired_reacquired`.
- RLS : lecture scoped tenant ; mutations via `service_role` / RPC confiance.
- Distinct des clés Stripe / webhooks (`checkout` / `audit_log` métier).

## Tests unitaires Idempotency (22)

Fingerprint 1–7 · Service 8–20 (clé absente, acquired, replay, conflict, in_progress, expire, unavailable, owner mismatch, sanitization, pas de SQL/stack).

## Tests Router G1-G (+9 → 48 total)

- acquired → exécuteur 1× + complete  
- replay_success → jamais exécuteur  
- conflict / in_progress / unavailable → jamais exécuteur  
- clé sans service → unavailable  
- pas de claim avant args/deny  
- erreur métier → fail  
- complete échoue après effet → indeterminate  
- audit échoue après complete → fail-closed, record terminal  
- taxonomie IDEMPOTENCY_* (EVAL-TOOL-026)

## SQL / RLS / concurrence (16/16)

```
pnpm test:g1-g:sql
# ≡ guard + node scripts/test-g1-g-agent-idempotency.mjs
```

Couverture : claims concurrents, pas de double owner, conflict fingerprint, reprise après expiration, owner mismatch, terminal non réclamable, isolation tenant, anonyme, contraintes, unicité, atomicité claim.

*Note : simulation d’expiration dans le script met à jour `started_at` + `expires_at` pour respecter `expires_after_start_ck`.*

## EVAL catalogue — exactes

| EVAL | Statut |
|---|---|
| `EVAL-TOOL-026` | **exact** (G1-D + codes idempotence G1-G, exécuteur non appelé) |
| Exactes G1-B/C/D antérieures | inchangées |

**Aucune nouvelle exact** sur TOOL-013 / TOOL-015 / TOOL-022 (volontaire).

## EVAL catalogue — partial (G1-G)

| EVAL | Motif partial |
|---|---|
| `EVAL-TOOL-013` | claim/replay même clé ; absents : Stripe réel, backoff agent, atomicité externe |
| `EVAL-TOOL-015` | doublon intention → replay ; absents : clé systématique fiche, exactly-once métier |
| `EVAL-TOOL-022` | audit + hash clé / fingerprint / outcome ; absents : mission, clé auto, atomicité effet↔audit |
| `EVAL-MODE-011` | **hors catalogue** (préfixe MODE) — partial via G1-C `VALIDATION_SCOPE_MISMATCH` / TOOL-017 ; **pas** G1-G (anti-rejeu approbation ≠ clé outil) |

## Absents documentés (pas d’exact / pas exactly-once)

- Exactly-once effet externe (Stripe / Domain Service)  
- Crash entre effet exécuteur et `complete()` → compensation / saga  
- Backoff / retry policy productisée  
- Construction automatique de `idempotency_key` depuis la fiche outil  
- Confusion avec anti-rejeu **webhook** Stripe (SEC-010 / PAY-012) — hors table agent  
- `mission_id` / Workflow Engine

## Résultat Vitest

```
pnpm test:g1-g
Test Files  3 passed (3)
Tests       70 passed (70)   # 22 idempotency + 48 router

pnpm test:g1-f  → 16 passed
pnpm test:g1-e  → 19 passed
pnpm test:g1-d  → 48 passed
pnpm test:g1-c  → 28 passed
```

## Résultat SQL

```
pnpm test:g1-g:sql
G1-G SQL/RLS/concurrence: 16/16 passés
```

*(Migration appliquée en local via `node`/`pg` — CLI `supabase` cassée sur `experimental.pgdelta` / `local_smtp`.)*

## Résultat harness G1-A

```
pnpm test:g1-a
PASS=12 FAIL=0 BLOCKED=80
```

`pnpm test:g1-a:strict` — inventaire strict sur préfixes TOOL/SEC/OBS/PAY.

## Rapport brief (15 points)

1. **Fichiers** : migration + service + pont Router + audit étendu + tests + catalog + preuve.  
2. **Multitask** : conservé et branché (`idempotencyService` injecté).  
3. **Migration/RPC** : table + claim/complete/fail atomiques, RLS.  
4. **Tests unitaires** : 22 OK (+ 9 Router G1-G).  
5. **Concurrence** : 1 seul `acquired` sur claims parallèles.  
6. **RLS** : isolation tenant, anonyme refusé.  
7. **Harness** : PASS bindings G1-G ; gate global non PASS.  
8. **EVAL exact** : TOOL-026 (taxonomie + codes idempotence).  
9. **EVAL partial** : TOOL-013 / 015 / 022 ; MODE-011 documenté partial (G1-C).  
10. **Exécuteur sans acquired** : impossible (tests conflict/unavailable/replay).  
11. **Replay sans exécuteur** : `replay_success` → `callCount` inchangé.  
12. **Complete échoue après effet** : `IDEMPOTENCY_COMPLETION_FAILED` + `indeterminate`.  
13. **Pas exactly-once externe** : documenté ; pas de compensation.  
14. **Pas secret/token/stack** : hash clé, messages sûrs, sanitization terminal.  
15. **Pas commit** : working tree non commitée ; pas de push ; pas de G1-H.
