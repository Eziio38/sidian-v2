# SIDIAN — Gate G1 Consolidation (lot G1-J)

**Lot :** G1-J — Consolidation Gate G1  
**Date UTC :** 2026-07-24T22:37:14Z  
**SHA baseline (HEAD) :** `f7c64ff8146c7d9170e31847c895eb2cb7e49ddf`  
**Décision :** `FIXES_REQUIRED`  
*(Working tree non commitée — aucun commit / push dans ce lot.)*

> Synthèse d’intégration des audits A–E + correctifs critical/high **lib/SQL** autorisés.  
> Ne couvre pas G1-K, Request Gateway complet, Workflow Engine ni Memory.

---

## 1. Executive summary

Gate G1 reste **non PASS** (12 exact / 80 blocked sur 92 EVAL inventoriées). Les lots G1-B…G1-I livrent un pipeline Router déterministe cohérent (registry → permission → idempotence → approval → executor → audit → observability), mais trois classes de risques bloquent une promotion :

1. **Critical (hors périmètre correctif G1-J)** : `tenant_id` + `grants` acceptés dans le corps de requête Router sans ancrage JWT — écart trust boundary / Request Gateway (SEC-001 déjà `partial`).
2. **High lib/SQL (corrigés ici)** : mapping `autonomy_mismatch` perdu ; catch externe `route()` sans audit ; échec silencieux `audit.build()` ; CHECK `reason_code` G1-F incomplet ; terminaux G1-G mutables via `UPDATE` service_role.
3. **Medium** (documentés, non corrigés sauf incidental) : double contrat ToolRouter, duplication `hashIdempotencyKey`, faux verts fakes Router, SQL hors CI.

**Décision réaliste :** `FIXES_REQUIRED` — les high lib/SQL sont traités, mais le critical gateway reste ouvert → pas de `READY_FOR_NEXT_LOT` pour un composant métier (Workflow/Memory). Prochain lot recommandé = **Request Gateway / trust boundary**.

---

## 2. Périmètre & non-périmètre

| Inclus | Exclus |
|---|---|
| Rapport consolidation 20 sections | G1-K |
| Migration corrective CHECK + guard G1-G | Request Gateway JWT/OAuth inventé |
| Fixes Router/audit-emit high | Workflow Engine / Memory |
| Catalogue kind/rationale/bindings si écart clair | Boost artificiel PASS |
| Validations `test:g1-*` / typecheck / lint / build | Commit / push |

---

## 3. Baseline SHA & inventaire livré

| Élément | Valeur |
|---|---|
| `git rev-parse HEAD` | `f7c64ff8146c7d9170e31847c895eb2cb7e49ddf` |
| Preuves G1-A…I | `docs/implementation/SID_GATE_G1{A…I}_EVIDENCE.md` |
| Migrations historiques | `20260724220000` F / `230000` G / `240000` H |
| Migration G1-J | `supabase/migrations/20260724250000_g1j_audit_reason_codes_and_idempotency_guards.sql` |

---

## 4. Synthèse audits A–E

### A — Normatif
- 92 EVAL inventoriées ; **PASS=12** / **BLOCKED=80** ; Gate G1 non PASS.
- Exactes = TOOL registry / permission / router.
- 80 blocked = `partial` / `analog` / `none`.
- ~144 EVAL hors inventaire (MODE/WF/MEM/…) ; DOC-007 préfixe hors strict ; rationales `none` « composant absent » partiellement obsolètes post-G1-D.

### B — Architecture
- Pipeline Router globalement OK.
- **High** : `autonomy_mismatch` → `APPROVAL_SCOPE_MISMATCH` (perd `APPROVAL_AUTONOMY_MISMATCH`).
- **High** : catch externe `route()` → `internalError()` sans audit/obs.
- **Medium** : échec silencieux `audit.build()` ; double contrat ToolRouter ; duplication `hashIdempotencyKey`.

### C — Sécurité
- **Critical** : tenant/grants non ancrés JWT (gap gateway — **non inventé ici**).
- **High** : TTL/reprise idempotence ; consume sans exécution (déjà mitigé G1-H) ; manque tests Router cross-tenant.
- Medium/Low : HV OK, SQL concurrence OK, etc.

### D — SQL/RLS
- **High** : CHECK `reason_code` G1-F manque ~15 codes G1-G/H → fail-closed persistance.
- **High** : terminaux G1-G modifiables via UPDATE service_role (pas de guard transition).
- Tests SQL F/G/H verts historiquement ; `supabase db reset` CLI cassé (infra).
- **Critical RLS : aucun.**

### E — Tests
- Suites unitaires vertes ; faux verts fakes Router ; SQL hors CI ; couverture ~79 % lignes.

---

## 5. Harness & catalogue (état)

| Métrique | Valeur |
|---|---|
| EVAL inventoriées | 92 |
| `exact` | 12 |
| `partial` | 22 |
| `analog` | 4 |
| `none` | 54 |
| Scripts `test:g1-d`…`i` | absents de `package.json` HEAD → **restaurés en G1-J** (hygiène consolidation, non inflation PASS) |

---

## 6. Surdéclarations / sous-déclarations

| ID | Constat | Action G1-J |
|---|---|---|
| EVAL-TOOL-017 | Exact G1-C déjà correct ; risque de lecture « exact G1-H » | Rationale clarifiée « exact G1-C only » |
| EVAL-TOOL-002/003/008–012/016 | Rationale `none` « composant absent G1-A » **obsolète** (composants présents) | Rationale seule mise à jour — **kind reste `none`** |
| EVAL-SEC-001 | `partial` déjà correct (JWT/RLS ≠ ancrage agent) | Aucun changement kind ; gap gateway documenté §17 |
| Aucune surdéclaration `exact` détectée à corriger | — | Pas de boost PASS |

---

## 7. Vulnérabilités critical / high

| Sévérité | ID | Description | Traitement G1-J |
|---|---|---|---|
| Critical | SEC-GW-001 | `tenant_id` + `grants` dans body Router non ancrés JWT | **Documenté seulement** — prérequis prochain lot Request Gateway → **FERMÉ en G1-K** (voir `SID_GATE_G1K_EVIDENCE.md`) |
| High | ARC-MAP-001 | `autonomy_mismatch` → mauvais code Router | **Corrigé** |
| High | ARC-CATCH-001 | catch `route()` sans audit/obs | **Corrigé** |
| High | ARC-AUDIT-001 | `audit.build()` silencieux | **Corrigé** (fail-closed `AUDIT_BUILD_FAILED`) |
| High | SQL-RC-001 | CHECK `reason_code` incomplet | **Corrigé** (migration) |
| High | SQL-IDEM-001 | terminaux G1-G mutables | **Corrigé** (guard transition) |
| High | SEC-TTL-001 | TTL/reprise double effet idempotence | Documenté — déjà partiellement couvert RPC ; pas d’élargissement hors brief |
| High | SEC-XT-001 | manque tests Router cross-tenant | Documenté — non inventé hors brief |

---

## 8. Vulnérabilités medium / low (non bloquantes G1-J)

| Sévérité | Sujet | Statut |
|---|---|---|
| Medium | Double contrat ToolRouter (interfaces vs `createToolRouter`) | Documenté |
| Medium | Duplication `hashIdempotencyKey` (approvals vs audit-emit) | Documenté |
| Medium | Faux verts fakes Router / SQL hors CI | Documenté |
| Low | Couverture ~79 % | Acceptable pour consolidation |

---

## 9. Corrections planifiées (avant application)

| # | Fichier | Risque | Correction minimale | Test ajouté |
|---|---|---|---|---|
| 1 | `supabase/migrations/20260724250000_g1j_*.sql` | Persistance audit fail-closed sur codes G1-G/H | DROP + recreate CHECK `reason_code` aligné `AUDIT_REASON_CODES` (+ `APPROVAL_AUTONOMY_MISMATCH`, `AUDIT_BUILD_FAILED`) | Script F : contrainte mise à jour ; smoke codes |
| 2 | même migration | Terminaux G1-G réécrits service_role | Trigger `guard_agent_idempotency_record_transition` (analog G1-H) | Script G : UPDATE terminal → exception |
| 3 | `router/error-codes.ts` + `router.ts` | Perte sémantique autonomie | Code `APPROVAL_AUTONOMY_MISMATCH` + mapping | `router.test.ts` |
| 4 | `router.ts` catch externe | Issue sans audit | Catch → `emitAuditOnResult` + identité unresolved | `router.test.ts` |
| 5 | `router/audit-emit.ts` | Build silencieux | Fail-closed `AUDIT_BUILD_FAILED` | `router.test.ts` (remplace expectSuccess) |
| 6 | `package.json` | Scripts G1-D…I manquants | Restaurer scripts évidence | Exécution Phase 4 |
| 7 | `catalog.yaml` | Rationales obsolètes | Rationale only (TOOL) | Harness G1-A |

---

## 10. Corrections appliquées

Voir §9 — toutes les lignes 1–7 exécutées dans le working tree. Détail fichiers : §11–13.

---

## 11. Migration SQL fraîche

**Fichier :** `supabase/migrations/20260724250000_g1j_audit_reason_codes_and_idempotency_guards.sql`

1. `ALTER TABLE … DROP CONSTRAINT agent_audit_events_reason_code_ck` puis recreate avec l’union complète (permissions ∪ router incl. G1-G/H + `APPROVAL_AUTONOMY_MISMATCH` + `AUDIT_BUILD_FAILED`).
2. Fonction + trigger `guard_agent_idempotency_record_transition` :
   - champs d’intention immuables ;
   - `succeeded` / `failed` → aucune UPDATE (`agent_idempotency_record_terminal`) ;
   - `in_progress` → seulement `in_progress|succeeded|failed`.

Historiques F/G/H **non édités**.

---

## 12. Fixes TypeScript Router / audit

| Changement | Comportement |
|---|---|
| `APPROVAL_AUTONOMY_MISMATCH` | Code Router + catégorie permission + mapping consume |
| Catch `route()` | Si `context.now` valide → audit minimal unresolved + obs ; sinon `internalError()` (pas d’horloge inventée) |
| `emitAuditOnResult` build fail | `blocked` / `AUDIT_BUILD_FAILED` (même caveat effet métier que G1-F persistence) |

---

## 13. Catalogue (ligne par ligne)

| EVAL | Champ | Avant → Après | Justification |
|---|---|---|---|
| TOOL-017 | rationale | exact G1-C → **exact G1-C only** explicite | Éviter confusion G1-H |
| TOOL-002 | rationale | « composant absent G1-A » → composants présents ; scénario cross-tenant tool non prouvé → reste `none` | Rationale obsolète |
| TOOL-003 | idem | idem | idem |
| TOOL-008 | idem | idem | idem |
| TOOL-009 | idem | idem | idem |
| TOOL-010 | idem | idem | idem |
| TOOL-011 | idem | idem | idem |
| TOOL-012 | idem | idem | idem |
| TOOL-016 | idem | idem | idem |

**Aucun** passage `none`→`partial`/`exact`.

---

## 14. RLS

- Aucune régression RLS attendue (pas de nouvelles policies).
- Critical RLS : **aucun** (confirmé audit D).
- Guard transition G1-G = contrainte machine d’état, pas de changement d’isolation tenant.

---

## 15. Concurrence

- Claim/complete/fail G1-G inchangés fonctionnellement.
- Guard empêche mutation terminale concurrente / manuelle service_role.
- Scripts SQL F/G/H à rejouer après migration (Phase 4).

---

## 16. Validations (Phase 4)

| Commande | Résultat |
|---|---|
| `pnpm test:g1-a` | PASS — PASS=12 FAIL=0 BLOCKED=80 |
| `pnpm test:g1-a:strict` | PASS — idem |
| `pnpm test:g1-b` | PASS — 18 |
| `pnpm test:g1-c` | PASS — 28 |
| `pnpm test:g1-d` | PASS — 62 |
| `pnpm test:g1-e` | PASS — 19 |
| `pnpm test:g1-f` | PASS — 16 |
| `pnpm test:g1-g` | PASS — 22 |
| `pnpm test:g1-h` | PASS — 92 |
| `pnpm test:g1-i` | PASS — 100 |
| `pnpm test:g1-f:rls` | PASS — 10/10 (après apply migration G1-J via `pg`) |
| `pnpm test:g1-g:sql` | PASS — 17/17 |
| `pnpm test:g1-h:sql` | PASS — 17/17 |
| `pnpm typecheck` | PASS (fix hygiène G1-J : schema_version dupliqué + imports interfaces) |
| `pnpm lint` | 0 errors / 11 warnings (préexistants / hors critique) |
| `pnpm build` | PASS |
| `pnpm test` (dépôt) | FAIL hors G1 — `SID-STRIPE-002-A` purge événements expirés (préexistant) |
| `git diff --check` | PASS |
| `supabase status` / `db reset` | CLI cassé (`experimental.pgdelta` / `local_smtp`) — apply manuel via `pg` |

SHA baseline : `f7c64ff8146c7d9170e31847c895eb2cb7e49ddf`

---

## 17. Gap Request Gateway (non corrigé — prérequis)

Le Router accepte `tenant_id` et `grants` fournis par l’appelant. Sans **Request Gateway** qui :

1. authentifie JWT prestataire ;
2. ancre `tenant_id` = claim authentifié ;
3. dérive / valide les grants côté serveur ;

toute surface LLM→Router en prod reste **spoofable**.  
**Ne pas** contourner en fake OAuth dans G1-J.  
Catalogue : EVAL-SEC-001 déjà `partial` — correct.

---

## 18. Prochain lot recommandé

**Request Gateway / trust boundary** (ancrage tenant + grants + anti-spoof).

Justification : seul remaining **critical** pour une utilisation LLM→Router ; les correctifs SQL catalogue/reason_code sont traités ici. Workflow/Memory seraient prématurés tant que la trust boundary n’existe pas.

Alternative secondaire si gateway différé : correctifs tests Router cross-tenant + CI SQL — toujours avant Workflow.

---

## 19. EVAL ciblées post-fix

| EVAL / thème | Effet attendu |
|---|---|
| TOOL approval / autonomy | Meilleure traçabilité code (pas de nouveau PASS forcé) |
| SEC-001 | Reste `partial` — gateway requis pour exact |
| OBS/IDEMP/AUDIT partial | Inchangés en kind |
| Harness G1-A | Stable (pas d’inflation PASS) |

---

## 20. Décision

### `FIXES_REQUIRED`

**Pourquoi pas `READY_FOR_NEXT_LOT` (état G1-J) :** le critical gateway (SEC-GW-001) n’était pas résolu dans ce lot ; Gate G1 global reste non PASS (12/92 exact). Les high lib/SQL sont corrigés, ce qui **autorise** d’ouvrir le prochain lot **Request Gateway**.

> **Update G1-K (2026-07-25) :** SEC-GW-001 est **fermé côté lib agent** (Gateway + Router câblés, identité hors body, tests verts). Voir `SID_GATE_G1K_EVIDENCE.md`. La décision G1-J historique `FIXES_REQUIRED` reste le snapshot de consolidation ; le statut operational critical se lit désormais dans la preuve G1-K.
>
> **Update G1-L (2026-07-25) :** SEC-GW-001 porté au point d’entrée HTTP (`POST /api/agent/tools`) — voir `SID_GATE_G1L_EVIDENCE.md` (E2E fermé ou partial/BLOCKED selon auth locale).
>
> **Update consolidation finale G1 (2026-07-25) — changement de statut :**  
> - Décision G1-J historique `FIXES_REQUIRED` **conservée comme snapshot** de ce lot.  
> - Décision opérationnelle Gate G1 (fondation A…L) → **`PASS`** — voir `SID_GATE_G1_FINAL_CONSOLIDATION.md`.  
> - SEC-GW-001 : **FERMÉ E2E** (lib + HTTP + `test:g1-k:auth` / `test:g1-l:auth` verts ; Docker/Supabase local up ; migration G1-J appliquée).  
> - SEC-001 / TOOL-002 / TOOL-003 / SEC-015 : restent **`partial`** (volontaire).  
> - G1-M : **non démarré**.

**Pourquoi pas `ARCHITECTURE_REVIEW_REQUIRED` :** le pipeline Router est architecturellement sain ; les écarts sont des bugs/gaps localisés, pas un redesign.

### Proposition découpage commits (non exécutés)

1. `fix(g1j): align audit reason_code CHECK + idempotency terminal guards`
2. `fix(g1j): map autonomy_mismatch and fail-closed audit build / route catch`
3. `test(g1j): router autonomy/build/catch + SQL terminal immutability`
4. `chore(g1j): restore test:g1-d…i scripts + catalog rationale hygiene`
5. `docs(g1j): add SID_GATE_G1J_CONSOLIDATION.md`

---

## Rapport final 17 points

1. **Décision :** `FIXES_REQUIRED` — high lib/SQL corrigés ; critical gateway ouvert → Gate G1 non PASS.
2. **Commandes :** G1-A…I verts ; SQL F/G/H verts post-migration ; typecheck/build verts ; `pnpm test` rouge sur Stripe-002-A hors périmètre (§16).
3. **Harness :** G1-A inventaire 92 EVAL — PASS=12 / BLOCKED=80 / FAIL=0.
4. **nb EVAL inventoriées :** 92 (236 extraites docs ; ~144 hors inventaire).
5. **Surdéclarées :** 0 exact injustifié.
6. **Sous-déclarées (rationale) :** TOOL-002/003/008–012/016 (rationales mises à jour, kind `none` conservé).
7. **Vuln critical/high :** 1 critical ouvert (SEC-GW-001) ; high lib/SQL corrigés (autonomie, catch, build, CHECK reason_code, guard terminaux).
8. **Medium/low :** double contrat ToolRouter ; hash dupliqué ; fakes Router ; SQL hors CI ; couverture ~79 %.
9. **Corrections :** migration G1-J + Router/error-codes/audit-emit + tests + scripts package + catalog + hygiène typecheck.
10. **Fichiers clés :** `docs/implementation/SID_GATE_G1J_CONSOLIDATION.md`, `supabase/migrations/20260724250000_g1j_*.sql`, `src/lib/agent/router/{error-codes,router,audit-emit,router.test}.ts`, `package.json`, `scripts/g1/catalog.yaml`.
11. **Migrations fraîches :** `20260724250000_g1j_audit_reason_codes_and_idempotency_guards.sql` (appliquée locale via `pg`).
12. **RLS :** pas de critical ; F/G/H revalidés.
13. **Concurrence :** claim/complete/fail OK ; guard terminal n’empêche pas reprise TTL.
14. **Prochain lot :** Request Gateway / trust boundary (ancrage tenant + grants) — pas Workflow/Memory.
15. **EVAL ciblées :** tracing TOOL approval/autonomy ; SEC-001 reste `partial`.
16. **Commits proposés :** §20 (5) — **non exécutés**.
17. **Pas commit / pas push :** confirmé.  
    SHA HEAD : `f7c64ff8146c7d9170e31847c895eb2cb7e49ddf`
