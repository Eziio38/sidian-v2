# SIDIAN — Preuve de lot G1-C (synthèse versionnée)

**Lot :** G1-C — Permission Service déterministe  
**Gate G1 global :** toujours **NOT EXECUTED / non PASS**  
**Date :** 2026-07-24  
**policy_version :** `perm_g1c_2026_07_24`

> Synthèse humaine. Non réécrite automatiquement par le harness.

## Résultat harness après G1-C

```
PASS=10
FAIL=0
BLOCKED=82
NOT_APPLICABLE=0
```

(PASS = 8 exact G1-B + 2 exact G1-C : EVAL-TOOL-017, EVAL-TOOL-018)

## EVAL passées en `exact` (préconditions 09 reproduites)

| EVAL | Préconditions reproduites |
|---|---|
| `EVAL-TOOL-017` | Validation `expired` / `expires_at<=now` injecté / hash params modifié → `deny` + `VALIDATION_EXPIRED`, distinct de `PERMISSION_DENIED`. |
| `EVAL-TOOL-018` | Grants vides ou permission absente → `deny` + `PERMISSION_MISSING` / `error_code=PERMISSION_DENIED`, distinct de validation expirée. |

## Couverture normative hors inventaire catalogue (préfixe MODE)

Les entrées `EVAL-MODE-*` ne figurent pas dans `scripts/g1/catalog.yaml` (inventaire strict limité à TOOL/SEC/OBS/PAY). Preuves unitaires néanmoins présentes :

| EVAL | Statut service | Justification |
|---|---|---|
| `EVAL-MODE-008` | exact au niveau Permission Service | Absence d’interdiction (grants `[]`) ≠ allow → `PERMISSION_MISSING`. |
| `EVAL-MODE-010` | exact au niveau Permission Service | Hash paramètres ≠ bound → `VALIDATION_EXPIRED` (nouvelle approbation). |
| `EVAL-MODE-011` | **partial** | Liaison outil/ressource incorrecte → `VALIDATION_SCOPE_MISMATCH`, mais pas d’anti-replay / consommation atomique persistante. |

## EVAL volontairement non exactes (catalogue)

| EVAL | Motif |
|---|---|
| `EVAL-TOOL-004` | `partial` — refuse sans exécution côté Permission Service ; le refus avant effet de bord appartient au Tool Router. |
| `EVAL-PRM-002` | Hors inventaire G1 ; claim prompt rejeté en `INPUT_INVALID` (strict), scénario behavioral prompt non couvert. |
| `EVAL-MODE-002` | Branche `require_approval` couverte ; parcours mode Agir UI/agent non reproduit. |
| SEC JWT/RLS/runtime | Inchangées — hors Permission Service pur. |
| Audit / Router | Absents. |

## API

```ts
authorize(request, context: { now: ISO }): PermissionDecision
```

- Horloge injectée obligatoire (`context.now`) — aucun `Date.now()` / horloge globale.
- `ToolDefinition` résolue via `resolveToolDefinition` injecté (registre mémoire en tests).
- Schémas Zod `.strict()` — champs `prompt_says_allowed`, `llm_says_allowed`, `claimed_*` → `INPUT_INVALID`.
- Zéro I/O : pas de DB, Supabase, Stripe, LLM, Domain Service, Audit, Workflow, Memory.

## Hors scope confirmé

Aucun Tool Router / Audit Service / exécution d’outil.  
G1-B Registry inchangé fonctionnellement (interface PermissionService alignée sur G1-C).  
Gate G1 global toujours non PASS.
