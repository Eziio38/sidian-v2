# SIDIAN — Preuve de lot G1-A (synthèse versionnée)

**Lot :** G1-A — Harness G1 + inventaire des preuves existantes  
**Gate :** G1 (contrôles déterministes) — **NOT EXECUTED / non PASS** au niveau global  
**Statut lot G1-A :** **terminé** (inventaire exécutable vert)  
**Socle agent restant hors G1-A :** Registry, Permission Service, Idempotence générique, Audit agent, Tool Router, Output Validator

> Ce document est une synthèse humaine versionnée.  
> Il **n’est pas** réécrit automatiquement par le runner.  
> Les rapports d’exécution JSON sont produits dans `artifacts/g1/` (gitignorés) et **ne sont pas** des artefacts versionnés.

---

## 0. Run de validation final (G1-A)

| Champ | Valeur |
|---|---|
| Date et heure du run | **2026-07-24 14:20:14 UTC** (`2026-07-24T12:20:14.802Z`) |
| Branche | `develop` |
| Commit SHA testé | `37286bb760deb085d6cb1f9891558f4215c9bb59` |
| EVAL extraits depuis `09_AGENT_EVALUATIONS.md` | **236** |
| REQ extraits depuis `REQUIREMENTS_MATRIX.md` | **170** |
| Entrées catalogue | **92** |

### Versions documentaires utilisées

| Document | Version |
|---|---|
| SIDIAN Specification | v1.0 |
| `04_AGENT_CONSTITUTION.md` | 2.4 |
| `05_AGENT_PROMPTS.md` | 1.3 |
| `06_AGENT_TOOLS.md` | 1.0 |
| `07_AGENT_MEMORY.md` | 1.0 |
| `08_AGENT_ARCHITECTURE.md` | 1.5 |
| `09_AGENT_EVALUATIONS.md` | 1.2 |
| `governance/REQUIREMENTS_MATRIX.md` | 1.2 |
| Baseline manifeste G0 | Architecture 1.5 · Evaluations 1.2 · Matrix 1.2 |

### Résultat final

```
PASS=0
FAIL=0
BLOCKED=92
NOT_APPLICABLE=0
```

Exit code du harness : **0**.

### Trace d’exécution (non versionnée)

Rapport JSON local (ignoré par Git) :

- nom : `artifacts/g1/g1a-2026-07-24T12-20-14-786Z.json`
- SHA-256 : `06f4bae08cdeeb76e055fd1ee8a9b36b38c16cd31044a15daaa7db6e497cc87e`

Ce fichier n’est **pas** une preuve versionnée ; seul le présent document l’est.

### Bindings exécutés correctement

Confirmation : les bindings d’inventaire se sont exécutés avec succès, notamment :

- SQL / schémas / RLS (`test:schema`, trust boundaries) ;
- sécurité (`test:auth`, `test:security-environment`, `test:security-rate-limits`) ;
- Stripe (`test:stripe-001`, `002-b`, `002-c`, `003`, orphan-audit) ;
- idempotence / prod (`test:prod-001`, `prod-003`, `prod-004`) ;
- audit (orphan-audit, profil, lectures `audit_log` via suites schéma) ;
- Vitest (`transitions.test.ts`, webhook route, resolve-checkout-status).

Aucun binding en échec (`failed_bindings: 0`).

### Pourquoi 92 BLOCKED sont attendus

En G1-A, la règle de verdict interdit tout PASS sur :

- `coverage.kind: partial`
- `coverage.kind: analog`
- `coverage.kind: none`

Les suites existantes prouvent des fondations métier (RLS, Stripe, audit, etc.) mais **ne reproduisent pas** à l’identique les scénarios agent du catalogue `EVAL-*` (Tool Router, Permission Service agent, etc.).  
Donc **92 × BLOCKED** = inventaire honnête, **pas** un Gate G1 PASS.

### Statut gates

| Périmètre | Statut |
|---|---|
| **Lot G1-A** | **terminé** |
| **Gate G1 global** | **NOT EXECUTED / non PASS** (Blocking encore `BLOCKED`) |
| Gates G2–G6 | non exécutés |

---

## 1. Objectif du lot

Mettre en place un harness déterministe qui :

1. charge un catalogue YAML **non normatif** (`scripts/g1/catalog.yaml`) ;
2. extrait les identifiants `EVAL-*` et `REQ-*` depuis les documents normatifs ;
3. exécute les bindings d’inventaire réutilisant les suites existantes ;
4. applique les verdicts `PASS` / `FAIL` / `BLOCKED` / `NOT_APPLICABLE` sans faux PASS ;
5. écrit un rapport JSON sous `artifacts/g1/` (local uniquement).

## 2. Séparation des couches d’identifiants

| Couche | Source de vérité | Rôle dans G1-A |
|---|---|---|
| **Requirements `REQ-*`** | `docs/agent/governance/REQUIREMENTS_MATRIX.md` | Traçabilité exigence → évaluation |
| **Source decisions `A-*` / `D-*` / `T-*` / `P-*` / `E-*`** | docs 04–09 | Non redéfinies ; non listées dans le code |
| **Evaluations `EVAL-*`** | `docs/agent/09_AGENT_EVALUATIONS.md` | Contrôles inventoriés / exécutés |

Le catalogue YAML **référence** des `EVAL-*` et `REQ-*` déjà définis. Il ne crée aucune exigence.

## 3. Règles de verdict (G1-A)

| `coverage.kind` | Verdict possible |
|---|---|
| `exact` | `PASS` ou `FAIL` |
| `partial` | `BLOCKED` (même si bindings verts) |
| `analog` | `BLOCKED` (même si bindings verts) |
| `none` | `BLOCKED` |
| `not_applicable` | `NOT_APPLICABLE` (justification obligatoire) |

Un binding en échec force `FAIL` (preuve d’exécution cassée).

Il n’existe **pas** de mécanisme `allow_pass_on_partial`.

## 4. Périmètre d’inventaire strict

Préfixes déclarés dans le catalogue (`strict_inventory.id_prefixes`) :

- `EVAL-TOOL-`
- `EVAL-SEC-`
- `EVAL-OBS-`
- `EVAL-PAY-`

Hors inventaire strict G1-A (reportés) : Workflow Engine (`EVAL-WF-*` moteur planifié), Memory Core (`EVAL-MEM-*`), suites comportementales G2.

Une entrée analogique `EVAL-DOC-007` + Vitest `transitions.test.ts` documente les transitions domaine existantes (pilier `transitions` / `unit`).

## 5. Décisions d’exécution prises

- Tool Router **non** introduit ; parcours humains Domain Services **non** refactorisés.
- Aucune migration ; `audit_log` existant réutilisé pour l’inventaire partial.
- Aucun fichier sous `docs/agent/` modifié.
- Aucun fichier `src/lib/agent/` créé.

## 6. Commandes

```bash
pnpm test:g1-a
pnpm test:g1-a -- --strict-inventory
# équivalent :
pnpm test:g1-a:strict
pnpm test:g1-a -- --skip-bindings   # validation catalogue seule
```

**Prérequis pour les bindings SQL** (`test:schema`, Stripe, prod-\*, security-\*) : Docker Desktop + `pnpm supabase:start`.  
Sans Postgres local (`127.0.0.1:54322`) / API (`:54321`), ces bindings échouent (`ECONNREFUSED`) et le harness sort en `FAIL` — comportement voulu (pas de faux PASS).  
Les bindings Vitest purs restent exécutables sans Supabase.

## 7. Interprétation du résultat

- **Lot G1-A OK** : exit 0, `FAIL=0`, bindings observés verts, `BLOCKED=92` attendus.
- **Gate G1 global** : reste **NOT EXECUTED / non PASS** tant que des contrôles Blocking G1 sont `BLOCKED` (socle agent manquant).

## 8. Prochains lots (hors G1-A)

1. Tool Registry + schémas  
2. Permission Service  
3. Idempotence générique  
4. Audit Service agent  
5. Tool Router (effets agent uniquement) + Domain Services factices  
6. Output Validator  
7. Dossier de preuve du socle (sans L9/L10)
