# SIDIAN — Preuve de lot G1-K (Request Gateway / trust boundary)

**Lot :** G1-K — Request Gateway / trust boundary  
**Gate G1 global :** inventaire harness **non 92/92 exact** (EVAL exactes inchangées en volume ; SEC-001 / TOOL-002 / TOOL-003 → `partial`) — fondation opérationnelle : voir consolidation finale (**PASS**)  
**Date UTC :** 2026-07-25T11:11:39Z  
**SHA testé :** `f7c64ff8146c7d9170e31847c895eb2cb7e49ddf`  
*(SHA = HEAD au moment de la validation ; working tree non commitée — aucun commit / push.)*

> Synthèse humaine. Non réécrite automatiquement par le harness.

## Fichiers livrés

### Multitask (Gateway + adapters + tests)

| Fichier | Rôle |
|---|---|
| `src/lib/agent/gateway/**` | `createRequestGateway`, ExternalToolRequest strict, TrustedExecutionContext, resolvers |
| `src/lib/agent/gateway/adapters/**` | SupabaseAuthPrincipalResolver, TenantMembershipResolver, ServerRequestAuthAdapter |
| `src/lib/agent/gateway/to-trusted-route-input.ts` | Assemble ValidatedToolIntent + TrustedExecutionContext |
| `src/lib/agent/gateway/*.test.ts` + fixtures | ~30 unitaires + intégration auth (skip si local down) |
| `scripts/test-g1-k-agent-gateway-auth.mjs` | Fail-closed si auth locale absente |

### Intégration Router (ce lot — ferme SEC-GW-001 côté lib)

| Fichier | Rôle |
|---|---|
| `src/lib/agent/router/types.ts` | `ValidatedToolIntent` ; `ToolRouteContext = TrustedExecutionContext` ; ancien `ToolRouteRequest` = `never` |
| `src/lib/agent/router/request-schema.ts` | Schéma strict intention (sans identité) + trusted context |
| `src/lib/agent/router/derive-grants.ts` | Grants dérivés serveur depuis définition + tenant trusted |
| `src/lib/agent/router/router.ts` | `route(intent, trustedContext)` — actor/tenant/grants depuis contexte |
| `src/lib/agent/router/route-from-gateway.ts` | Orchestrateur optionnel Gateway → Router |
| `src/lib/agent/router/router.test.ts` + fixtures | Contrat mis à jour ; poisons identité/tenant/grants |
| `src/lib/agent/router/derive-grants.test.ts` | Dérivation grants |
| `src/lib/agent/router/route-from-gateway.test.ts` | Pont gateway→router |

### Catalogue / scripts / preuve

| Fichier | Changement |
|---|---|
| `package.json` | `test:g1-k`, `test:g1-k:auth` |
| `scripts/g1/catalog.yaml` | SEC-001 / TOOL-002 / TOOL-003 → `partial` + bindings |
| `docs/implementation/SID_GATE_G1K_EVIDENCE.md` | cette preuve |
| `docs/implementation/SID_GATE_G1J_CONSOLIDATION.md` | note status critical SEC-GW-001 |

## Architecture

```
ExternalToolRequest (body non fiable)
  + AuthMaterial (Server Auth Adapter — jamais body)
  → RequestGateway.resolve
  → TrustedExecutionContext
  → toTrustedRouteInput / route(ValidatedToolIntent, TrustedExecutionContext)
  → Permission / Idempotency / Approvals / Audit / Obs (tenant+actor trusted)
  → Tool Executor
```

### Modèle de confiance

| Élément | Source |
|---|---|
| Identité acteur | `getUser()` / JWT vérifié (AuthPrincipalResolver) |
| Tenant | `prestataire` 1:1 (TenantMembershipResolver) — hint `requested_tenant_id` vérifié |
| Rôles | Allowlist `owner` \| `member` sanitizés |
| Grants | `deriveGrants(trustedContext, toolRef, mode)` — **jamais body** |
| Horloge | `now` injecté (jamais `Date.now()` implicite) |

### Champs explicitement non fiables (body)

`tenant_id`, `actor_id`, `actor_type`, `roles`, `permissions`, `grants`, `membership`, `claims`, `service_role`, JWT/tokens/cookies, `human_validation` déclaratif, `tool_definition`, `executor`.

### Ancien contrat Router

- **Retiré** : `ToolRouteRequest` avec `actor` / `tenant` / `grants` déclaratifs.
- Type public `ToolRouteRequest = never` — coexistence silencieuse impossible.
- Fixtures / tests mis à jour exclusivement sur le nouveau contrat.

## Propagation services

| Service | Tenant / actor |
|---|---|
| Permission | Depuis TrustedExecutionContext + grants dérivés |
| Idempotency | `tenant_id` trusted |
| Approvals | `tenant_id` (+ actor côté create) trusted |
| Audit | Attribution tenant/acteur depuis contexte |
| Observability | Idem (via résultat/audit) |

## Propagation Supabase F/G/H (audit — pas de nouvelle migration)

| Couche | Modèle | Contournement silencieux ? |
|---|---|---|
| G1-F audit insert | `service_role` + row `tenant_id` depuis AuditEvent | Non si orchestrateur = Router G1-K (tenant trusted). Repo documenté. |
| G1-G idempotency RPC | `service_role` + `p_tenant_id` ; vérifie existence `prestataire` | `p_tenant_id` doit venir du TrustedExecutionContext uniquement. |
| G1-H approvals RPC | Idem ; SECURITY DEFINER + `search_path` fixé ; grants service_role only | Idem — pas de confiance body. |

**Migration G1-K :** non requise — policies/grants F/G/H déjà restrictifs (anon/authenticated sans mutation ; service_role via RPC). Correctif critical = ancrage TypeScript Gateway+Router, pas rewrite SQL.

**service_role ne contourne pas silencieusement :** il bypass RLS PostgREST, mais (1) l’identité trusted est imposée avant write par le Router, (2) les RPC G/H scopent par `p_tenant_id` + existence prestataire + guards de transition, (3) ServerRequestAuthAdapter n’utilise pas service_role pour résoudre l’utilisateur.

## Tests

| Suite | Résultat |
|---|---|
| `pnpm test:g1-k` (gateway + router) | **99 passed**, 12 skipped (intégration auth locale) — *historique G1-K* |
| Unitaires gateway (1–30) | OK (inclus) |
| Unitaires router + deriveGrants + routeFromGateway | OK |
| `node scripts/test-g1-k-agent-gateway-auth.mjs` | Fail-closed si local down ; à rejouer stack up — *historique G1-K* |
| Migrations F/G/H | Aucune nouvelle ; SQL existant inchangé |

### Update consolidation finale (2026-07-25) — changement de statut

| Suite | Avant | Après |
|---|---|---|
| `pnpm test:g1-k` | 99 PASS + 12 SKIPPED | **111 PASS / 0 SKIPPED** |
| `pnpm test:g1-k:auth` | BLOCKED / fail-closed (stack down) | **12/12 PASS** |
| Preuve auth Gateway SEC-GW-001 | BLOCKED infra | **PASS** |

## EVAL / catalogue

| EVAL | Kind | Notes |
|---|---|---|
| EVAL-SEC-001 | **partial** | Gateway + ancrage Router ; pas MFA/SSO/révocation instantanée |
| EVAL-TOOL-002 | **partial** | Isolation tenant tool-call via Gateway→Router ; pas E2E LLM runtime exact |
| EVAL-TOOL-003 | **partial** | Idem |
| Aucune EVAL → `exact` injustifié | — | Pas de surdéclaration |

## Critical G1-J SEC-GW-001

| Avant G1-K | Après G1-K |
|---|---|
| Ouvert — `tenant_id` + `grants` dans body Router | **FERMÉ côté lib agent** : intention sans identité ; contexte = TrustedExecutionContext ; grants dérivés serveur ; tests poison verts |

Gate G1 global reste non PASS (volume exact) — hors critère de fermeture SEC-GW-001 lib.

## Limites restantes

- Pas OAuth / MFA / SSO inventés
- Pas Workflow / Memory
- Intégration auth réelle dépend de Supabase local up
- Grants V1 = permissions requises de la ToolDefinition pour tout membre actif (filtrage mode/autonomie/HV reste Permission Service)

> **Update G1-L (2026-07-25) :** point d’entrée HTTP E2E livré (`POST /api/agent/tools`) — voir `SID_GATE_G1L_EVIDENCE.md`. SEC-GW-001 côté HTTP documenté dans cette preuve G1-L (fermé E2E si auth locale up ; partial/BLOCKED si down).
>
> **Update consolidation finale G1 (2026-07-25) :** Supabase local up ; `pnpm test:g1-k` → **111 passed / 0 skipped** ; `pnpm test:g1-k:auth` → **12/12 PASS**. SEC-GW-001 preuve auth Gateway : **PASS** (plus BLOCKED infra). Voir `SID_GATE_G1_FINAL_CONSOLIDATION.md`. Kind catalogue SEC-001 / TOOL-002 / TOOL-003 restent **`partial`**.

## Validations prévues (rapport agent)

Voir rapport final d’intégration : `test:g1-k` … `test:g1-a` (+ strict), typecheck, lint, build, `git diff --check`.

## Validations exécutées (intégration)

| Commande | Résultat |
|---|---|
| `pnpm test:g1-k` | **99 passed**, 12 skipped (intégration auth) |
| `pnpm test:g1-i` … `test:g1-b` | Vert |
| `pnpm test:g1-a` / `:strict` | Bindings SQL/auth/stripe **exit 1** — Supabase local down (infra), pas une régression lib G1-K |
| `node scripts/test-g1-k-agent-gateway-auth.mjs` | **Fail-closed** clair (auth locale absente) — conforme brief |
| `pnpm typecheck` | OK |
| `pnpm lint` | 0 error (warnings préexistants) |
| `pnpm build` | OK |
| Nouvelle migration SQL G1-K | Non requise |
| `git diff --check` | OK |
| Commit / push | **Aucun** |