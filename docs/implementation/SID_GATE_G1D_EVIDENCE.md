# SIDIAN — Preuve de lot G1-D (synthèse versionnée)

**Lot :** G1-D — Tool Router déterministe  
**Gate G1 global :** toujours **NOT EXECUTED / non PASS**  
**Date UTC :** 2026-07-24T20:13:39Z  
**SHA testé :** `f7c64ff8146c7d9170e31847c895eb2cb7e49ddf`  
*(SHA = HEAD au moment de la validation Vitest / harness ; working tree non commitée.)*

> Synthèse humaine. Non réécrite automatiquement par le harness.

## Fichiers livrés

### Production (`src/lib/agent/router/`, hors tests)

| Fichier | Rôle |
|---|---|
| `index.ts` | Exports publics |
| `router.ts` | `createToolRouter` / `route()` fail-closed |
| `types.ts` | Contrats Router (alias G1-C pour grants/resource/HV) |
| `request-schema.ts` | Zod strict (réutilise schémas G1-C) |
| `result-schema.ts` | Résultat success / blocked |
| `error-codes.ts` | Codes + catégories stables |
| `executor.ts` | Contrat exécuteur injecté + erreurs typées |

### Tests

| Fichier | Rôle |
|---|---|
| `router.test.ts` | 29 tests Vitest |
| `test-fixtures/**` | Registre / Permission / exécuteurs mémoire |

### Catalogue / scripts

| Fichier | Changement |
|---|---|
| `package.json` | script `test:g1-d` |
| `scripts/g1/catalog.yaml` | `coverage.kind` / `rationale` / `bindings` uniquement |
| `docs/implementation/SID_GATE_G1D_EVIDENCE.md` | cette preuve |

## Architecture

```
route(request, context.now)
  → valider requête/contexte (ROUTER_INPUT_INVALID)
  → résoudre ToolDefinition (TOOL_UNKNOWN)
  → status === Production sinon TOOL_NOT_CALLABLE
  → résoudre schéma input (INPUT_SCHEMA_UNRESOLVED)
  → valider arguments (INVALID_ARGUMENT) — Permission + exécuteur non appelés
  → PermissionService.authorize(…, { now })
       deny → PERMISSION_DENIED | require_approval → APPROVAL_REQUIRED
  → résoudre exécuteur (EXECUTOR_UNAVAILABLE)
  → executor.execute une seule fois
  → valider sortie (OUTPUT_SCHEMA_UNRESOLVED / INVALID_TOOL_OUTPUT)
  → success
```

- **Zéro I/O directe :** pas de `fetch`, Stripe, Supabase, DB, LLM, Domain Service, fs métier.
- **Zéro effet métier :** exécuteurs injectés uniquement ; smuggle d’exécuteur dans la requête refusé.
- **Horloge injectée :** `context.now` obligatoire — aucun `Date.now()` / `new Date()` implicite.
- **Ordre des contrôles :** validation args → Permission → exécuteur (jamais l’inverse).

## Liste des tests (29)

1. request invalide → `ROUTER_INPUT_INVALID`  
2. champ inconnu `prompt_says_allowed` / poisons LLM → refus  
3. **EVAL-TOOL-019** outil inconnu → `TOOL_UNKNOWN`  
4. outil Approved → `TOOL_NOT_CALLABLE`  
5. **EVAL-TOOL-020** Deprecated → `TOOL_NOT_CALLABLE`  
6. schéma input introuvable → `INPUT_SCHEMA_UNRESOLVED`  
7. argument obligatoire absent → `INVALID_ARGUMENT`  
8. type invalide → `INVALID_ARGUMENT`  
9. args invalides : Permission + exécuteur non appelés  
10. **EVAL-TOOL-004** deny → `PERMISSION_DENIED`, exécuteur jamais appelé  
11. **EVAL-MODE-002** (hors inventaire catalogue) `require_approval` → `APPROVAL_REQUIRED`  
12. allow → exécuteur une fois  
13. exécuteur absent → `EXECUTOR_UNAVAILABLE`  
14–15. succès + sortie normalisée  
16. `OUTPUT_SCHEMA_UNRESOLVED`  
17. `INVALID_TOOL_OUTPUT`  
18–20. **EVAL-TOOL-026** technical / business / fail-closed non typé  
21–22. immutabilité + déterminisme  
23–24. ordre contrôles ; exécuteur jamais avant validation+permission  
25–26. corrélation / tool+version (preuves unitaires ; **pas** Audit → EVAL-TOOL-022 reste none)  
27. non-fuite output sensible  
(+ contexte sans `now` ; refus smuggle exécuteur)

## EVAL catalogue — exactes (préconditions Router)

| EVAL | Préconditions reproduites |
|---|---|
| `EVAL-TOOL-004` | deny Permission → blocked `PERMISSION_DENIED`, exécuteur = 0 |
| `EVAL-TOOL-019` | tool inconnu → `TOOL_UNKNOWN` ; Permission + exécuteur = 0 (binding additif Registry) |
| `EVAL-TOOL-020` | Deprecated/Approved → `TOOL_NOT_CALLABLE` avant Permission/exécuteur (binding additif Registry) |
| `EVAL-TOOL-026` | taxonomie technical / business / permission distincte via Router |

`EVAL-TOOL-017` / `018` restent exactes G1-C (binding Router non ajouté — pas de reproduction dedicated VALIDATION_EXPIRED via Router dans cette suite).  
`EVAL-TOOL-027` reste exacte G1-B fiche/statique — rationale clarifiée : Router ne couvre pas tout le scénario 09.

## EVAL volontairement non exactes

| EVAL | Motif |
|---|---|
| `EVAL-TOOL-022` | `none` — Audit Service agent absent (pilier audit) |
| `EVAL-MODE-002` / `011` | hors inventaire catalogue MODE ; partial au niveau produit |
| `EVAL-SEC-012` / `013` / `027` | `none` — JWT/RLS/accès direct LLM hors Router unitaire |

## Résultat Vitest

```
pnpm test:g1-d
Test Files  1 passed (1)
Tests       29 passed (29)
```

## Résultat harness G1-A (après catalogue)

```
PASS=12
FAIL=0
BLOCKED=80
NOT_APPLICABLE=0
```

Confirmé via `pnpm test:g1-a` et `pnpm test:g1-a:strict` (2026-07-24T20:15:26Z).

(PASS = 8 exact G1-B + 2 exact G1-C + 2 nouvelles exact G1-D : TOOL-004, TOOL-026 ; TOOL-019/020 déjà exact avec bindings Router additifs.)

## Hors scope / limites

- Pas d’Audit Service, Workflow, Memory, LLM Gateway, Domain Service.
- Pas de runtime agent bout-en-bout ; exécuteurs = spies mémoire.
- Interface stub G1-B `tools/interfaces/tool-router.ts` (`invoke`) inchangée fonctionnellement — implémentation réelle = `@/lib/agent/router` (`route`).
- **Gate G1 global : non PASS.**

## Confirmations

1. Exécuteur jamais appelé avant validation arguments + autorisation Permission.  
2. Zéro réseau / DB / Stripe / Supabase / LLM dans le lot Router.  
3. Aucun commit / push effectué par l’intégration G1-D.
