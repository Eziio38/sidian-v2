# SIDIAN — Consolidation finale Gate G1

**Lot :** Consolidation finale Gate G1 (post G1-A…L)  
**Date UTC :** 2026-07-25T21:05:00Z  
**SHA testé :** `f7c64ff8146c7d9170e31847c895eb2cb7e49ddf`  
**Décision finale :** `PASS`  
*(Working tree non commitée — aucun commit / push. G1-M non démarré.)*

> Synthèse d’intégration : lever les BLOCKED Supabase local, rejouer auth/RLS/HTTP réel,  
> réévaluer les contrôles critiques, figer une décision fiable pour la fondation agent G1.

---

## 1. Résumé exécutif

La fondation agent Gate G1 (lots A→L) est **opérationnellement PASS**.

- Docker + Supabase local démarrés ; migration G1-J `20260724250000` appliquée.
- Chaîne de confiance E2E prouvée : `POST /api/agent/tools` → Auth → Gateway → TrustedExecutionContext → Router → services → DB sous RLS.
- **SEC-GW-001 fermé** côté lib (G1-K), HTTP (G1-L) **et** preuve auth réelle (plus BLOCKED infra).
- Suites unitaires + auth/SQL F–H + typecheck/lint/build : **verts**.
- Inventaire harness G1-A : **PASS=12 / FAIL=0 / BLOCKED=80** — les 80 BLOCKED sont des `kind ∈ {partial,analog,none}` (règle harness), **pas** des échecs d’infra.
- Contrôles SEC-001 / TOOL-002 / TOOL-003 / SEC-015 restent **`partial` volontaires** (pas MFA/SSO/LLM runtime/redaction logs système).

**G1-M n’a pas été démarré.**

---

## 2. Architecture finale

```
HTTP POST /api/agent/tools
  → createAgentToolsRouteHandler (server-only)
      · AuthMaterial : cookies SSR et/ou Authorization Bearer
      · Client Supabase user-scopé (principal + membership)
      · ToolRouter service_role (audit / idempotency / approvals) — tenant trusted only
  → createAgentServerHandler
      · method / Content-Type / size / JSON → ExternalToolRequest
      · RequestGateway.resolve → TrustedExecutionContext
      · refuse si non authenticated
      · ToolRouter.route(ValidatedToolIntent, TrustedExecutionContext)
  → Permission → Idempotency → Approvals → Executor → Audit → Observability
  → réponse HTTP sanitizée
```

| Couche | Rôle | Identité / tenant |
|---|---|---|
| Server Entry (G1-L) | Seule surface HTTP agent | AuthMaterial hors body |
| Request Gateway (G1-K) | Trust boundary | `getUser()` + membership prestataire 1:1 |
| TrustedExecutionContext | Contexte unique Router | actor/tenant/roles sanitizés |
| Tool Router (G1-D+) | Pipeline déterministe | grants dérivés serveur |
| Persistence F/G/H | Audit / idempotency / approvals | `tenant_id` trusted ; RLS + RPC |

---

## 3. Chaîne de confiance complète

| Étape | Preuve | Statut |
|---|---|---|
| JWT / session vérifiée (`getUser`) | `gateway.auth.integration.test.ts` 31–32, 38, 42 ; `server.auth.integration.test.ts` 50–51 | **PASS** |
| Membership tenant | G1-K 34–36 ; G1-L 46, 48–49 | **PASS** |
| Cross-tenant refusé | G1-K 33, 40 ; G1-L 47 ; RLS F/G/H | **PASS** |
| Body `tenant_id`/`actor_id`/`grants` sans effet | Schéma ExternalToolRequest + anti-bypass + poisons Router | **PASS** |
| Router sans TrustedExecutionContext impossible | Contrat TS `route(intent, TrustedExecutionContext)` + test architectural | **PASS** |
| Fail-closed auth locale absente | `test:g1-k:auth` / `test:g1-l:auth` exit 1 si down | **PASS** (comportement) |
| Fail-closed identity non vérifiable | 401/403 sanitizés ; pas de skip silencieux | **PASS** |
| service_role ≠ contournement handler | G1-K 41 ; G1-L 53 | **PASS** |
| Writes audit/idempotency/approval = tenant trusted | G1-L 54–56 ; scripts F/G/H | **PASS** |

---

## 4. Environnement Supabase local (cette consolidation)

| Étape | Résultat |
|---|---|
| Docker daemon | OK (redémarrage Desktop) |
| `pnpm supabase:stop` puis `pnpm supabase:start` | OK — API `http://127.0.0.1:54321` |
| Migrations F/G/H | Déjà présentes |
| Migration G1-J `20260724250000` | **Appliquée** via `./node_modules/.bin/supabase migration up --local` |
| Clés anon / service_role | Démo locale CLI — uniquement scripts/tests locaux (`assert-local-supabase.mjs`) |
| RLS | **Non désactivée** ; service_role non utilisé pour représenter un utilisateur |

Note CLI : le binaire Homebrew `supabase` peut échouer sur `config.toml` (`experimental.pgdelta` / `local_smtp`) ; le binaire projet `2.109.1` fonctionne.

---

## 5. Résultats des tests

### 5.1 Suites agent

| Commande | Résultat |
|---|---|
| `pnpm test:g1-k` | **111 passed** (0 skipped) — était 99 + 12 skipped |
| `pnpm test:g1-k:auth` | **12/12 PASS** |
| `pnpm test:g1-l` | **62 passed** (0 skipped) — était 51 + 11 skipped |
| `pnpm test:g1-l:auth` | **11/11 PASS** |
| `pnpm test:g1-b` … `test:g1-i` | Tous **PASS** |
| `pnpm test:g1-f:rls` | **10/10 PASS** |
| `pnpm test:g1-g:sql` | **17/17 PASS** |
| `pnpm test:g1-h:sql` | **17/17 PASS** |

### 5.2 Fondations sécurité / schéma

| Commande | Résultat |
|---|---|
| `pnpm test:schema` | **PASS** (loopback + RLS métier) |
| `pnpm test:auth` | **38/38 PASS** |
| `pnpm test:security-trust-boundaries` | **PASS** |

### 5.3 Qualité

| Commande | Résultat |
|---|---|
| `pnpm typecheck` | **PASS** |
| `pnpm lint` | **0 error** (11 warnings préexistants) |
| `pnpm build` | **PASS** — route `ƒ /api/agent/tools` listée |
| `git diff --check` | **PASS** |

### 5.4 Harness G1-A

| Commande | Résultat |
|---|---|
| `pnpm test:g1-a` | exit 0 — **PASS=12 FAIL=0 BLOCKED=80** |
| `pnpm test:g1-a:strict` | exit 0 — **PASS=12 FAIL=0 BLOCKED=80** |

Interprétation : **BLOCKED inventaire ≠ BLOCKED infra**. Les `partial`/`analog`/`none` ne peuvent pas PASSER le harness (règle G1-A). Aucun FAIL de binding sur cette run.

### 5.5 Synthèse compteurs (cette consolidation)

| Bucket | Nombre | Commentaire |
|---|---|---|
| **PASS** (suites exécutées ci-dessus) | Toutes les suites listées | Inclut auth/RLS précédemment BLOCKED |
| **FAIL** | **0** | Aucun échec sur le périmètre G1 rejoué |
| **BLOCKED (infra)** | **0** | Supabase local up |
| **SKIPPED (auth)** | **0** | Intégrations exécutées |
| **BLOCKED (harness kind)** | **80** | Attendus (`partial`/`analog`/`none`) |

---

## 6. Matrice des contrôles

| Contrôle | Avant (G1-L) | Après consolidation | Preuve | Dette restante |
|---|---|---|---|---|
| **SEC-GW-001** | Fermé code HTTP ; preuve auth **BLOCKED** | **PASS / FERMÉ E2E** | G1-K + G1-L + `test:g1-*:auth` | Aucune pour trust boundary agent |
| **EVAL-SEC-001** | `partial` | **`partial`** (inchangé kind) | Gateway+HTTP+auth E2E | MFA/SSO/révocation/prod |
| **EVAL-TOOL-002** | `partial` | **`partial`** | Isolation tenant HTTP + RLS | LLM runtime E2E exact |
| **EVAL-TOOL-003** | `partial` | **`partial`** | Router ancré TrustedExecutionContext | UI/agent runtime complet |
| **EVAL-SEC-015** | `partial` | **`partial`** | Redaction audit/obs + HTTP sanitizé | Logs système / OTel / console |

Catalogue : rationales + bindings `:auth` mis à jour — **evaluation_id / requirements / blocking / harness rules inchangés**. Aucun passage injustifié vers `exact`.

---

## 7. Risques résiduels

| Risque | Sévérité | Mitigation / statut |
|---|---|---|
| Pas MFA / SSO / révocation instantanée | Medium produit | Hors périmètre G1 agent foundation ; SEC-001 partial |
| Pas runtime LLM / Workflow / Memory | Medium roadmap | Lots suivants (G1-M+ / gates suivants) — **non démarrés** |
| Redaction incomplete des logs applicatifs globaux | Low/Medium | SEC-015 partial volontaire |
| service_role bypass RLS PostgREST | Accepté contrôlé | Uniquement derrière TrustedExecutionContext + RPC scopées |
| CLI Homebrew `supabase` incompatible config | Low ops | Utiliser `./node_modules/.bin/supabase` |
| `pnpm test` dépôt complet / Stripe hors G1 | Hors périmètre | Non bloquant G1 (historique G1-J) |

---

## 8. Décision finale

### `PASS`

**Justification :**

1. Critical **SEC-GW-001** fermé lib + HTTP + preuve auth/RLS réelle.
2. Tous les **BLOCKED Supabase local** levés (Docker up, migrations appliquées, auth/SQL verts).
3. Chaîne de confiance HTTP→DB sous RLS démontrée sans contournement Gateway.
4. Aucun FAIL sur les suites G1 rejouées ; fail-closed auth préservé.
5. Les `partial` restants sont **volontaires et documentés**, pas des défauts de trust boundary à « forcer au vert ».

**Ce que PASS ne signifie pas :**

- Inventaire harness 92/92 exact (reste 12 exact / 80 blocked kind).
- Readiness Workflow / Memory / MFA / LLM runtime.
- Autorisation de démarrer G1-M dans ce lot (explicitement **non démarré**).

---

## 9. Documents liés

| Document | Rôle |
|---|---|
| `SID_GATE_G1K_EVIDENCE.md` | Update statut auth E2E |
| `SID_GATE_G1L_EVIDENCE.md` | Update statut auth E2E / SEC-GW-001 |
| `SID_GATE_G1J_CONSOLIDATION.md` | Update décision opérationnelle post-consolidation |
| `scripts/g1/catalog.yaml` | Rationales + bindings `:auth` (kind inchangé) |

---

## 10. Proposition de commit (non exécutée)

```
docs(g1): consolidate Gate G1 final PASS after local Supabase auth/RLS

Record E2E auth proofs (G1-K/L), applied G1-J migration, and control matrix;
update catalog rationales/bindings without changing evaluation contracts.
```
