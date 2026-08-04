# SIDIAN — Preuve de lot G1-B (synthèse versionnée)

**Lot :** G1-B — Tool Registry + schémas d’entrée/sortie déterministes  
**Gate G1 global :** toujours **NOT EXECUTED / non PASS**  
**Date :** 2026-07-24

> Synthèse humaine. Non réécrite automatiquement par le harness.

## Résultat harness après G1-B

```
PASS=8
FAIL=0
BLOCKED=84
NOT_APPLICABLE=0
```

## EVAL passées en `exact` (préconditions 09 reproduites)

| EVAL | Préconditions reproduites |
|---|---|
| `EVAL-TOOL-001` | Fiche regroupant lecture+paiement+email refusée via `effect_family` hors allowlist (une seule famille autorisée). |
| `EVAL-TOOL-005` | `amount_cents` manquant sur `payment.create_attempt` → `INVALID_ARGUMENT`. |
| `EVAL-TOOL-006` | `amount_cents` string ambiguë → refus de schéma. |
| `EVAL-TOOL-007` | `currency` absente, aucun default sensible → refus. |
| `EVAL-TOOL-019` | `tool_id` inconnu → `TOOL_UNKNOWN`. |
| `EVAL-TOOL-020` | Version `Deprecated` + outil `Disabled` (fixture) → non callable. |
| `EVAL-TOOL-023` | Notification avec `ledger_entries` / `full_accounting` → `PAYLOAD_NOT_MINIMAL`. |
| `EVAL-TOOL-027` | Familles `decide` / `approve` rejetées structurellement (allowlist). |

## EVAL volontairement non exactes

| EVAL | Motif |
|---|---|
| `EVAL-TOOL-026` | `partial` — convention de contrat `INVALID_ARGUMENT` seulement ; runtime Router non présent. |
| `EVAL-DOC-008` | Couvert par Vitest `definition-schema.test.ts` mais **absent** du catalogue d’inventaire G1 (préfixes TOOL/SEC/OBS/PAY). |

## Contrats Production (pas des fixtures)

- `payment.create_attempt@1.0.0` — 06 §12.2  
- `payment.create_attempt@0.9.0` — Deprecated (cycle de vie)  
- `invoice.get@1.0.0` — 06 §11.1 consultation facture  
- `notification.generate_draft@1.0.0` — 06 §11.2 brouillon  

Fixtures invalides : `src/lib/agent/tools/test-fixtures/` uniquement.

## Hors scope confirmé

Aucun Tool Router / Permission Service implémenté (interfaces seules).  
Aucun LLM, DB, Stripe, Domain Service dans les tests G1-B.  
G1-A harness et evidence inchangés.
