# SIDIAN — Preuve de lot G1-N (Conversational Agent Runtime)

**Lot :** G1-N — Conversational Agent Runtime  
**Prérequis :** G1-M **PASS** (`protection.draft.*`)  
**Décision lot G1-N :** `PASS`  
**Date UTC :** 2026-07-25T21:41:06Z  
**SHA testé :** `f7c64ff8146c7d9170e31847c895eb2cb7e49ddf`  
*(SHA = HEAD au moment de la validation ; working tree non commitée — aucun commit / push.)*

> Synthèse humaine. Non réécrite automatiquement par le harness.

---

## 1. Objectif produit

Permettre à un utilisateur authentifié de décrire naturellement une collaboration / client / facture via un **runtime LLM**, tout en conservant **G1-M** comme **seule voie** vers la création métier :

```
message utilisateur
  → runtime LLM (provider abstrait)
  → sortie structurée
  → validation de schéma (Zod strict)
  → validation métier déterministe
  → protection.draft.* (apply_extraction interne / converse)
  → confirmation explicite (protection.draft.confirm)
  → RPC atomique
```

**Hors périmètre G1-N :** UI chat E2E, communications client (WhatsApp / SMS / e-mail), prélèvement, OCR, lot G1-O.

---

## 2. Architecture

```
POST /api/agent/tools
  → Gateway → TrustedExecutionContext
  → Router → Permission → Executor
       · protection.draft.converse  (G1-N)
       · protection.draft.advance|get|cancel|confirm  (G1-M)
  → ConversationalRuntimeService
       · parseUserMessage / normalize / validate / missing / ambiguities
       · provider.extract() — jamais d’écriture DB
       · timeout + retry limité + fallback déterministe G1-M
  → ProtectionDraftService.advance({ kind: "apply_extraction", ... })
       · tenant_id / actor_id UNIQUEMENT depuis TrustedExecutionContext
       · brouillon uniquement — client_payeur / creance = null
```

### Intent interne `apply_extraction`

Ajouté à `AdvanceIntent` (G1-M) pour recevoir des champs **déjà validés** (schéma + domaine).  
**Non exposé** dans le schéma outil HTTP `protection.draft.advance` (évite le bypass client).

### Outil Registry (Production)

| tool_id | effect_family | Effet |
|---|---|---|
| `protection.draft.converse` | `advance_protection_draft` | Message naturel → runtime → brouillon |
| `protection.draft.advance` | `advance_protection_draft` | Correction / answer / recap (G1-M) |
| `protection.draft.confirm` | `confirm_protection_draft` | Création atomique (inchangé) |

### Provider

| Environnement | Provider | Note |
|---|---|---|
| Tests / CI / HTTP prod actuel | `stub:deterministic-or-scripted` | Aucun appel réseau ; scriptable |
| Mode stub `deterministic` | encapsule `extractProtectionDraftFromMessage` (G1-M) en forme schéma LLM | Fallback = même extracteur |
| Provider réel (OpenAI/Anthropic/…) | **non branché** | Interface `LlmProvider` prête |

---

## 3. Schéma de sortie LLM

`schema_version: "conversational.extraction.v1"`

Champs autorisés (strict) :

- `fields.{client_name,client_email,expected_amount_minor,currency,due_date,libelle,reference_externe}` → `{ value, confidence }` \| null
- `ambiguities[]` → `{ kind: due_date\|currency\|amount, message, candidates? }`
- `model_notes?` — **jamais persisté**

Champs **interdits** (refus schéma) : `tenant_id`, `actor_id`, `explicit_confirmation`, `confirmation_nonce`, `confirm`, `send_message`, `whatsapp`, `payment`, `jwt`, etc.

Confiance minimale domaine : `MIN_FIELD_CONFIDENCE = 0.55`.

---

## 4. Validations (règles 1–16)

| # | Règle | Preuve |
|---|---|---|
| 1 | LLM n’écrit jamais en base | Runtime → draft service seulement ; archi test |
| 2 | Pas de client/créance / RPC / message client / paiement | `handleTurn` n’appelle jamais `confirm` ; output converse `client_payeur_id: null` |
| 3 | Sortie validée par schéma strict | `llmStructuredExtractionSchema` |
| 4–7 | Ambiguïtés + confidence | `normalizeExtraction` / `computeAmbiguities` |
| 8 | `missing_fields` côté domaine | `computeMissingFields` → G1-M `fields.computeMissingFields` |
| 9 | Montants unités mineures | centimes ; tests 240_000 |
| 10–11 | Dates relatives / ambiguës | `resolveRelativeDate` + question |
| 12 | tenant/actor = TrustedExecutionContext | exécuteur + schémas |
| 13 | Idempotence runtime | cache par clé / empreinte |
| 14 | Timeout, retry, fallback | `parseUserMessage` |
| 15–16 | Pas de prompt/JWT/PII en traces | `toAuditableTracePayload` |

### Fallback

Après échec schéma / timeout / erreur provider (retries épuisés) → `fallbackDeterministicExtraction()` (= G1-M `extractProtectionDraftFromMessage`).

---

## 5. Migrations

**Aucune migration.** Justification : G1-M (`agent_protection_drafts` + RPC confirm) suffit ; le runtime ne persiste que via le brouillon existant. Pas de table LLM / prompt / transcript brut.

---

## 6. Fichiers livrés

| Zone | Fichiers |
|---|---|
| Domaine | `src/lib/agent/conversational-runtime/**` |
| G1-M bridge | `types.ts` / `service.ts` — intent `apply_extraction` |
| Tools | `protection.draft.converse` + schémas |
| Câblage | `create-router.ts` (stub provider) |
| Tests | `domain.test.ts`, `security.test.ts`, `service.integration.test.ts` |
| Scripts | `package.json` : `test:g1-n` |
| Catalogue | `scripts/g1/catalog.yaml` — rationale/bindings EVAL-TOOL-002/003 |
| Preuve | ce fichier |

### Fonctions domaine exportées

`parseUserMessage`, `normalizeExtraction`, `validateExtraction`, `computeMissingFields`, `computeAmbiguities`, `generateNextQuestion`, `generateSummary`, `applyUserCorrection`, `fallbackDeterministicExtraction`.

---

## 7. Modèle de menace (résumé)

| Menace | Mitigation |
|---|---|
| LLM écrit en DB | Aucun client Supabase dans le runtime ; wire draft only |
| Contournement confirm | Converse n’expose pas confirm ; injection scannée ; confirm séparé |
| Injection tenant/actor | Ignoré ; identité trusted only ; schéma refuse args |
| Hallucination e-mail/montant | Rejet si absent du message (+ confiance) |
| Hors schéma / timeout | Fallback déterministe |
| Fuite PII dans traces | Empreinte message uniquement |
| Cross-tenant | Isolation G1-M repository / RLS inchangée |

---

## 8. Résultats des tests

| Commande | Résultat |
|---|---|
| `pnpm test:g1-n` | **27 passed** / 0 failed / 0 skipped |
| `pnpm test:g1-m` (régression) | **34 passed** |
| `pnpm test:g1-b` | **18 passed** |
| `pnpm typecheck` | **OK** |
| Migration SQL | **SKIPPED** (non nécessaire) |

Couverture tests G1-N : message complet/partiel, familier+TTC, devise absente, date relative/ambiguë, correction, e-mail invalide, hallucination, hors schéma, timeout, erreur+retry, fallback, double envoi idempotent, cross-tenant, inject tenant/actor, prompt injection / bypass confirm, anti-écriture architecture, confirm seul chemin métier.

---

## 9. Compteurs consolidés G1-N

| | PASS | FAIL | SKIPPED | BLOCKED |
|---|---|---|---|---|
| Vitest `test:g1-n` | 27 | 0 | 0 | 0 |
| Migration | — | — | 1 (N/A) | 0 |
| **Total lot** | **27** | **0** | **1** | **0** |

---

## 10. Risques résiduels

| Risque | Niveau | Note |
|---|---|---|
| Provider réel non branché | Medium | Stub en prod HTTP ; brancher un provider = lot suivant / config |
| Anti-hallucination noms clients faible | Low | E-mail/montant couverts ; noms plus souples |
| Idempotence runtime in-memory | Medium | Perdue au redémarrage ; clé outil optionnelle |
| Pas d’UI chat E2E | Medium | Surface = tools `/api/agent/tools` |
| Extracteur déterministe FR limité (ex. « récupère ») | Low | LLM réel + corrections utilisateur |

---

## 11. Lot suivant proposé — G1-O

**G1-O (proposition, non démarré)** — au choix, priorisé :

1. **Provider LLM réel** (timeout/coût/quotas tenant) derrière la même interface, avec canary + evals comportementales ;
2. **UI chat E2E** branchée sur `protection.draft.converse` + confirm ;
3. **Communications client** (WhatsApp/SMS/e-mail) — uniquement après signal métier explicite, hors LLM direct.

Recommandation : provider réel + observabilité coût **avant** communications client.

---

## 12. Confirmations

- Aucun commit / push effectués.
- Communications client **non démarrées**.
- G1-O **non démarré**.
- Le système ne produit qu’un **brouillon** sans confirmation explicite.
