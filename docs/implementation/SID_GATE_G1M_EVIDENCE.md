# SIDIAN — Preuve de lot G1-M (Conversation-to-Protection Draft)

**Lot :** G1-M — Conversation-to-Protection Draft  
**Gate G1 fondation (A…L) :** PASS (prérequis)  
**Décision lot G1-M :** `PASS`  
**Date UTC :** 2026-07-25T21:22:34Z  
**SHA testé :** `f7c64ff8146c7d9170e31847c895eb2cb7e49ddf`  
*(SHA = HEAD au moment de la validation ; working tree non commitée — aucun commit / push.)*

> Synthèse humaine. Non réécrite automatiquement par le harness.

---

## 1. Objectif produit

Permettre à un utilisateur authentifié de décrire naturellement une collaboration / facture à protéger. L’agent :

1. extrait un **brouillon** structuré (déterministe dans ce lot — pas d’écriture LLM→DB métier) ;
2. identifie uniquement les infos manquantes ;
3. pose des questions courtes et ciblées ;
4. produit un récapitulatif modifiable ;
5. exige une **confirmation explicite** (`explicit_confirmation: true` + `confirmation_nonce`) ;
6. crée **atomiquement** `client_payeur` + `creance` (BROUILLON).

**Hors périmètre G1-M :** messages client, WhatsApp, SMS, e-mail, prélèvement, OCR, lot G1-N.

---

## 2. Architecture

```
POST /api/agent/tools
  → Gateway → TrustedExecutionContext
  → Router → Permission → (Idempotency) → Executor protection.draft.*
       · tenant_id / actor_id UNIQUEMENT depuis TrustedExecutionContext
       · args outil : intent / draft_id / nonce — jamais tenant/actor
  → ProtectionDraftService
       · advance / get / cancel → table agent_protection_drafts uniquement
       · confirm → RPC confirm_agent_protection_draft (atomique + idempotente)
```

### Outils Registry (Production)

| tool_id | effect_family | Effet |
|---|---|---|
| `protection.draft.advance` | `advance_protection_draft` | Extraction / correction / questions / récap |
| `protection.draft.get` | `read_protection_draft` | Lecture brouillon |
| `protection.draft.cancel` | `cancel_protection_draft` | Annulation |
| `protection.draft.confirm` | `confirm_protection_draft` | Création atomique métier |

### Machine d’état

`MESSAGE_RECU` → `EXTRACTION_BROUILLON` → `INFORMATIONS_MANQUANTES` / `QUESTION_CIBLEE` → `BROUILLON_COMPLET` → `RECAPITULATIF` → `CONFIRMATION_EXPLICITE` → `CREATION_ATOMIQUE` → `TERMINE`  
Aussi : `ANNULE`, `EXPIRE`.

### Devise (règle documentée)

`CURRENCY_DEDUCTION_RULE` : MVP EUR uniquement. Devise explicite (`EUR` / `euro` / `€`) ou déduction EUR si montant sans devise dans un message FR. Autre devise → ambiguïté / refus.

### Montants

Toujours en **unités mineures** (centimes). Parsing FR `2 400 €` → `240000`.

### Provenance des champs (audit)

`agent_proposed` | `user_provided` | `user_corrected` | `confirmed` — stockée par champ dans `fields` JSONB ; `audit_log` métier à la confirmation.

---

## 3. Fichiers livrés

| Zone | Fichiers |
|---|---|
| Migration | `supabase/migrations/20260725220000_g1m_protection_drafts.sql` |
| Domaine | `src/lib/agent/protection-draft/**` |
| Tools | définitions + schémas `protection.draft.*` ; effect families étendues |
| Câblage | `src/lib/agent/server/auth/create-router.ts` (exécuteurs G1-M) |
| Tests | `*.test.ts` + `scripts/test-g1-m-protection-drafts.mjs` |
| Scripts | `package.json` : `test:g1-m`, `test:g1-m:sql` |
| Catalogue | `scripts/g1/catalog.yaml` — rationale/bindings EVAL-TOOL-002/003 (+ G1-M) |
| Preuve | ce fichier |

---

## 4. Contraintes respectées

| Contrainte | Preuve |
|---|---|
| Tenant/actor hors body | Schémas strict + `executors.test.ts` + catalog |
| Pas d’écriture métier avant confirm | Service + SQL assert `client_payeur_id` null pré-confirm |
| Extraction = brouillon seulement | Memory/SQL : 0 client/créance après advance |
| Création atomique + idempotente | Double confirm → `replay` ; 1 client + 1 créance |
| Cross-tenant | get/confirm autre tenant → erreur (vitest + SQL) |
| Dates ambiguës | `QUESTION_CIBLEE` + candidates ; pas de due_date inventée |
| Corrections | provenance `user_corrected` ; valeur écrasée |
| PJ sans OCR | métadonnées `filename/content_type/size_bytes/attachment_id` uniquement |
| Fail-closed auth path | Réutilise Gateway/Router G1-K/L ; RPC confirm = service_role only |
| Pas de communications client | Aucun outil send/WhatsApp/SMS/email/prélèvement |

---

## 5. Résultats des tests

### Unitaires / intégration mémoire

| Commande | Résultat |
|---|---|
| `pnpm test:g1-m` | **34 passed** / 0 failed / 0 skipped |
| `pnpm test:g1-b` | **18 passed** (registry + nouveaux outils) |
| `pnpm typecheck` | **OK** |
| `pnpm lint` | 0 errors (warnings préexistants + 1 corrigé G1-M) |

### SQL / RLS (Supabase local)

| Commande | Résultat |
|---|---|
| Migration `20260725220000` | **Appliquée** |
| `pnpm test:g1-m:sql` | **9/9 PASS** |

Couverture SQL : upsert sans écriture métier · confirm atomique · replay idempotent · cross-tenant get/confirm · anon select vide · DELETE interdit · cancel puis confirm refusé · RPC authenticated sans EXECUTE.

---

## 6. Compteurs consolidés G1-M

| | PASS | FAIL | SKIPPED | BLOCKED |
|---|---|---|---|---|
| Vitest `test:g1-m` | 34 | 0 | 0 | 0 |
| SQL `test:g1-m:sql` | 9 | 0 | 0 | 0 |
| **Total lot** | **43** | **0** | **0** | **0** |

---

## 7. Risques résiduels

| Risque | Niveau | Note |
|---|---|---|
| Extraction déterministe ≠ LLM production | Medium | Interface prête ; runtime LLM = lots suivants |
| Noms clients ambigus (regex FR) | Low | Corrections utilisateur couvertes |
| `database.generated.ts` non régénéré | Low | RPC via client injecté non typé Database |
| Pas de parcours UI chat E2E | Medium | Surface = tools via `/api/agent/tools` |

---

## 8. Lot suivant proposé

**G1-N** (non démarré) — à définir : runtime conversationnel LLM branché sur les outils `protection.draft.*`, ou communications client (hors G1-M).

---

## 9. Confirmations

- Aucun commit / push effectués.
- G1-M communications client **non démarrées**.
- Lot suivant **non démarré**.
