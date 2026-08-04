# SIDIAN — Preuve de lot G1-I (synthèse versionnée)

**Lot :** G1-I — Observability & Security Monitoring déterministe  
**Gate G1 global :** toujours **NOT EXECUTED / non PASS**  
**Date UTC :** 2026-07-24T22:23:12Z  
**SHA testé :** `f7c64ff8146c7d9170e31847c895eb2cb7e49ddf`  
*(SHA = HEAD au moment de la validation Vitest / harness ; working tree non commitée.)*

> Synthèse humaine. Non réécrite automatiquement par le harness.

## Fichiers livrés

### Multitask (modèle + detectors/metrics + tests)

| Fichier | Rôle |
|---|---|
| `src/lib/agent/observability/**` | `createObservabilityService`, event-builder, sinks mémoire/null, alert-candidates |
| `src/lib/agent/observability/detectors/**` | 10 détecteurs purs + `runDetectors` |
| `src/lib/agent/observability/metrics/**` | `deriveMetrics({ event, events? })` |
| `src/lib/agent/observability/*.test.ts` + fixtures | 38 tests unitaires (build / métriques / détecteurs / sink) |

### Intégration Router (ce lot)

| Fichier | Rôle |
|---|---|
| `src/lib/agent/router/types.ts` | `observabilityService?` ; `observability?` / `observability_degraded?` sur résultat |
| `src/lib/agent/router/result-schema.ts` | Schéma strict étendu G1-I |
| `src/lib/agent/router/observability-emit.ts` | Mapping résultat→ObservabilityRecordInput + emit best-effort |
| `src/lib/agent/router/router.ts` | Ordre : pipeline → audit → **obs.record** → return |
| `src/lib/agent/router/router.test.ts` | +4 tests G1-I (chemins issues, audit fail, obs fail, ordre) |
| `src/lib/agent/router/test-fixtures/{harness,observability-service}.ts` | Spy service/sink obs |

### Catalogue / scripts / preuve

| Fichier | Changement |
|---|---|
| `package.json` | `test:g1-i` |
| `scripts/g1/catalog.yaml` | rationale/bindings OBS-* / SEC-015 (kind only) |
| `docs/implementation/SID_GATE_G1I_EVIDENCE.md` | cette preuve |

## Architecture

```
route(request, context.now)
  1..12. pipeline Router (G1-D…H) → résultat final connu
 13. audit.build (+ append si sink) — fail-closed si sink échoue
 14. si observabilityService : record() exactement 1× (best-effort)
 15. return (évent. observability | observability_degraded)
```

### Règles critiques

| Règle | Comportement |
|---|---|
| Max 1 event obs / `route()` | Un seul `record()` après audit |
| Ordre | Audit **puis** observabilité |
| Obs ne décide pas | Jamais permission / executor / audit contourné |
| Best-effort | Échec obs → résultat métier conservé + `observability_degraded` |
| Audit fail-closed | Inchangé (G1-F) — `AUDIT_PERSISTENCE_FAILED` |
| Zéro réseau | Pas OTel/Datadog/Slack/webhook/console implicite |

### Contenu interdit (événements / erreurs)

Arguments complets, output complet, secret, token, clé d’idempotence brute, stack, SQL, PAN, PII inutile.

## Modèle d’événement

`ObservabilityEvent` — `schema_version: "1"`, horloge injectée (`now`), sévérités `info|warning|error|critical`, outcomes alignés Router (`success|blocked|denied|approval_required|validation_error|error|replayed|degraded`).

## Métriques (dérivées, pas d’état global)

`router_requests_total`, `router_success_total`, `router_blocked_total`, `permission_denied_total`, `approval_required_total`, `approval_consumed_total`, `approval_replay_total`, `idempotency_conflict_total`, `idempotency_replay_total`, `executor_error_total`, `audit_persistence_failure_total`, `indeterminate_outcome_total`, `route_duration_ms`.

## Détecteurs (fenêtre + seuils injectés)

| Signal | Seuil défaut | Sévérité |
|---|---|---|
| repeated_permission_denials | 5 | warning |
| repeated_approval_replays | 3 | warning |
| idempotency_conflicts | 3 | error |
| executor_failures | 5 | error |
| audit_persistence_failures | 1 | error |
| approval_consumed_without_execution | 1 | error |
| indeterminate_execution_outcomes | 1 | error |
| invalid_argument_burst | 5 | warning |
| cross_tenant_scope_mismatch | 1 | critical |
| non_callable_tool_attempts | 3 | warning |

Evidence = `event_id` uniquement. `AlertCandidate` locaux — **aucun envoi**.

## Politique d’échec (audit vs obs)

| Couche | Politique |
|---|---|
| Audit G1-F | Fail-closed : échec sink → `AUDIT_PERSISTENCE_FAILED` |
| Observability G1-I | Best-effort : échec sink/service → résultat principal inchangé + `observability_degraded: true` |

## Tests

- Unitaires observability : **38** pass  
- Intégration Router G1-I : **4** pass (succès/deny/approval/replay/conflict/executor ; audit fail documenté ; obs fail conservé ; ordre + sanitization)

Commande : `pnpm test:g1-i`

## Couverture catalogue (honnête)

| EVAL | Kind | Commentaire |
|---|---|---|
| OBS-001/002/003/004/016 | **partial** | Pas exact (mission/trace/provider/dashboard/alerte envoyée) |
| SEC-015 | **partial** | Redaction audit+obs agent ; pas tous les logs |
| OBS-005→011, OBS-017 | **none** | Alertes/métriques LLM/SLO/dashboard hors preuve G1 |
| OBS-012→015 | **none** | Hors scope G1-I |
| **Aucune EVAL exact** | — | Pas de dashboard / alerte envoyée / SIEM |

## Non-objectifs

OpenTelemetry réel, Datadog, Sentry, Prometheus distant, Grafana, PagerDuty, Slack, email, webhook, queue, Kafka, cron, rétention, dashboard, UI, ML, SIEM, réponse auto incident, G1-J.

## État Gate G1

Gate G1 global : **NOT EXECUTED / non PASS** (lots A–I versionnés localement, working tree non commitée).
