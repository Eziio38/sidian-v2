# SIDIAN — Preuve de lot G1-L (Server Entry Point E2E)

**Lot :** G1-L — Server Entry Point authentifié / HTTP → Gateway → Router  
**Gate G1 global :** inventaire harness **non 92/92 exact** (EVAL exactes inchangées en volume ; SEC-001 / TOOL-002 / TOOL-003 / SEC-015 restent **`partial`**) — fondation opérationnelle : voir consolidation finale (**PASS**)  
**Date UTC :** 2026-07-25T19:39:13Z  
**SHA testé :** `f7c64ff8146c7d9170e31847c895eb2cb7e49ddf`  
*(SHA = HEAD au moment de la validation ; working tree non commitée — aucun commit / push.)*

> Synthèse humaine. Non réécrite automatiquement par le harness.

## Point d’entrée canonique

`POST /api/agent/tools` — `src/app/api/agent/tools/route.ts`

- Avant G1-L : **0** route agent sous `src/app/api/agent/**`
- Autres API existantes : `/api/health`, `/api/stripe/webhook` (hors périmètre agent)
- Pas de second point d’entrée agent créé

## Chaîne HTTP complète

```
Incoming HTTP Request (POST, application/json, body borné)
  → createAgentToolsRouteHandler (auth/**, server-only)
      · AuthMaterial : cookies SSR et/ou Authorization Bearer
      · Client Supabase **user-scopé** (principal + membership)
      · ToolRouter **service_role** (audit / idempotency / approvals) — tenant trusted only
  → createAgentServerHandler
      · method / Content-Type / size / JSON once → ExternalToolRequest (schéma G1-K)
      · RequestGateway.resolve → TrustedExecutionContext
      · refuse si non authenticated
      · ToolRouter.route(intent, TrustedExecutionContext)
  → réponse HTTP sanitizée
```

## Fichiers livrés

### Multitask

| Zone | Fichiers | Rôle |
|---|---|---|
| Inventaire | (constat) | Canonique = nouvelle route agent ; réutilise G1-K |
| Server adapter | `src/lib/agent/server/**` | `createAgentServerHandler`, adapters HTTP, limits, errors |
| Auth / câblage | `src/lib/agent/server/auth/**` | AuthMaterial + Gateway user + Router service_role |
| Route | `src/app/api/agent/tools/route.ts` | `POST` → `createAgentToolsRouteHandler` |
| Tests | `*.test.ts`, fixtures, `scripts/test-g1-l-agent-server-auth.mjs` | Unitaires HTTP + intégration fail-closed |

### Intégration (ce lot)

| Fichier | Changement |
|---|---|
| `package.json` | `test:g1-l`, `test:g1-l:auth` |
| `scripts/g1/catalog.yaml` | SEC-001 / TOOL-002 / TOOL-003 / SEC-015 → `partial` + bindings HTTP |
| `src/lib/agent/server/anti-bypass.architecture.test.ts` | Garde structurelle anti-contournement |
| `src/lib/agent/server/index.ts` + `route-handler.ts` | `import "server-only"` |
| `docs/implementation/SID_GATE_G1L_EVIDENCE.md` | cette preuve |
| `SID_GATE_G1K_EVIDENCE.md` / `SID_GATE_G1J_CONSOLIDATION.md` | notes status courtes G1-L |

## Mécanisme auth réel

| Élément | Source |
|---|---|
| Session | Cookies Next/Supabase SSR **ou** `Authorization: Bearer` (anon key + JWT user) |
| Vérification | `getUser()` via client user-scopé — pas de claims décodés non vérifiés |
| AuthMaterial | `ServerRequestAuthAdapter` (G1-K) — **jamais** depuis le body JSON |
| Token au Router | **Jamais** — hors TrustedExecutionContext |

## Sélection / vérification tenant

| Élément | Règle |
|---|---|
| `requested_tenant_id` | Hint non fiable jusqu’à membership |
| Membership | `prestataire` 1:1 via resolver user-scopé + RLS |
| Tenant écrit (audit/RPC) | Uniquement `TrustedExecutionContext.tenant_id` |
| Body `tenant_id` / `actor_id` / `grants` | Refusé (schéma ExternalToolRequest) |

## Contrat HTTP

Corps canonique :

```json
{
  "request_id": "...",
  "correlation_id": "...",
  "status": "success | blocked | pending | error",
  "code": "...",
  "data": {},
  "degraded": { "observability": false }
}
```

Statuts typiques : 200 succès/replay ; 202 pending (approval / in_progress) ; 400/413/415 requête ; 401 auth ; 403 tenant/permission ; 404 outil non exposé ; 409 conflit ; 500/503 sanitizés.

## Limites / timeouts (défauts)

| Borne | Défaut |
|---|---|
| `max_body_bytes` | 256 KiB |
| `gateway_timeout_ms` | 5 000 |
| `router_timeout_ms` | 25 000 |
| `total_timeout_ms` | 30 000 |

Documentés dans `src/lib/agent/server/limits.ts` — injectables, pas de magie dispersée.

## Mapping d’erreurs

Codes stables (`AGENT_SERVER_ERROR_CODES`) :  
`HTTP_METHOD_NOT_ALLOWED`, `HTTP_CONTENT_TYPE_*`, `HTTP_BODY_*`, `HTTP_REQUEST_*`, `AUTHENTICATION_*`, `TENANT_ACCESS_DENIED`, `AGENT_ROUTE_FAILED`, `AGENT_DEPENDENCY_UNAVAILABLE`, `INTERNAL_SERVER_ERROR`.  
Messages sûrs uniquement — jamais JWT / cookie / SQL / stack / secret.

## Anti-contournement

| Contrôle | Résultat |
|---|---|
| Grep `src/app` : `createToolRouter` / `buildTrustedExecutionContext` / `toTrustedRouteInput` / `router.route(` | **Aucun** |
| Route canonique | Uniquement `createAgentToolsRouteHandler` + `server-only` |
| `createToolRouter` production server | Uniquement `auth/create-router.ts` (`server-only`) |
| Modules sensibles | `server-only` sur `server/index`, `route-handler`, `auth/**` |
| Test architectural | `anti-bypass.architecture.test.ts` |

### Anciens appels directs Router (inventaire)

| Emplacement | Statut |
|---|---|
| `src/app/**` | Aucun import Router / Gateway builders |
| Tests / fixtures router & server | Conservés (hors surface publique) |
| `route-from-gateway.ts` | Orchestrateur lib optionnel — pas exposé HTTP |
| `auth/create-router.ts` | Seul câblage production ; derrière Gateway via handler |

## service_role

Documenté dans `auth/service-role.ts` :

- Auth / membership = **user** uniquement
- Audit / idempotency / approvals = **service_role** avec `tenant_id` trusted
- Ne contourne pas le handler : body ne choisit pas le tenant ; RPC scopent `p_tenant_id`

## Tests

| Suite | Résultat |
|---|---|
| `pnpm test:g1-l` | **51 passed**, 11 skipped (intégration auth locale) — *historique G1-L* |
| Unitaires HTTP (brief 1–45) + route + anti-bypass | Vert (`route-handler.test.ts`, `route.test.ts`, `anti-bypass.architecture.test.ts`) |
| `pnpm test:g1-l:auth` | Fail-closed si Supabase/Docker local down — **pas de faux PASS** — *historique G1-L* |
| Intégration 46–56 | **BLOCKED** (infra) — à rejouer stack up — *historique G1-L* |

### Update consolidation finale (2026-07-25) — changement de statut

| Suite / contrôle | Avant | Après |
|---|---|---|
| `pnpm test:g1-l` | 51 PASS + 11 SKIPPED | **62 PASS / 0 SKIPPED** |
| `pnpm test:g1-l:auth` | BLOCKED / fail-closed (Docker/Supabase down) | **11/11 PASS** |
| Intégration 46–56 | BLOCKED infra | **PASS** |
| SEC-GW-001 preuve auth E2E HTTP | BLOCKED / partial | **PASS / FERMÉ E2E** |
| Décision Gate G1 (fondation) | non PASS (infra) | **PASS** — voir `SID_GATE_G1_FINAL_CONSOLIDATION.md` |

## EVAL / catalogue

| EVAL | Kind | Notes |
|---|---|---|
| EVAL-SEC-001 | **partial** | Gateway + HTTP entry ; pas MFA/SSO/révocation/prod |
| EVAL-TOOL-002 | **partial** | Isolation tenant HTTP ; pas LLM runtime E2E exact |
| EVAL-TOOL-003 | **partial** | Idem |
| EVAL-SEC-015 | **partial** | Redaction audit/obs + HTTP sanitizé ; pas tous logs système |
| Aucune EVAL → `exact` injustifié | — | Pas de surdéclaration |

## Critical SEC-GW-001 (E2E)

| Couche | État |
|---|---|
| Lib agent (G1-K) | **FERMÉ** — intention sans identité ; TrustedExecutionContext ; grants dérivés |
| HTTP entry (G1-L) | **FERMÉ** côté code : Gateway obligatoire avant Router ; anti-bypass structurel |
| Preuve auth réelle cross-tenant | **BLOCKED / partial** — `test:g1-l:auth` fail-closed (Docker/Supabase local down) ; jamais faux PASS. À rejouer stack up pour fermeture E2E mesurée. — *historique G1-L* |

> **Update consolidation finale (2026-07-25) :** Preuve auth réelle cross-tenant → **PASS** (`test:g1-l:auth` 11/11 + RLS F/G/H). SEC-GW-001 **FERMÉ E2E**. Inventaire harness reste 12 exact / 80 blocked (kinds) — fondation agent **PASS** opérationnel.

## Limites restantes

- Pas OAuth / MFA / SSO inventés
- Pas outil métier réel branché (executor fail-closed)
- Pas Workflow / Memory / UI / LLM
- Intégration auth réelle dépend de Supabase local

## Validations exécutées (intégration)

| Commande | Résultat |
|---|---|
| `pnpm test:g1-l` | **51 passed**, 11 skipped (intégration auth locale) |
| `pnpm test:g1-l:auth` | **Fail-closed** (auth locale absente — Docker daemon down) — conforme brief, **pas de faux PASS** |
| `pnpm supabase:start` | **BLOCKED** — `Cannot connect to the Docker daemon` |
| `pnpm test:g1-k` | **99 passed**, 12 skipped (intégration auth) |
| `pnpm test:g1-i` … `test:g1-b` | Vert |
| `pnpm test:g1-a` | PASS=12 FAIL=19 BLOCKED=61 — bindings SQL/auth/stripe **exit 1** (Supabase local down), pas régression lib G1-L |
| `pnpm test:g1-a:strict` | Même cause infra (local down) |
| `pnpm typecheck` | OK |
| `pnpm lint` | 0 error (warnings préexistants / mineurs) |
| `pnpm build` | OK — route `ƒ /api/agent/tools` listée |
| `pnpm test` (suite complète) | Non rejouée intégralement — dépendances locales down (même cause) |
| `git diff --check` | OK |
| Nouvelle migration SQL G1-L | Non requise |
| Commit / push | **Aucun** |
