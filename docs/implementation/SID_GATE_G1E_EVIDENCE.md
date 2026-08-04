# SIDIAN — Preuve de lot G1-E (synthèse versionnée)

**Lot :** G1-E — Audit Service déterministe (+ pont Router G1-D)  
**Gate G1 global :** toujours **NOT EXECUTED / non PASS**  
**Date UTC :** 2026-07-24T20:31:22Z  
**SHA testé :** `f7c64ff8146c7d9170e31847c895eb2cb7e49ddf`  
*(SHA = HEAD au moment de la validation Vitest / harness ; working tree non commitée.)*

> Synthèse humaine. Non réécrite automatiquement par le harness.

## Fichiers livrés

### Production Audit (`src/lib/agent/audit/`, hors tests)

| Fichier | Rôle |
|---|---|
| `index.ts` | Exports publics |
| `types.ts` | `AuditEvent` / `AuditBuildInput` / `AuditService` |
| `schemas.ts` | Zod strict (refuse payload / secrets / stack) |
| `reason-codes.ts` | SUCCESS ∪ permissions ∪ router (dédupliqué) |
| `builder.ts` | Construction pure + `audit_id` déterministe |
| `service.ts` | `createAuditService().build(input, context)` |

### Production Router — pont G1-E (`src/lib/agent/router/`)

| Fichier | Rôle |
|---|---|
| `audit-emit.ts` | Mapping issue Router → `AuditBuildInput` + `emitAuditOnResult` |
| `router.ts` | `audit.build()` **une fois** avant chaque issue terminale (si `now` dispo) |
| `types.ts` | `auditService?` dans deps ; `audit?` sur success/blocked |
| `result-schema.ts` | Champ `audit` optionnel |

### Tests

| Fichier | Rôle |
|---|---|
| `src/lib/agent/audit/service.test.ts` | 19 tests Audit |
| `src/lib/agent/audit/test-fixtures/**` | Fixtures mémoire Audit |
| `src/lib/agent/router/router.test.ts` | 31 tests Router (+ assertions audit 1×) |
| `src/lib/agent/router/test-fixtures/audit-service.ts` | Spy `createSpyAuditService` |

### Catalogue / scripts

| Fichier | Changement |
|---|---|
| `package.json` | script `test:g1-e` |
| `scripts/g1/catalog.yaml` | `coverage.kind` / `rationale` / `bindings` uniquement |
| `docs/implementation/SID_GATE_G1E_EVIDENCE.md` | cette preuve |

## Architecture

```
route(request, context.now)
  → … contrôles G1-D …
  → issue terminale (success | blocked)
  → audit.build(draft, { now: context.now })  // 1×, pur, zéro I/O
  → résultat + audit? (événement en mémoire uniquement)
```

- **Zéro I/O :** pas de `fetch`, Stripe, Supabase, DB, fs métier, logs console, OTel.
- **Zéro stockage :** aucun append `audit_log` / aucune persistance.
- **Zéro réseau.**
- **Horloge injectée :** `context.now` uniquement — `duration_ms = 0` (pas de wall-clock).
- **Exception documentée :** contexte sans `now` → `ROUTER_INPUT_INVALID` **sans** audit (impossible de dater déterministiquement).

### Contenu interdit dans l’événement

Payload arguments, sortie brute, secrets, tokens, PAN, stack traces — refusés par schéma strict ; Router n’en fournit aucun.

## Liste des tests Audit (19)

1. build succès (EVAL-TOOL-022 / OBS-002)  
2. build deny  
3. build approval  
4. build validation_error  
5. build business_error  
6. build technical_error  
7. timestamp injecté  
8. déterminisme audit_id  
9. audit_id override  
10–11. hashes stables / null  
12–13. EVAL-OBS-003 redaction  
14–16. schéma strict  
17. immutabilité inputs  
18. EVAL-OBS-001 champs (preuve unitaire composition — catalogue reste none)  
19. tool_id null (échec précoce)

## Liste des tests Router (31)

29 tests G1-D conservés + 2 tests G1-E :

- `audit.build` 1× success + blocked  
- contexte sans `now` → 0 appel audit  

Tests 25–26 renforcés : corrélation / outil / event audit composé.

## EVAL catalogue — exactes

**Aucune nouvelle exact** introduite par G1-E (volontaire).

Exactes antérieures (G1-B/C/D) inchangées en statut exact.

## EVAL catalogue — partial (G1-E)

| EVAL | Motif partial |
|---|---|
| `EVAL-TOOL-022` | `buildEvent` + Router ; absents : mission, `idempotency_key` systématique, persistance |
| `EVAL-OBS-002` | composition event ; pas de retrouvabilité |
| `EVAL-OBS-003` | redaction audit agent seulement |
| `EVAL-SEC-015` | redaction event, pas tous les logs |

## EVAL volontairement none

| EVAL | Motif |
|---|---|
| `EVAL-OBS-001` | composition ≠ retrouvabilité / mission / persistance — reste `none` |

## Résultat Vitest

```
pnpm test:g1-e
Test Files  1 passed (1)
Tests       19 passed (19)

pnpm test:g1-d
Test Files  1 passed (1)
Tests       31 passed (31)

pnpm test:g1-c
Test Files  1 passed (1)
Tests       28 passed (28)
```

## Résultat harness G1-A (après catalogue)

```
PASS=12
FAIL=0
BLOCKED=80
NOT_APPLICABLE=0
```

Confirmé via `pnpm test:g1-a` et `pnpm test:g1-a:strict` (2026-07-24T20:33:38Z).

(PASS inchangé = 12 exactes antérieures G1-B/C/D. Aucune nouvelle exact G1-E.
Partial TOOL-022 / OBS-002 / OBS-003 / SEC-015 → restent hors PASS, conformément à la politique « pas d’exact ».)

## Hors scope / limites

- Pas de persistance `audit_log`, pas de mission_id, pas d’idempotency_key produit par le Router.
- Pas de Workflow, Memory, LLM Gateway, Domain Service.
- Permission Service non modifié (hors nécessité contrat).
- **Gate G1 global : non PASS.**

## Confirmations

1. Router appelle `audit.build()` **une fois** avant chaque issue terminale de `route()` dès que `context.now` est valide.  
2. Zéro I/O / zéro stockage / zéro réseau dans le lot Audit + pont Router.  
3. Aucun commit / push effectué par l’intégration G1-E.
