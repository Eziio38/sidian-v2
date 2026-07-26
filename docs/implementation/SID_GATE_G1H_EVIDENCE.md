# SIDIAN — Preuve de lot G1-H (synthèse versionnée)

**Lot :** G1-H — Human Approval Service persistant + pont Permission / Router  
**Gate G1 global :** toujours **NOT EXECUTED / non PASS**  
**Date UTC :** 2026-07-24T22:00:00Z  
**SHA testé :** `f7c64ff8146c7d9170e31847c895eb2cb7e49ddf`  
*(SHA = HEAD au moment de la validation Vitest / harness ; working tree non commitée.)*

> Synthèse humaine. Non réécrite automatiquement par le harness.

## Fichiers livrés

### Multitask (service + migration + tests)

| Fichier | Rôle |
|---|---|
| `supabase/migrations/20260724240000_g1h_human_approvals.sql` | Table `agent_human_approvals` + RPC `create_human_approval` / `decide_human_approval` / `consume_human_approval` / `get_human_approval_status` |
| `src/lib/agent/approvals/**` | `createHumanApprovalService`, `toTrustedHumanValidation`, fingerprint G1-G réutilisé, repository Supabase injecté |
| `src/lib/agent/approvals/*.test.ts` + fixtures | 30 tests unitaires |
| `scripts/test-g1-h-agent-approvals.mjs` | 17 assertions SQL / RLS / concurrence (fail-closed si table absente) |

### Intégration Permission + Router (ce lot)

| Fichier | Rôle |
|---|---|
| `src/lib/agent/permissions/types.ts` | JSDoc : `human_validation` = record de confiance injecté uniquement (G1-C reste pur, pas de Supabase) |
| `src/lib/agent/router/types.ts` | `approvalService?: HumanApprovalService` ; `approval_id?` sur `ToolRouteRequest` (plus de HV déclaratif) |
| `src/lib/agent/router/request-schema.ts` | `approval_id` UUID optionnel ; `human_validation` / `current_params_hash` refusés (strict) |
| `src/lib/agent/router/error-codes.ts` | Codes `APPROVAL_*` + `APPROVAL_CONSUMED_EXECUTION_NOT_STARTED` |
| `src/lib/agent/router/router.ts` | Ordre G1-H : validate → resolve → args → fingerprint/params_hash → inspect → authorize → claim → consume → executor → complete/fail → audit |
| `src/lib/agent/router/audit-emit.ts` | Champs audit approval sanitizés |
| `src/lib/agent/audit/{types,schemas,builder}.ts` + mapping | Extension audit `approval_id` / `status` / `required` / `consumed` / `decision` / `failure_code` |
| `src/lib/agent/router/router.test.ts` | +8 tests G1-H (consume, replay, poison, autonomie, audit) |
| `src/lib/agent/router/test-fixtures/approval-service.ts` | Spy HumanApprovalService |

### Catalogue / scripts / preuve

| Fichier | Changement |
|---|---|
| `package.json` | `test:g1-h`, `test:g1-h:sql` |
| `scripts/g1/catalog.yaml` | TOOL-017 reste **exact** G1-C ; note MODE-011 partial / TOOL-013/015 hors G1-H |
| `docs/implementation/SID_GATE_G1H_EVIDENCE.md` | cette preuve |

## Architecture

```
route(request, context.now)
  1. validation requête + contexte
  2. resolve outil / callable
  3. validate args
  4. fingerprint + params_hash (calculés — jamais déclaratifs appelant)
  5. si approval_id : inspect → toTrustedHumanValidation
  6. authorize (Permission) avec HV de confiance uniquement
  7. deny / require_approval → stop (pas claim, pas consume, pas exécuteur)
  8. si idempotency_key : claim
  9. replay_* / conflict / in_progress / unavailable → stop (pas consume)
 10. si human_validation_required : consume atomique (après acquired / sans clé)
 11. exécuteur **ssi** consume.outcome === "consumed" (quand requise)
 12. complete / fail idempotence
 13. audit.build (+ append si sink)
 14. return
```

### Règles critiques

| Règle | Comportement |
|---|---|
| G1-C pur | Permission Service : zéro Supabase ; ne consomme jamais |
| Preuve appelant | Seul `approval_id` accepté ; snapshot `human_validation` → `ROUTER_INPUT_INVALID` |
| Pas d’exécuteur sans consume | Outil `human_validation_required` → consume obligatoire avant executor |
| Replay / conflict / in_progress | Jamais de consume |
| Already consumed | ≠ nouvelle exécution (autre clé) — `APPROVAL_ALREADY_CONSUMED` |
| Pas d’élévation autonomie | Consume / Permission utilisent `requested_autonomy_level` de la requête |
| Consume OK, executor non démarré | `APPROVAL_CONSUMED_EXECUTION_NOT_STARTED` + audit ; **pas** de réactivation |
| Pas de fallback déclaratif | params_hash / fingerprint calculés côté Router |

### Contenu interdit (audit / erreurs)

Commentaire libre, token, args bruts, stack, SQL PostgREST, owner_token, clé d’idempotence en clair.

## Migration / RPC (résumé)

- Table `public.agent_human_approvals` — statuts `pending|approved|rejected|expired|consumed|cancelled`.
- Consume atomique (`FOR UPDATE` + prédicat `status='approved'`) — résultats SQL : `consumed` / `already_consumed` / `scope_mismatch` / `params_mismatch` / …
- Distinct de `public.approval_request` (métier/Stripe) et de `agent_idempotency_records`.
- RLS : lecture scoped tenant ; mutations via `service_role` / RPC confiance.

## Tests unitaires Approvals (30)

Création · expiration · decide approve/reject · inspect · consume (match / mismatch / already / expired / unavailable) · sanitization · pas d’args complets.

## Tests Router G1-H (+8 → 56 total fichier)

- inspect approved → consume → exécuteur 1×  
- already_consumed → jamais exécuteur  
- replay_success → jamais consume  
- consume OK + executor absent → `APPROVAL_CONSUMED_EXECUTION_NOT_STARTED`  
- `human_validation` déclaratif refusé  
- pas d’élévation autonomie  
- write sans `approval_id` → `APPROVAL_REQUIRED`  
- audit champs approval sanitizés  

## SQL / RLS / concurrence (17/17)

```
pnpm test:g1-h:sql
# ≡ guard + node scripts/test-g1-h-agent-approvals.mjs
```

Couverture : consommations concurrentes (une seule `consumed`), already_consumed, expired, cross-tenant, fingerprint/params mismatch, rejected/consumed terminaux, anonyme, isolation, UPDATE/DELETE refusés, contraintes, atomicité RPC.

## EVAL catalogue — exactes

| EVAL | Statut |
|---|---|
| `EVAL-TOOL-017` | **exact** (G1-C) — inchangé ; G1-H n’ajoute pas d’exact injustifié |
| `EVAL-TOOL-018` / exactes G1-B/D/G antérieures | inchangées |

## EVAL — partial / hors inventaire

| EVAL | Motif |
|---|---|
| `EVAL-MODE-011` | **partial** (hors catalogue préfixe MODE) — consume atomique + liaison scope présents ; absents : UI décision, auth produit, workflow mission |
| `EVAL-MODE-008` / `010` | **exact** au niveau G1-C Permission (hors inventaire catalogue) — inchangés |
| `EVAL-TOOL-013` / `015` | **hors G1-H** (idempotence outil G1-G) — non surdéclarés |

## Absents documentés (pas d’exact)

- UI d’approbation humaine / inbox produit  
- Auth / rôles décideur productisés  
- Workflow Engine / `mission_id`  
- Exactly-once effet externe Stripe  
- Confusion avec `approval_request` métier  

## Documenté : consume sans exécution

Si `consume` réussit puis l’exécuteur est absent / non démarré (échec interne avant `execute`) :

- code Router : `APPROVAL_CONSUMED_EXECUTION_NOT_STARTED`
- audit : `approval_consumed=true`, `reason_code=APPROVAL_CONSUMED_EXECUTION_NOT_STARTED`
- l’approbation **reste** `consumed` — pas de réactivation / rewind

## Validations exécutées

```
pnpm test:g1-h          # 86 (30 approvals + 56 router)
node scripts/test-g1-h-agent-approvals.mjs  # 17/17
pnpm test:g1-g          # 78
pnpm test:g1-f          # 16
pnpm test:g1-e          # 19
pnpm test:g1-d          # 56
pnpm test:g1-c          # 28
pnpm test:g1-a          # PASS=12 FAIL=0 BLOCKED=80
pnpm test:g1-a:strict   # PASS=12 FAIL=0 BLOCKED=80
git diff --check        # clean
```

## Rapport brief (16 points)

1. **Fichiers** : migration + approvals + pont Router/Permission/audit + tests + catalog + preuve.  
2. **Multitask** : service/RPC/migration/tests conservés et branchés.  
3. **Migration/RPC** : create/decide/consume/get ; fail-closed script si table absente.  
4. **Tests** : 30 unitaires service + 8 Router G1-H + 17 SQL.  
5. **Concurrence** : deux consume → une seule `consumed` (SQL).  
6. **RLS** : tenant isolation, anonyme refusé, UPDATE/DELETE applicatifs refusés.  
7. **Harness** : PASS=12 (TOOL-017 exact G1-C conservé).  
8. **EVAL exact** : TOOL-017 (G1-C) ; pas de nouvelle exact MODE/UI.  
9. **EVAL partial** : MODE-011 (consume) ; TOOL-013/015 hors lot.  
10. **Executor sans consume** : impossible si validation requise (tests).  
11. **Replay ne consomme pas** : test G1-H replay_success.  
12. **Consume sans exécution** : code + audit documentés ; pas de réactivation.  
13. **Pas d’élévation autonomie** : niveau demandé transmis tel quel.  
14. **Pas de preuve déclarative** : schéma refuse `human_validation`.  
15. **Pas secret/token/args/stack** : audit sanitizé.  
16. **Pas de commit** : working tree non commitée (instruction respectée).

## Non-objectifs (G1-I+)

- UI / inbox d’approbation  
- G1-I (lot suivant)  
- Exactly-once Stripe  
- Modification Registry / preuves A–G / harness core (hors bindings catalog kind/rationale)
