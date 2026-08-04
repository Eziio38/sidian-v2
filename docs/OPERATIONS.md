# Runbook d'exploitation — Sidian V2

Ce document décrit quoi faire quand quelque chose casse en production. Chaque
affirmation renvoie au code ou à la migration qui la produit ; si une commande
ci-dessous ne correspond plus au code, c'est le document qui a tort.

Portée : cron, webhooks, JWT d'environnement, budget LLM, outbox. Il ne
remplace ni `docs/SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md` (le pourquoi des
machines d'état) ni `docs/operations/` (checklists de mise en service).

---

## 0. Prérequis et conventions

| Élément | Valeur | Source |
| --- | --- | --- |
| Auth cron et diagnostic santé | `Authorization: Bearer $CRON_SECRET` | `src/lib/runtime/cron/auth.ts` |
| Longueur minimale de `CRON_SECRET` | 16 caractères (32 recommandés) | `MIN_CRON_SECRET_LENGTH`, même fichier |
| Secret en query string | **toujours refusé** (401) | `FORBIDDEN_QUERY_KEYS`, même fichier |
| Planification | scanners `20 5 * * *`, drains `*/5 * * * *` | `vercel.json` |

`$APP` désigne l'origine du déploiement (`https://…`). `$CRON_SECRET` n'est
jamais écrit dans un ticket, un log ou une capture d'écran.

### Première commande de tout incident : la sonde de santé

La réponse publique est volontairement minimale — elle ne dit ni
l'environnement ni l'état de la base :

```bash
curl -s "$APP/api/health"
# {"status":"ok","app":"sidian-v2"}
```

Le diagnostic complet est derrière le même bearer que les crons
(`src/app/api/health/route.ts`) :

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" "$APP/api/health" | jq
```

Il rend, et **uniquement** cela — aucune valeur de clé n'est jamais exposée :

```jsonc
{
  "status": "ok",
  "app": "sidian-v2",
  "environment": "production",
  "database": "connected",
  "migration_head": "20260803180000",   // public.schema_migration_head()
  "llm": {
    "enabled": true,
    "mode": "live",                      // disabled | stub | live | misconfigured
    "provider": "anthropic",
    "model": "claude-haiku-4-5",
    "api_key_present": true,             // booléen de présence, pas la clé
    "fallback_provider": null,
    "fallback_api_key_present": false,
    "streaming": false
  },
  "llm_budget": {
    "backend": "postgres",               // memory | postgres
    "durable": true,
    "explicitly_configured": true
  },
  "error_reporting": {
    "backend": "console",                // off | console
    "provider": "console",
    "configured": true
  }
}
```

Trois lectures immédiates :

- `database: "unavailable"` → l'incident est en amont de l'application.
- `llm_budget.durable: false` en production → **le plafond LLM ne s'applique
  pas** (voir §4).
- `error_reporting.configured: false` → les erreurs avalées ne sont remontées
  nulle part (voir §6).

Le HTTP est `200` si la sonde est opérationnelle, `503` sinon
(`isHealthOperational` : base connectée, ou base non configurée **et**
environnement local).

---

## 1. Un cron a échoué

Deux crons existent (`vercel.json`) :

| Route | Rôle | Code |
| --- | --- | --- |
| `/api/cron/scanners` | scans quotidiens, enfilement de `runtime_job` | `src/lib/runtime/cron/run-scanners.ts` |
| `/api/cron/drains` | vidage des outbox + jobs paiement + jobs runtime | `src/lib/runtime/cron/run-drains.ts` |

### Lire le code de retour

Le handler partagé (`src/app/api/cron/_lib/handler.ts`) ne rend jamais de
secret et distingue trois cas :

| HTTP | Corps | Signification |
| --- | --- | --- |
| `401` | `{"error":"unauthorized"}` | bearer absent, faux, ou secret passé en query |
| `503` | `{"error":"cron_not_configured"}` | `CRON_SECRET` absent ou < 16 caractères — **fail-closed voulu** |
| `500` | `{"error":"cron_execution_failed"}` | l'exécution a levé ; `requestId` dans le corps |
| `200` | `{"ok":false,…}` | exécution partielle (deadline atteinte), pas un échec |

### Relancer à la main

`POST` est accepté et idempotent (mêmes garde-fous d'idempotence que le
déclenchement automatique) :

```bash
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "$APP/api/cron/drains" | jq

curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "$APP/api/cron/scanners" | jq
```

Chaque exécution est bornée par un budget temps (`DEFAULT_CRON_BUDGET_MS`,
`src/lib/runtime/cron/deadline.ts`) : sur un retard important, plusieurs
relances successives sont normales et attendues — ce n'est pas une boucle
d'échec.

### Corréler avec les logs

Le corps contient `requestId`. Les journaux serveur sont structurés
(`src/lib/observability/server-logger.ts`) : filtrer sur ce `requestId`, sur
`event: "scanner_started"` / `"scanner_completed"`, et sur `reasonCode`.

### Si l'échec est en `401` alors que rien n'a changé

`CRON_SECRET` a probablement été rogné (espaces) ou raccourci. Vérifier la
longueur, sans afficher la valeur :

```bash
# Sur la machine d'exploitation, pas dans un log partagé
printf '%s' "$CRON_SECRET" | wc -c
```

---

## 2. Un webhook cale

Deux endpoints reçoivent des webhooks : `/api/stripe/webhook` et
`/api/whatsapp/webhook`.

### Constat

Un webhook « qui cale » se voit à ses effets, pas à son endpoint : les
événements arrivent mais l'état applicatif n'avance plus. Points de contrôle,
par ordre :

1. **La signature.** Stripe utilise deux endpoints distincts avec deux secrets
   distincts (`STRIPE_CONNECT_WEBHOOK_SECRET` pour l'encaissement client,
   `STRIPE_BILLING_WEBHOOK_SECRET` pour l'abonnement Sidian). Les intervertir
   fait échouer la vérification de signature de façon systématique et
   silencieuse côté Stripe (4xx répétés dans le dashboard Stripe). Voir le bloc
   « ABONNEMENT SIDIAN » de `.env.example` : l'application refuse de démarrer la
   facturation si les deux secrets sont identiques.
2. **Le journal des événements entrants.** Pour WhatsApp, la table
   `public.communication_webhook_events` porte un statut
   (`communication_webhook_processing_status` :
   `received | processed | ignored | failed`). Des lignes bloquées en
   `received` ou `failed` indiquent un traitement en échec, pas une réception
   en échec.
3. **La file de sortie.** Si les événements sont `processed` mais que rien ne
   part, le problème est dans l'outbox (§5), pas dans le webhook.

```sql
-- Répartition des événements webhook des dernières 24 h
select processing_status, count(*)
from public.communication_webhook_events
where created_at > now() - interval '24 hours'
group by 1 order by 2 desc;
```

### Rejouer

Ne jamais rejouer en fabriquant un appel : la signature ne serait pas valide et
un rejeu forgé n'est pas un événement réel. Le rejeu se fait depuis la console
du fournisseur (Stripe : « Resend » sur l'événement ; Meta : redéclenchement de
la notification). L'idempotence côté application est assurée par les clés
d'idempotence des tables concernées : un rejeu ne double aucun effet.

---

## 3. Un JWT a expiré

Trois JWT de longue durée existent, tous **vérifiés au build** par
`next.config.ts` (`validateDeploymentReadiness`, `assertStripeBuildReadiness`) :

| Variable | Rôle | Claims vérifiés |
| --- | --- | --- |
| `SUPABASE_ENVIRONMENT_ATTESTATION_JWT` | prouve que l'application parle bien au projet Supabase déclaré | `role=sidian_environment_attestor`, `sidian_environment`, `sidian_project_ref`, `exp` |
| `SUPABASE_STRIPE_BINDING_WRITER_JWT` | autorise l'écriture des liaisons client Stripe | `role=stripe_customer_binding_writer`, `sidian_environment`, `exp` |
| `SUPABASE_SERVICE_ROLE_KEY` | accès service_role | (clé projet, pas de rotation planifiée) |

### Symptômes

- **Au build** : le déploiement Vercel échoue avec
  « Attestation Supabase de déploiement manquante ou incohérente. » ou
  « Readiness Stripe incomplète ou incohérente pour ce déploiement. »
  C'est le comportement voulu : on refuse de déployer plutôt que de servir une
  application dont on ne peut pas prouver la cible.
- **À l'exécution** : toute opération passant par
  `assertSupabaseDeploymentEnvironment()`
  (`src/lib/supabase/environment-attestation.ts`) échoue —
  `environment_attestation_failed` ou `service_role_attestation_failed`. La
  sonde de santé remonte alors `database: "unavailable"`, car
  `checkDatabaseHealth` appelle l'attestation hors local.

### Vérifier l'expiration sans exposer le jeton

```bash
# N'affiche que la date d'expiration, jamais le jeton ni la signature.
node -e 'const p=process.env.SUPABASE_ENVIRONMENT_ATTESTATION_JWT.split(".")[1];
const c=JSON.parse(Buffer.from(p,"base64url").toString());
console.log("exp:", new Date(c.exp*1000).toISOString(), "role:", c.role);'
```

### Remédiation

1. Régénérer le JWT depuis le projet Supabase ciblé, avec exactement les mêmes
   claims (`role`, `sidian_environment`, `sidian_project_ref`) et un `exp`
   futur. Un claim qui diffère est refusé de la même manière qu'une expiration.
2. Mettre à jour la variable d'environnement sur la cible Vercel concernée.
3. **Redéployer** : la validation est faite au build, une simple mise à jour de
   variable ne suffit pas.
4. Confirmer :

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" "$APP/api/health" \
  | jq '.database, .migration_head'
```

---

## 4. Le plafond LLM est atteint

### Ce que les plafonds signifient

Trois plafonds, tous configurés par variables d'environnement et validés par
`src/lib/llm/env.ts` :

| Variable | Défaut | Fenêtre |
| --- | --- | --- |
| `SIDIAN_LLM_BUDGET_MAX_REQUESTS_PER_MINUTE` | 30 | minute, global |
| `SIDIAN_LLM_BUDGET_MAX_TOKENS_PER_MINUTE` | 50 000 | minute, global |
| `SIDIAN_LLM_BUDGET_MAX_REQUESTS_PER_SCOPE_PER_HOUR` | 200 | heure, par scope |

Le refus est **fail-closed** : `LlmError("LLM_BUDGET_EXCEEDED")` avec l'un des
motifs `llm_rpm_exceeded`, `llm_tpm_exceeded`, `llm_scope_hourly_exceeded`
(`src/lib/llm/budget.ts`).

### D'abord : vérifier que le plafond est réellement partagé

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" "$APP/api/health" | jq '.llm_budget'
```

- `{"backend":"memory","durable":false}` → **les compteurs sont
  process-locaux**. Sur une plateforme serverless, chaque instance a les siens :
  le plafond configuré est multiplié par le nombre d'instances vivantes, facteur
  inconnu. Ce mode est destiné au local et aux tests.
- `{"backend":"postgres","durable":true}` → compteurs partagés dans
  `public.llm_budget_counter`, incrément et vérification atomiques
  (migration `20260803180000_llm_budget_counters.sql`).

Pour activer le mode durable :

```
SIDIAN_LLM_BUDGET_BACKEND=postgres
```

Toute autre valeur (ou l'absence de valeur) sélectionne `memory` — jamais de
dépendance base imposée silencieusement (`resolveLlmBudgetBackend`).

### Diagnostiquer un plafond atteint (backend postgres)

Les compteurs sont lisibles en `service_role` (lecture et suppression
uniquement : l'écriture passe obligatoirement par les fonctions).

```sql
-- Fenêtre minute globale en cours
select request_count, token_count, window_start
from public.llm_budget_counter
where scope_fingerprint = 'global'
  and window_kind = 'minute'
order by window_start desc
limit 5;

-- Scopes les plus consommateurs sur l'heure en cours
select scope_fingerprint, request_count
from public.llm_budget_counter
where window_kind = 'hour'
  and window_start = date_trunc('hour', now())
order by request_count desc
limit 20;
```

`scope_fingerprint` est une empreinte SHA-256 : il n'existe **aucun** moyen de
remonter au prestataire depuis la base. C'est voulu — une table de compteurs ne
doit pas devenir une table de données personnelles. Pour identifier un scope,
recalculer l'empreinte à partir du scope suspecté :

```bash
node -e 'const{createHash}=require("node:crypto");
console.log(createHash("sha256").update(process.argv[1],"utf8").digest("hex"))' "prestataire:<id>"
```

### Actions

| Situation | Action |
| --- | --- |
| Pic légitime et temporaire | Ne rien faire : les fenêtres se vident seules (minute / heure). |
| Un seul scope sature l'heure | Le plafond par scope joue son rôle. Vérifier s'il s'agit d'une boucle applicative avant de relever quoi que ce soit. |
| Plafond global trop bas pour l'usage réel | Relever `SIDIAN_LLM_BUDGET_MAX_*` et redéployer. Ces valeurs sont bornées par `src/lib/llm/env.ts` (max 1 000 rpm, 2 000 000 tpm, 10 000 requêtes/scope/heure). |
| Urgence : débloquer immédiatement une fenêtre | Supprimer la ligne concernée (elle sera recréée au prochain appel). |

```sql
-- Débloquer la fenêtre minute globale en cours. À n'utiliser qu'en incident :
-- cela lève le plafond pour la minute restante.
delete from public.llm_budget_counter
where scope_fingerprint = 'global'
  and window_kind = 'minute'
  and window_start = date_trunc('minute', now());
```

### Erreur `LLM_INTERNAL / llm_budget_backend_unavailable`

Ce n'est **pas** un plafond atteint : c'est la base de compteurs injoignable.
Le runtime refuse alors la requête plutôt que de laisser passer un appel non
compté. Traiter comme un incident base (§0), pas comme un problème de quota.

### Purge des fenêtres expirées

Les fenêtres portent `expires_at` (minute + 10 min, heure + 3 h). Purge par
lots, à boucler jusqu'à ce qu'elle rende `0` :

```sql
select public.purge_expired_llm_budget_counters(1000);
```

---

## 5. L'outbox ne se vide plus

### Ce qui draine quoi

`/api/cron/drains` (toutes les 5 minutes) exécute, dans le même passage
(`src/lib/runtime/cron/run-drains.ts`) :

- les drains outbox actifs : WhatsApp, e-mail, audit Stripe Connect,
  notifications (`src/lib/runtime/drains/from-env.ts`) ;
- les jobs de paiement (`payment_execution_job`) ;
- les jobs runtime (`runtime_job`) ;
- la purge des téléversements de documents abandonnés.

Chaque lot est borné (`MAX_DRAIN_BATCH = 50`) et le passage est borné en temps.
Un backlog ne se résorbe donc pas en un seul appel.

### Diagnostic

```sql
-- E-mails : où sont-ils bloqués ?
select status, count(*), min(created_at) as plus_ancien
from public.email_outbox
group by 1 order by 2 desc;
```

Statuts possibles (`public.email_delivery_status`) :
`queued | processing | sent | failed | dead_letter`.

```sql
-- Messages sortants (WhatsApp) : statut de livraison
select status, count(*)
from public.communication_messages
group by 1 order by 2 desc;

-- Jobs runtime en attente ou en échec
select status, count(*), min(available_at) as prochain
from public.runtime_job
group by 1 order by 2 desc;
```

### Lecture des symptômes

| Observation | Cause probable | Action |
| --- | --- | --- |
| Tout est en `queued`, rien ne bouge depuis > 15 min | le cron ne s'exécute plus | §1 : relancer `/api/cron/drains` à la main et lire le code de retour |
| Beaucoup de `processing` bloqués | des baux (`lease`) n'ont pas été relâchés | attendre l'expiration du bail — les fonctions `claim_*` ne reprennent que des baux expirés ; ne jamais forcer un statut à la main |
| `failed` qui remonte, `attempt_count` qui croît | le fournisseur refuse | vérifier la configuration du fournisseur avant tout rejeu |
| `dead_letter` | `max_attempts` (4 par défaut) épuisé | **décision humaine** : ces messages ne seront pas réessayés automatiquement |
| Aucun drain actif dans la réponse du cron | le fournisseur n'est pas configuré | c'est un état honnête, pas une panne : `SIDIAN_EMAIL_PROVIDER_ENABLED` / `SIDIAN_WHATSAPP_PROVIDER_ENABLED` sont à `false` |

Le dernier point mérite d'être vérifié en premier sur un environnement neuf :
sans fournisseur configuré, l'outbox se remplit et ne se vide jamais — et c'est
le comportement attendu, aucun envoi n'est simulé.

### Relance

```bash
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" "$APP/api/cron/drains" | jq
```

La réponse détaille, par drain : `claimed`, `delivered`, `retryable`,
`deadLetter`, `skipped`, `leaseLost`, `errors`, `durationMs`. Enchaîner les
appels tant que `claimed > 0` pour résorber un backlog.

### Ne pas faire

- Ne pas repasser des lignes `dead_letter` en `queued` en masse : elles ont
  échoué 4 fois, la cause n'a probablement pas disparu.
- Ne pas écrire directement dans `runtime_job` / `email_outbox` : les
  transitions passent par les fonctions `claim_*` / `complete_*` / `fail_*`,
  seules à gérer le fencing par bail.

---

## 6. Aucune erreur ne remonte

`src/lib/observability/error-reporter.ts` fournit une interface indépendante de
tout fournisseur (`captureException` / `captureMessage`, avec `requestId`,
empreinte de tenant et sévérité). Tant que rien n'est configuré,
l'implémentation active est un **no-op explicite** : elle le déclare, et la
sonde de santé le rapporte.

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" "$APP/api/health" | jq '.error_reporting'
# {"backend":"off","provider":"noop","configured":false}
```

Pour router les incidents vers le journal serveur structuré (déjà collecté par
l'hébergeur, aucune dépendance ajoutée) :

```
SIDIAN_ERROR_REPORTING=console
```

Les enregistrements produits ont `event: "error_report"` et sont expurgés :
jetons, secrets, e-mails, téléphones, IBAN et numéros de carte sont remplacés,
la stack et la `cause` ne sont jamais émises, le message est tronqué à 300
caractères. Le tenant n'apparaît que sous forme d'empreinte tronquée
(`hashTenantId`).

Brancher un collecteur tiers plus tard consiste à implémenter `ErrorReporter`
et à l'enregistrer via `setErrorReporter` — aucun SDK fournisseur n'est
nécessaire dans le dépôt.

---

## 7. Intégration continue

`.github/workflows/ci.yml`, sur toute poussée et toute pull request. Aucun
secret GitHub n'est requis.

| Job | Étapes |
| --- | --- |
| `quality` | `pnpm install --frozen-lockfile`, `tsc --noEmit`, `lint`, `design-system:check`, `vitest run`, `build`, `types:check` |
| `sql` | démarre Supabase via le CLI de `devDependencies`, puis `test:local-guard`, `test:sql`, `scripts/test-llm-budget-counters.mjs` |

La version de Node vient de `.nvmrc` (24), compatible avec
`engines.node >= 22.6`.

Les valeurs d'environnement injectées dans le workflow sont soit des
placeholders explicites, soit les clés de démonstration publiques du CLI
Supabase — les mêmes que celles déjà versionnées dans
`scripts/lib/assert-local-supabase.mjs`, et que les harnais SQL refusent
d'utiliser contre autre chose qu'une cible loopback.

### Reproduire la CI en local

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm lint
pnpm design-system:check
pnpm exec vitest run
pnpm build
pnpm types:check

node_modules/.bin/supabase start
pnpm test:sql
node scripts/test-llm-budget-counters.mjs
```

---

## 8. Variables d'environnement d'exploitation

Ajoutées par ce lot, à reporter dans `.env.example` :

| Variable | Valeurs | Défaut | Effet |
| --- | --- | --- | --- |
| `SIDIAN_LLM_BUDGET_BACKEND` | `memory` \| `postgres` | `memory` | `postgres` = plafonds LLM réellement partagés entre instances. **À positionner en staging et en production.** |
| `SIDIAN_ERROR_REPORTING` | `off` \| `console` | `off` | `console` = les erreurs avalées sont journalisées (structurées et expurgées) au lieu de disparaître. |

Les autres variables d'exploitation (`CRON_SECRET`, fournisseurs, Stripe,
attestations) sont documentées dans `.env.example`, qui reste la référence.
