# SIDIAN — Preuve de lot G1-F (synthèse versionnée)

**Lot :** G1-F — Persistance append-only audit (`agent_audit_events`) + pont Router  
**Gate G1 global :** toujours **NOT EXECUTED / non PASS**  
**Date UTC :** 2026-07-24T20:54:55Z  
**SHA testé :** `f7c64ff8146c7d9170e31847c895eb2cb7e49ddf`  
*(SHA = HEAD au moment de la validation Vitest / harness ; working tree non commitée.)*

> Synthèse humaine. Non réécrite automatiquement par le harness.

## Fichiers livrés

### Multitask (persistance)

| Fichier | Rôle |
|---|---|
| `supabase/migrations/20260724220000_g1f_agent_audit_events.sql` | Table `agent_audit_events`, RLS, service_role INSERT, triggers anti-UPDATE/DELETE |
| `src/lib/agent/audit/persistence/**` | `createSupabaseAuditRepository`, `AuditSink` / `asAuditSink`, mapping, erreurs structurées |
| `src/lib/agent/audit/persistence/repository.test.ts` | 16 tests unitaires (client mocké) |
| `scripts/test-g1-f-agent-audit-rls.mjs` | 10 assertions RLS/SQL réelles (Supabase local) |

### Intégration Router (ce lot)

| Fichier | Rôle |
|---|---|
| `src/lib/agent/router/types.ts` | `auditSink?: AuditSink` dans deps |
| `src/lib/agent/router/error-codes.ts` | `AUDIT_PERSISTENCE_FAILED` |
| `src/lib/agent/router/audit-emit.ts` | `emitAuditOnResult` async + `buildPersistenceFailedResult` |
| `src/lib/agent/router/router.ts` | `await sink.append` après build réussi, avant return |
| `src/lib/agent/router/router.test.ts` | +8 tests G1-F (append / await / fail-closed / …) |
| `src/lib/agent/router/test-fixtures/audit-sink.ts` | Spy sink mémoire |

### Catalogue / scripts / preuve

| Fichier | Changement |
|---|---|
| `package.json` | `test:g1-f`, `test:g1-f:rls` ; `test:g1-e` recentré sur `service.test.ts` |
| `scripts/g1/catalog.yaml` | `kind` / `rationale` / `bindings` uniquement — **aucune exact** |
| `docs/implementation/SID_GATE_G1F_EVIDENCE.md` | cette preuve |

## Architecture

```
route(request, context.now)
  → … contrôles G1-D …
  → issue terminale (success | blocked)
  → audit.build(draft, { now })           // 1× si now dispo
  → si auditSink injecté :
       await auditSink.append(event)      // exactement 1 tentative
       échec → AUDIT_PERSISTENCE_FAILED   // fail-closed, pas SQL/stack
  → return (après await append)
```

- **Pas de couplage Supabase dans le Router** : contrat `AuditSink` injecté (`asAuditSink(repository)` en composition).
- **Sink omis** : comportement G1-E (build mémoire uniquement).
- **Build échoue** : résultat Router conservé, **pas** d’append.
- **Effet exécuteur déjà produit** : échec persist ≠ annulation de l’effet (pas d’atomicité externe / compensation dans G1-F).

### Requêtes trop invalides (pas de correlation / tenant)

| Cas | Comportement exact |
|---|---|
| Contexte sans `now` | `ROUTER_INPUT_INVALID` ; **ni** build **ni** append ; **aucun** ID inventé |
| Requête invalide / `correlation_id` absent (avec `now`) | Build G1-E avec sentinelles fixes `"unresolved"` (tenant/acteur) — **pas** d’UUID inventés ; si sink présent, **une** tentative d’append ; la base peut rejeter un `tenant_id` non-UUID → `AUDIT_PERSISTENCE_FAILED` |

### Contenu interdit

Payload arguments, sortie brute, secrets, tokens, PAN, stack traces, SQL brut PostgREST — refusés / normalisés.

## Migration / policies (résumé)

- Table `public.agent_audit_events` — `audit_id` **text** (contrat G1-E `aud_…`), pas uuid technique.
- RLS : lecture scoped `current_prestataire_id()` ; INSERT réservé `service_role`.
- Triggers / privileges : pas d’UPDATE / DELETE applicatif.
- Distinct de `public.audit_log` (métier / Stripe).

## Liste des tests repository (16)

1–2 insertion + mapping · 3–4 invalide / champ inconnu · 5–8 payload/secret/token/stack  
9–11 erreurs normalisées / SQL non exposé / conflit · 12 non-mutation · 13 une tentative  
14–15 pas update/delete · 22 déterminisme mapping

## Liste des tests Router G1-F (+8 → 39 total)

- append 1× success / deny / approval / validation / business / technical  
- `route()` attend append (delay)  
- échec sink → `AUDIT_PERSISTENCE_FAILED` (effet exécuteur conservé)  
- exception sink → fail-closed sans stack  
- pas de double audit  
- pas d’append si build échoue ; event non muté / sans payload  
- sans `now` → ni build ni append  
- sink omis → compat G1-E

## RLS (script local)

```
pnpm test:g1-f:rls
# ≡ node scripts/test-local-supabase-guard.mjs && node scripts/test-g1-f-agent-audit-rls.mjs
```

Couverture : isolation tenant, lecture own, UPDATE/DELETE refusés, anonyme refusé, index/contraintes/privileges.

## EVAL catalogue — exactes

**Aucune nouvelle exact** introduite par G1-F (volontaire).

Exactes antérieures (G1-B/C/D) inchangées.

## EVAL catalogue — partial (G1-F)

| EVAL | Motif partial |
|---|---|
| `EVAL-TOOL-022` | build + append Router ; absents : mission, `idempotency_key`, atomicité externe |
| `EVAL-OBS-001` | none→**partial** : corrélation/tenant persistables ; absents : mission / multi-outils / lecture produit |
| `EVAL-OBS-002` | composition + persist ; pas de retrouvabilité produit complète |
| `EVAL-OBS-003` | redaction event + payload persisté ; pas tous les logs |
| `EVAL-OBS-004` | triggers anti-mutation `agent_audit_events` ; pas scénario acteur agent exact |
| `EVAL-OBS-016` | append-only SQL ; partial vs événement métier générique |
| `EVAL-SEC-015` | redaction event persisté ; pas tous les logs système |

## Absents documentés (pas d’exact)

- `mission_id` / reconstruction mission  
- `idempotency_key` systématique produit par le Router  
- Atomicité externe effet exécuteur ↔ persist audit (compensation / saga)  
- Parcours de lecture UI / multi-outils / provider LLM  
- Crypto/juridique d’immutabilité (garde-fou SQL seulement)

## Résultat Vitest

```
pnpm test:g1-f
Test Files  1 passed (1)
Tests       16 passed (16)

pnpm test:g1-e
Test Files  1 passed (1)
Tests       19 passed (19)

pnpm test:g1-d
Test Files  1 passed (1)
Tests       39 passed (39)

pnpm test:g1-c
Test Files  1 passed (1)
Tests       28 passed (28)
```

## Résultat harness G1-A (après catalogue)

```
PASS=12
FAIL=0
BLOCKED=80
NOT_APPLICABLE=0
```

Confirmé via `pnpm test:g1-a` (2026-07-24T20:56:15Z, PASS=12 FAIL=0) et
`pnpm test:g1-a:strict` (2026-07-24T21:03:23Z, PASS=12 FAIL=0).

RLS local : `node scripts/test-g1-f-agent-audit-rls.mjs` → **10/10 passés**.

(PASS inchangé = 12 exactes antérieures. Partials G1-F restent hors PASS.)

## Hors scope / limites

- Pas de commit / push (lot d’intégration).  
- Pas de démarrage G1-G.  
- Pas de modification `docs/agent/**`, preuves G1-A…E, harness G1-A core, Permission Service G1-C, Tool Registry (sauf nécessité — aucune).  
- Pas d’atomicité externe.

## Rapport brief (12 points)

1. **Fichiers** : migration + persistence + pont Router + tests + catalog + preuve.  
2. **Multitask** : repository/sink/RLS/migration conservés et branchés.  
3. **Migration/policies** : `agent_audit_events`, RLS tenant, service_role INSERT, anti-UPDATE/DELETE.  
4. **Tests unitaires** : 16 persistence + 8 Router G1-F.  
5. **RLS** : script `test:g1-f:rls` (Supabase local).  
6. **Harness** : G1-A PASS=12 inchangé.  
7. **EVAL exact** : aucune nouvelle.  
8. **EVAL partial** : TOOL-022, OBS-001/002/003/004/016, SEC-015.  
9. **Échec sink** : `AUDIT_PERSISTENCE_FAILED` structuré.  
10. **Une tentative** : un `append` après build réussi.  
11. **Pas secret/payload** : schéma + assertions.  
12. **Pas atomicité externe + pas commit**.
