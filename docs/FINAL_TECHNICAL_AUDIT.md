# SIDIAN V2 — AUDIT TECHNIQUE FINAL

**Date :** 3 août 2026
**Méthode :** 11 audits de domaine indépendants, menés en lecture seule sur
l'intégralité du dépôt (routes, composants, server actions, API, services,
workers, migrations, policies RLS, variables d'environnement, tests).
Chaque constat cite un fichier et ce qui y a été réellement lu.

> Ce document est un état des lieux, pas une liste de souhaits. Les constats
> marqués P0 empêchent un lancement ; les P1 sont indispensables au MVP.

## Le constat structurant

Trois audits indépendants (workers, canaux de communication, Stripe)
convergent sur le même problème, et c'est le plus important du dépôt :

> **La chaîne d'automatisation était coupée en son milieu.**
>
> *Mise à jour du 3 août 2026 : le maillon manquant a été construit — voir
> « Consommateur `runtime_job` » plus bas. Le constat ci-dessous décrit l'état
> initial, qui reste vrai pour les cinq types de jobs encore non câblés.*

Les six scanners (prévention, échéance, silence, clôture, prélèvement
automatique, relances) s'exécutent, calculent correctement leurs candidats et
écrivent des lignes dans `public.runtime_job`. **Aucun code TypeScript ne lit
jamais cette table.** La RPC `claim_runtime_jobs` existe en migration mais n'a
aucun appelant ; il n'existe ni `complete_runtime_job` ni `fail_runtime_job` ;
`RuntimeJobRepository` n'expose que `enqueue()`. Le cron `/api/cron/drains`
draine WhatsApp, l'email, l'audit Connect et `payment_execution_job` — jamais
`runtime_job`.

Conséquence directe : aucune notice de prévention n'est envoyée, aucun lien
n'est transmis à l'échéance, aucune escalade de silence, aucune clôture de
dossier, aucun prélèvement automatique. En parallèle, `email_outbox` n'a
**aucun producteur** en code de production, et le seul trafic WhatsApp sortant
est l'accusé de réception réactif du webhook entrant.

Autrement dit : les bibliothèques sont écrites, testées et de bonne qualité ;
le produit qu'elles composent ne produit aujourd'hui aucun effet métier
automatique. C'est le chantier n°1.

Le second constat structurant est commercial : **l'abonnement Sidian n'est pas
encaissable**. Il n'existe aucun code Stripe Billing, aucun produit, aucun
prix, aucun portail, et `prestataire.subscription_status` n'a strictement
aucun chemin d'écriture — il reste `trialing` indéfiniment, état auquel le
résolveur d'accès accorde tous les droits.

## Corrections déjà appliquées

Ces points sont clos et couverts par des tests :

| Correctif | Fichier | Vérification |
|---|---|---|
| **Fuite inter-tenant** : le cache d'idempotence du runtime conversationnel était indexé sur une `idempotency_key` fournie par l'appelant, sans le tenant. Deux comptes utilisant la même clé recevaient le tour de l'autre. | `src/lib/agent/conversational-runtime/service.ts` | Test de régression vérifié en échec sur le code vulnérable |
| Système de thèmes Clair / Sombre / Automatique, défaut Clair | `src/design-system/tokens.css`, `src/app/globals.css`, `src/lib/theme/**`, `src/components/theme/**` | 20 tests |
| Page Paiements : le badge de statut testait cinq valeurs d'enum inexistantes — tout affichait « Suivi » | `src/app/app/paiements/page.tsx` | Typé sur `creance_etat` |
| Page Paiements : le filtre « En cours » incluait les créances réglées, annulées et irrécouvrables | `src/app/app/paiements/page.tsx` | — |
| Page 404 manquante sous `/app` (le 404 anglais de Next s'affichait) | `src/app/app/not-found.tsx` | — |
| Page Approbations inatteignable | `src/app/app/activite/page.tsx` | Exposée contextuellement, quand une décision attend |
| Test instable sous charge (`conversational-workspace`) | `vitest.config.ts` | — |
| **Contraste** : `bg-white` codé en dur sur 20 emplacements `/app` — texte à 1,08:1 en sombre | 10 fichiers `src/app/app/**`, `src/components/app/**` | Vérifié par capture |
| **Contraste** : statuts sous le seuil AA en clair (succès 3,57:1, alerte 3,05:1, danger 4,44:1) | `src/app/globals.css` | 5,20 / 6,79 / 6,05:1 |
| **Contraste** : `--text-tertiary` à 2,60:1 sur blanc | `src/app/globals.css` | 4,83:1 |
| Mode `stub` du LLM autorisé en production — réponses déterministes présentées comme l'IA | `src/lib/llm/env.ts` | 4 tests |
| Variables d'environnement non documentées et variables mortes | `.env.example` | — |

### Consommateur `runtime_job`

Le maillon manquant entre les scanners et les effets métier est construit.

**Ajouté en base** (`20260803130000_runtime_job_completion.sql`) :
`complete_runtime_job` et `fail_runtime_job` — les deux contreparties qui
manquaient à `claim_runtime_jobs` — avec fencing par lease, backoff
exponentiel borné (60 s → 1 h) et échec terminal au plafond de tentatives ;
`runtime_close_dossier`, effet métier idempotent et tracé dans `audit_log` ;
`runtime_job_backlog`, pour mesurer ce qui s'accumule.

**Ajouté en TypeScript** : `claim` / `complete` / `fail` / `closeDossier` /
`backlog` sur `RuntimeJobRepository` (Supabase et mémoire), et un dispatcher
(`src/lib/runtime/jobs/dispatcher.ts`) raccordé au cron `/api/cron/drains`.

Deux règles de conception, qui répondent directement à l'exigence « ne jamais
simuler une capacité indisponible » :

1. **On ne claime que ce que l'on sait traiter.** Un type de job sans handler
   n'est jamais claimé : il reste `pending`, ne consomme aucune tentative et ne
   finit jamais en échec terminal. Un câblage manquant est un fait observable,
   pas une perte silencieuse.
2. **Les types non câblés sont déclarés explicitement**, avec leur raison, dans
   `UNWIRED_JOB_KINDS`. Ils remontent dans la réponse du cron (`runtimeJobs.unwired`)
   et sont journalisés en `warn` avec leur profondeur de file.

| Type de job | État | Raison |
|---|---|---|
| `closure_close_dossier` | **câblé** | Effet interne ; règle de transition déjà fixée en SQL et en TS |
| `prevention_notice` | non câblé | Cadence et copie des relances non arrêtées ; canal email sans producteur |
| `due_send_link` | non câblé | idem |
| `silence_escalate` | non câblé | Règles d'escalade non arrêtées |
| `retry_failed_notify` | non câblé | idem |
| `autopay_intent` | non câblé | Plafond de prélèvement bloqué (`AUTO_DEBIT_REGLE_CEILING_PRODUCT_READY=false`) |

14 tests couvrent : acquittement, idempotence du rejeu, absence de double
traitement, non-claim des types sans handler, backoff croissant vérifié
(60 s puis 120 s), échec terminal au plafond, reprise après expiration de
lease, perte de lease pendant le traitement, respect de la deadline du cron
et bornage du lot.

Les cinq types restants ne demandent plus de travail de plomberie : il leur
manque une décision produit (§4.2 et §7.3 de `USER_ACTIONS_REQUIRED.md`) puis
un handler, à enregistrer dans `DEFAULT_RUNTIME_JOB_HANDLERS`.

### Validation contre une base réelle

Les 52 migrations ont été appliquées sur une base Postgres locale, et les
suites SQL exécutées. Ce n'est plus une projection : le SQL tourne.

**Ce que l'application a révélé.** La régénération de
`src/types/database.generated.ts` a fait apparaître **13 erreurs TypeScript**
jusque-là masquées par un fichier de types partiellement retouché à la main.
Toutes de même nature : le code passe `null` à des paramètres de RPC que le
générateur Supabase déclare non-nullables. Diagnostic : PostgreSQL n'a pas de
notion de paramètre `NOT NULL` — une fonction `p_payment_intent_id text`
accepte NULL, et le SQL traite explicitement ce cas (`coalesce`, `is null`).
Le code était juste, le type imprécis. Corrigé à la frontière d'appel via
`src/lib/stripe/shared/rpc-args.ts`, sans toucher au comportement.

**Deux harnais d'isolation ajoutés**, exécutés contre la base :

| Harnais | Couverture | Résultat |
|---|---|---|
| `pnpm test:document-storage` | RLS `document`, policies `storage.objects`, allowlist MIME et plafond de taille appliqués en SQL, traversée de chemin, purge réservée à `service_role`, bucket privé, exclusion d'`anon` | 23/23 |
| `pnpm test:runtime-jobs` | fencing par lease, backoff mesuré (60 s puis 120 s), échec terminal, relâchement sans consommation de tentative, plafond de tentatives, clôture idempotente, audit unique, backlog | 27/27 |

La préférence d'apparence est couverte par `pnpm test:user-data-isolation` :
isolation entre comptes, refus de l'écriture directe via PostgREST, refus d'une
valeur hors énumération.

`pnpm test:sql` enchaîne désormais **26 harnais**, tous verts.

### Limite restante

**Le stockage documentaire n'a aucun consommateur.** La migration, les six RPC
et `src/lib/documents/**` sont complets et désormais éprouvés contre la base,
mais rien dans l'application ne les appelle : `grep -rn "lib/documents" src/`
ne renvoie rien hors du répertoire. Le composer continue de traiter les pièces
jointes en mémoire (`URL.createObjectURL`), et elles restent perdues au
rechargement. C'était un choix de périmètre — livrer la couche sans toucher à
la page Conversation, gelée. Deux points à traiter avant de câbler :
`purge_abandoned_document_uploads` n'a pas d'appelant applicatif (les lignes
`pending_upload` s'accumuleraient), et `classifyAttachmentVisualType` accepte
archives et audio que `DOCUMENT_ALLOWED_MIME_TYPES` refuse — l'UI accepterait
des fichiers que le backend rejetterait.


### Performance — mesurée, et sans gain à annoncer

Deux pistes ont été testées en A/B sur un build de production, et **aucune n'a
produit d'effet mesurable** :

| Piste | Avant | Après |
|---|---|---|
| `optimizePackageImports` sur `lucide-react` | 2272 Ko de JS client | 2272 Ko |
| Retrait de la graisse de police 800, jamais consommée | 2 fichiers / 48 Ko | 2 fichiers / 48 Ko |

Next 16 optimise déjà ce paquet, et `next/font` sous-ensemble puis fusionne les
graisses. La configuration `optimizePackageImports` a donc été **retirée** :
une option qui ne fait rien est du bruit. Le retrait de la graisse 800 est
conservé comme nettoyage — le token `--font-weight-extrabold` n'était consommé
nulle part — mais ce n'est pas un gain de performance.

**Ce qui a été constaté sans être corrigé :** 2,2 Mo de JS client, dont un
chunk de 443 Ko ; `conversational-workspace.tsx` fait 4 354 lignes et est un
composant client. Le découpage de ce composant est le seul levier sérieux, et
il touche la page Conversation gelée — à traiter comme un chantier à part.

**Points sains vérifiés :** `pdfjs-dist` (34 Mo) est déjà en import dynamique ;
les chargements de données sont parallélisés (`Promise.all`), aucun N+1.

**Jamais mesuré :** Lighthouse, Core Web Vitals terrain, `EXPLAIN` sous volume
réel. Un audit performance reste entier.

### Scripts ajoutés

- `pnpm doctor` — état de configuration, sans jamais afficher un secret.
- `pnpm validate:release` — lint, TypeScript, design system, tests, build,
  `git diff --check`. Un contrôle qui ne peut pas s'exécuter est rapporté
  `NON CONFIGURÉ`, jamais `ÉCHEC`.
- `pnpm test:sql` — agrège les 24 suites SQL, RLS et isolation qui exigent une
  base Supabase locale.

## Portée non couverte par cet audit

Deux domaines n'ont pas rendu leur rapport dans cette passe et restent à
auditer : **accessibilité / responsive** et **données de démonstration,
code mort et couverture de tests**. Ils sont listés comme travail restant.

## Synthèse chiffrée

| Priorité | Nombre |
|---|---:|
| P0 — bloquant lancement | 22 |
| P1 — indispensable au MVP | 110 |
| P2 — après lancement | 113 |
| Dépend d’un secret ou d’un compte externe | 9 |
| Dépend d’une décision produit humaine | 16 |
| **Total** | **270** |

## Constats par domaine

| Domaine | P0 | P1 | P2 | Secret | Décision |
|---|---:|---:|---:|---:|---:|
| Configuration, environment variables, validation, scripts, observability | 5 | 14 | 7 | 1 | 1 |
| Communication channels — Email | 4 | 9 | 10 | 2 | 2 |
| Stripe integration and Sidian subscription plans | 4 | 7 | 13 | 2 | 2 |
| Authenticated application pages | 3 | 11 | 13 | 0 | 2 |
| Workers, crons, outbox, jobs | 3 | 11 | 7 | 1 | 2 |
| AI runtime, LLM providers and agent tools | 1 | 11 | 9 | 1 | 1 |
| Authentication and onboarding | 1 | 12 | 14 | 2 | 0 |
| Documents, attachments and file storage | 1 | 11 | 8 | 0 | 1 |
| Theming | 0 | 13 | 7 | 0 | 3 |
| Security, RLS, multi-tenant isolation | 0 | 6 | 14 | 0 | 0 |
| Conversation / Assistant page — non-regression baseline | 0 | 5 | 11 | 0 | 2 |


---

# P0 — bloquant lancement


## AI runtime, LLM providers and agent tools

### Cross-tenant leak: conversational runtime cache keyed on a caller-supplied idempotency_key with no tenant in the key

- **Fichier :** `src/lib/agent/conversational-runtime/service.ts:32`
- **Constat :** `function turnFingerprint(input) { const key = input.idempotency_key ?? [input.tenant_id, input.draft_id ?? "", input.conversation_id ?? "", input.user_message, input.reference_now].join("|"); return createHash("sha256").update(key,"utf8").digest("hex"); }` — when `idempotency_key` is present the tenant_id is dropped entirely. The cache is a plain `const cache = new Map<string, CacheEntry>()` (line 55) created once inside `createConversationalRuntimeService`, which is instantiated once per process by `buildAgentHttpToolRouter` and memoised in `cachedRouterPromise` (src/lib/agent/server/auth/create-router.ts:105-115), so it is shared by every tenant. `handleTurn` returns `{ ...cached.result, replay: true }` (line 87) — i.e. another tenant's `draft.draft_id`, `recap.client_name`, `recap.client_email`, `recap.expected_amount_minor`, `recap.due_date`. The argument is attacker-controlled: `protectionDraftConverseInputSchema` accepts `idempotency_key: z.string().min(1).max(128).optional()` (src/lib/agent/tools/schemas/protection-draft.ts:185) and the executor forwards it verbatim (src/lib/agent/conversational-runtime/executors.ts:67 `idempotency_key: args.idempotency_key`). Note this is NOT the envelope idempotency key: the UI sends that one at envelope level (conversational-workspace.tsx:2134), which the router does scope by tenant.
- **Action :** Always include `input.tenant_id` in the fingerprint, e.g. `createHash("sha256").update([input.tenant_id, input.idempotency_key ?? [...].join("|")].join("::"))`. Additionally assert on cache hit that `cached.result.draft.tenant_id === input.tenant_id` before returning, and add a regression test in `conversational-runtime/security.test.ts` that two tenants sending the same `idempotency_key` get isolated results.


## Authenticated application pages

### La page Approbations n'est atteignable par aucun lien vivant — les décisions humaines sont invisibles

- **Fichier :** `src/components/app/app-nav-config.ts:14`
- **Constat :** APP_NAV ne contient que 5 entrées : aujourdhui (/app/assistant), protections (/app/paiements-a-recevoir), paiements (/app/paiements), clients (/app/clients), activite (/app/activite). Aucune entrée /app/approbations. Un grep sur tout src ne trouve « approbations » que dans revalidatePath (payment-reconciliation.ts:94, approvals.ts:46), dans app/app/approbations/page.tsx lui-même, et dans src/components/app/dashboard-actions.tsx:73 — or DashboardActions n'est importé que par dashboard-overview.tsx, qui n'est importé par aucune page (grep DashboardOverview → seulement dashboard-overview.tsx et son test). La sidebar (app-sidebar.tsx) n'expose que /app/parametres. L'assistant n'en parle pas non plus (grep « approval|approbation » dans src/components/assistant/ → 0 résultat).
- **Action :** Ajouter une entrée de navigation « Approbations » dans APP_NAV (ou un badge de compteur d'approbations en attente dans app-sidebar.tsx), et surfacer le nombre de approval_request.status = 'pending' dans l'assistant. Sans cela, la garantie AGENTS.md « Toute action sensible … peut nécessiter une approval_request » est inopérante côté produit.

### Le badge de statut de la page Paiements teste des valeurs d'enum qui n'existent pas

- **Fichier :** `src/app/app/paiements/page.tsx:38`
- **Constat :** statusLabel(etat) switch sur "BROUILLON", "ACTIF", "EN_COURS", "PAYE", "TERMINE", "EN_RETARD", default "Suivi". L'enum réel Database["public"]["Enums"]["creance_etat"] (src/types/database.generated.ts:3710) est : BROUILLON | OUVERTE | PARTIELLEMENT_REGLEE | REGLEE | EN_LITIGE | ANNULEE | IRRECOUVRABLE. Aucune des branches ACTIF/EN_COURS/PAYE/TERMINE/EN_RETARD ne peut matcher : toute créance non brouillon est affichée « Suivi », y compris REGLEE, ANNULEE, EN_LITIGE et IRRECOUVRABLE.
- **Action :** Réutiliser la table de correspondance déjà correcte : ETAT_BADGES de src/components/app/receivable-payment-section.tsx:17 ou STATE_LABELS de src/app/app/paiements-a-recevoir/[id]/page.tsx:24, et typer le paramètre en Database["public"]["Enums"]["creance_etat"] pour que tsc détecte toute divergence future.

### Le filtre « En cours » de la page Paiements inclut les créances réglées, annulées et irrécouvrables

- **Fichier :** `src/app/app/paiements/page.tsx:86`
- **Constat :** const filtered = creances.filter(...) : `if (filtre === "actifs") return creance.etat !== "BROUILLON";`. Combiné au bug de statusLabel, une créance ANNULEE ou IRRECOUVRABLE apparaît sous le filtre « En cours » avec le badge « Suivi ». Le montant affiché est `Math.max(0, creance.montant - paid)` (ligne 154), donc une créance annulée non payée s'affiche à son montant plein comme si elle était due.
- **Action :** Restreindre le filtre « actifs » aux états réellement ouverts (OUVERTE, PARTIELLEMENT_REGLEE, EN_LITIGE) et ajouter un filtre/section distincte pour les états terminaux (REGLEE, ANNULEE, IRRECOUVRABLE).


## Authentication and onboarding

### Les CGU et la politique de confidentialité n'existent pas — le consentement est exigé, non liable et jamais conservé

- **Fichier :** `src/components/auth/sign-up-form.tsx:76-98`
- **Constat :** Les deux cases sont obligatoires (`src/lib/auth/schemas.ts:45-50` : `acceptCgu: z.literal(true)`, `acceptPrivacy: z.literal(true)`), mais les libellés sont des `<span className="font-medium text-nuit">conditions générales d'utilisation</span>` — aucun `<Link>`, aucun `href`. `grep -rn -i "cgu|mentions légales|politique de confidentialité" src/` ne retourne que ces composants et leurs tests : aucune page `/cgu`, `/confidentialite` ou `/mentions-legales` n'existe dans `src/app/`. Et le consentement n'est jamais persisté : `signUpAction` (`src/app/actions/auth.ts:93-103`) ne transmet à Supabase que `display_name` et `agency_name` dans `options.data` ; la table `public.prestataire` (`supabase/migrations/20260715120100_core_tables.sql:4-18`) n'a aucune colonne de type `cgu_accepted_at` / `privacy_accepted_at`. Le seul autre usage est `logSignUpInputPresence` (`src/lib/auth/log-auth-error.ts:22-36`) qui court-circuite en production.
- **Action :** Créer les pages `/cgu` et `/confidentialite` (rendues sous `AuthShell` ou une page publique), remplacer les `<span>` par des `<Link href=... target="_blank" rel="noopener">`, et persister la preuve de consentement : ajouter `cgu_accepted_at timestamptz`, `privacy_accepted_at timestamptz` et `consent_document_version text` sur `public.prestataire`, alimentés par le RPC `ensure_prestataire_for_current_user` depuis `raw_user_meta_data` (posé par `signUp` dans `options.data`). Le texte juridique lui-même relève d'une décision humaine.


## Communication channels — Email

### Aucun code de production n'écrit jamais dans email_outbox — le canal email du MVP n'a pas de producteur

- **Fichier :** `src/lib/email/channel.ts:28`
- **Constat :** `createEmailChannel` and `createEmailOutboxService` are only referenced by `src/lib/email/channel.ts`, `src/lib/email/index.ts` (re-export) and `src/lib/email/email.test.ts` — grep across `src/**` for `createEmailChannel|createEmailOutboxService|renderEmailTemplate` outside tests returns no caller. The scanners enqueue only `runtime_job` (`src/lib/runtime/scanners/runner.ts:144` `await input.deps.jobs.enqueue({...})`) and `RuntimeJobRepository` exposes a single method (`src/lib/runtime/jobs/types.ts:49-51`: `enqueue(input): Promise<EnqueueRuntimeJobResult>`) — there is no claim/consume side, so no job is ever turned into an email. Meanwhile `src/lib/runtime/cron/run-drains.ts:55` builds the email drain every 5 min against a table nobody fills. docs/SIDIAN_02_PRD_V2.md §8 lists "Communication email — notices préventives + relances graduées" as MVP block 2.
- **Action :** Implémenter le consommateur `runtime_job` manquant : un drain qui claim les jobs (`prevention_notice`, `echeance_relance`, …), résout créance/client via Supabase, appelle `createEmailChannel(...).enqueue({templateKey, recipient, variables, relatedEntityType:'creance', relatedEntityId, occurrenceKey})`, puis complete/fail le job sous lease. Ajouter un RPC `claim_runtime_job_batch` symétrique de `claim_communication_outbound_batch`.

### Aucune implémentation Supabase de CommunicationChannelRepository — la résolution de canal est impossible en production

- **Fichier :** `src/lib/communication-channels/types.ts:100`
- **Constat :** `CommunicationChannelRepository` (listByPrestataire / getById / ensureWhatsAppSidian) n'a qu'une seule implémentation dans le repo : `src/lib/communication-channels/test-fixtures/memory-repository.ts:30`. Aucun fichier `supabase-channel-repository.ts` n'existe (`find src/lib/communication-channels -type f`). Le RPC `public.ensure_whatsapp_sidian_channel(uuid)` créé en `supabase/migrations/20260726140000_communication_channels.sql:118` n'est appelé nulle part dans `src/**` — seule sa signature apparaît dans `src/types/database.generated.ts:2779`. Sans repository, `resolveCommunicationChannel` (src/lib/communication-channels/resolve.ts:12) et `queueGuidePaymentConfirmation` (outbound/service.ts:71) ne peuvent pas fonctionner hors tests.
- **Action :** Écrire `src/lib/communication-channels/supabase-channel-repository.ts` (service_role) : `listByPrestataire` / `getById` sur `communication_channel`, `ensureWhatsAppSidian` via `client.rpc('ensure_whatsapp_sidian_channel', {p_prestataire_id})`. L'appeler à l'onboarding prestataire pour provisionner le canal par défaut.

### Webhook WhatsApp live : annuaire d'identités Guide vide — toutes les réponses Guide sont rejetées unknown_sender

- **Fichier :** `src/lib/communication-channels/whatsapp/webhook/create-live-deps.ts:71`
- **Constat :** `create-live-deps.ts:71-73`: `const identities = input.identityDirectory ?? createMemoryIdentityDirectory(input.identities ?? []);`. La route appelle `createLiveWhatsAppWebhookDeps({ client, guideRecipientTechnicalId })` (src/app/api/whatsapp/webhook/route.ts:58-61) sans `identities` ni `identityDirectory` → tableau vide. `authorizeGuideForTenant` (inbound/identity.ts:63) retourne alors `{ok:false, reason:'unknown_sender'}` et `processInboundMessage` marque `processingStatus:'rejected'` (inbound/service.ts:296-316). Aucune table d'identité n'existe : `grep -n 'identity' supabase/migrations/20260726160000_g1q_whatsapp_inbound.sql` ne retourne aucune table (seules des colonnes `guide_id uuid` en ligne 175/217/271).
- **Action :** Créer une table `communication_identity (tenant_id, channel_id, guide_id, sender_reference, active, can_confirm_payments)` avec RLS service_role, un `createSupabaseIdentityDirectory` (resolve + resolveBySender), et l'injecter dans `createLiveWhatsAppWebhookDeps`. Enregistrer le `opaqueWhatsAppSenderReference` du Guide à l'onboarding.

### Le message Guide est envoyé en `interactive` (liste) et non en template Meta approuvé — échec hors fenêtre 24 h

- **Fichier :** `src/lib/communication-channels/whatsapp/templates/registry.ts:110`
- **Constat :** `buildGraphTemplateBody` (lignes 110-137) construit `{messaging_product:'whatsapp', type:'interactive', interactive:{type:'list', ...}}`. Le `ResolvedWhatsAppTemplate` porte pourtant `externalName:'guide_payment_confirmation'` et `languageCode:'fr'` (lignes 60-61) qui ne sont **jamais** utilisés dans le body Graph. Le message est business-initiated (outbox drainé par cron, `src/lib/runtime/drains/whatsapp/drain.ts:93`), donc hors session client : la Cloud API n'accepte que `type:'template'` avec un modèle approuvé dans ce cas. Le `messageKind` persisté vaut pourtant `'template'` (outbound/service.ts:120).
- **Action :** Remplacer le body par `{messaging_product:'whatsapp', type:'template', template:{name: template.externalName, language:{code: template.languageCode}, components:[{type:'body', parameters: bodyParameters.map(text=>({type:'text',text}))}, {type:'button', sub_type:'quick_reply', index:'0'|'1'|'2', parameters:[{type:'payload', payload:'gpc_0'|...}]}]}}` et faire correspondre les payloads aux clés de `META_LIST_ROW_TO_ACTION` (inbound/actions.ts:23). Meta plafonne les quick-reply à 3 boutons : voir la décision produit associée.


## Configuration, environment variables, validation, scripts, observability

### CRON_SECRET is never validated at build or boot — a deploy without it silently disables every scanner and drain

- **Fichier :** `next.config.ts:156`
- **Constat :** `validateDeploymentReadiness({...})` (next.config.ts:156-168) checks NEXT_PUBLIC_APP_URL, SIDIAN_ENVIRONMENT, the 3 Supabase vars, SIDIAN_SUPABASE_PROJECT_REF and SUPABASE_ENVIRONMENT_ATTESTATION_JWT. `assertStripeBuildReadiness()` (l.170-217) checks the Stripe set. Neither reads CRON_SECRET. `grep -c CRON_SECRET next.config.ts` = 0. At runtime src/lib/runtime/cron/auth.ts:39-44 `getCronSecret()` returns null when `env.CRON_SECRET?.trim()` is under 16 chars, and assertCronAuthorized returns `{ ok: false, status: 503, error: "cron_not_configured" }` (l.59-61). vercel.json schedules /api/cron/scanners daily and /api/cron/drains every 5 min; both would 503 indefinitely. The only log emitted is `logServerEvent("warn", "scanner_started", { authError })` in src/app/api/cron/_lib/handler.ts:35.
- **Action :** Add CRON_SECRET to the build-time gate in next.config.ts alongside the Supabase block: when VERCEL_ENV is preview|production, require `process.env.CRON_SECRET` with length >= 32, throwing the same French fail-closed message. Also surface `cron_not_configured` as a non-2xx health signal (see the /api/health finding) so a missing secret is caught before the first missed cron window.

### Outbox drains report ok:true / status "completed" when the email and WhatsApp providers are disabled — the cron is green while delivering nothing

- **Fichier :** `src/lib/runtime/drains/email/from-env.ts:28`
- **Constat :** `createEmailOutboxDrainFromEnv()` returns, when `env.mode === "disabled"`, a drain whose repository has `async claimForProcessing() { return null; }` and `async listClaimable() { return []; }` (from-env.ts:28-63). That yields a DrainBatchResult with claimed=0 and errors=0, so src/lib/runtime/cron/run-drains.ts:113-114 computes `status = result.errors > 0 ? "partial" : "completed"`, overall stays "completed", and l.209-213 returns `ok: true`. src/app/api/cron/_lib/handler.ts:61 then maps that to HTTP 200. The emitted log (run-drains.ts:123-136) carries only kind/claimed/delivered/errors — no field records that the provider was disabled. Since SIDIAN_EMAIL_PROVIDER_ENABLED and SIDIAN_WHATSAPP_PROVIDER_ENABLED both `.default("false")` (src/lib/email/env.ts:9, whatsapp/env.ts:9-11), an env-var typo or omission in production produces a permanently green cron with zero relances delivered.
- **Action :** Propagate the resolved transport mode into DrainBatchResult and into DrainCronEntry, and make runScheduledDrains return status "not_configured" (already a member of CronDrainsResponse["status"], used at run-drains.ts:213) when an MVP-active drain from DRAIN_INVENTORY resolves to mode "disabled". Emit `logServerEvent("error", "outbox_failed", { kind, reasonCode: "provider_disabled" })` for those, so the condition is visible without a dashboard.

### Production agent router is wired to NullObservabilitySink — every G1-I event, metric and detector is computed then discarded

- **Fichier :** `src/lib/agent/server/auth/create-router.ts:138`
- **Constat :** create-router.ts:138-140 reads `const observabilityService = createObservabilityService({ sink: new NullObservabilitySink() });` and the file header states it explicitly at l.6: "Observability : sink null (best-effort, zéro I/O réseau)". src/lib/agent/observability/sink.ts implements only InMemoryObservabilitySink and NullObservabilitySink — there is no persistent sink in the codebase. NullObservabilitySink.record() validates the event against observabilityEventSchema and returns `{ ok: true }` without storing anything. Consequently the entire src/lib/agent/observability/metrics/derive.ts (297 lines) and the 11 detectors in src/lib/agent/observability/detectors/ plus alert-candidates.ts are unreachable in production: `grep -rn "runDetectors|AlertCandidate" src/` returns nothing outside src/lib/agent/observability itself.
- **Action :** Add a Supabase-backed ObservabilitySink (mirroring createSupabaseAuditRepository, already injected at create-router.ts:136) or, as a smaller first step, a sink that forwards each sanitized event through `logServerEvent("info", event.event_type, ...)` so events land in Vercel logs. Then run runDetectors over a rolling window inside the scanners cron so the 11 detectors and alert-candidates actually produce output.

### LLM runtime is wired to NullLlmObservabilitySink in production — no token, cost, latency or error telemetry for any AI call

- **Fichier :** `src/lib/llm/factory.ts:41`
- **Constat :** factory.ts:40-41: `const observability = options.observability ?? new NullLlmObservabilitySink();`. src/lib/agent/server/auth/create-router.ts calls `resolveConversationalLlmProvider()` with no arguments, and resolve-conversational-provider.ts:28-32 forwards `observability: options.observability` — undefined — so the Null sink is always selected. src/lib/llm/runtime.ts:212-222 builds a full event with prompt_tokens/completion_tokens/total_tokens and awaits `options.observability.record(...)`; NullLlmObservabilitySink.record() (src/lib/llm/observability.ts:17-19) is a documented no-op ("no-op — zéro I/O"). There is therefore no way to answer "what did the assistant cost yesterday" from production data, and no dependency in package.json provides it (no sentry/otel/datadog/pino — grep returns nothing).
- **Action :** Pass an observability sink from create-router.ts into resolveConversationalLlmProvider(), backed by logServerEvent (the event built by buildLlmObservabilityEvent already contains only fingerprints, never raw prompts — src/lib/llm/observability.ts:38-49). Emit total_tokens per purpose/provider/mode so an AI-cost metric exists on day one.

### No validate:release or doctor script; the aggregate `pnpm test` omits typecheck, lint, design-system and every G1 SQL/auth suite

- **Fichier :** `package.json:68`
- **Constat :** package.json defines 47 scripts and none is named validate:release, doctor, ci, verify or test:all. The aggregate at l.68 is: test:local-guard, test:schema, test:auth, test:prod-001, test:prod-002, test:prod-002-p1, test:prod-003, test:prod-004, test:stripe-001, test:stripe-002-a/b/c, test:stripe-003, test:stripe-003-orphan-audit, test:security-trust-boundaries, test:security-rate-limits, test:security-environment, test:forms. Absent from it: `typecheck` (l.10), `lint` (l.9), `design-system:check` (l.58), `test:g1-a` harness (l.36), `test:g1-f:rls` (l.43), `test:g1-g:sql` (l.45), `test:g1-h:sql` (l.47), `test:g1-k:auth` (l.50), `test:g1-l:auth` (l.52), `test:g1-m:sql` (l.54), and `test:user-data-isolation` (l.33).
- **Action :** Add `"validate:release": "pnpm typecheck && pnpm lint && pnpm design-system:check && pnpm test && pnpm test:user-data-isolation && pnpm test:g1-a:strict && pnpm test:g1-f:rls && pnpm test:g1-g:sql && pnpm test:g1-h:sql && pnpm test:g1-k:auth && pnpm test:g1-l:auth && pnpm test:g1-m:sql"`. Note the ordering constraint: everything except typecheck/lint/design-system:check requires a running local Supabase (see the test-local-supabase-guard finding), so document that prerequisite in the script or gate it.


## Documents, attachments and file storage

### Any conversation turn containing an attachment is never persisted — the user's message and the assistant reply vanish on reload

- **Fichier :** `src/components/assistant/conversational-workspace.tsx:3059`
- **Constat :** In `handleSend`, the attachment branch reads `if (attachments.length > 0) { setPendingInvoiceImport(false); const reply = buildAttachmentReceiptReply(attachments); setWorkspace(...); return; }` (lines 3059-3076). It calls `setWorkspace` and returns without ever calling `persistDeterministicTurn`. Every other deterministic branch does call it (lines 2508, 2645, 2862, 2904, 2944, 3335, 3401). Production reaches this path: `liveAgent = forceLiveAgent || !demoState` (line 792) and `usesServerConversationPersistence = liveAgent && agentTransport === callAgentTool` (lines 793-794), and `/app/assistant` passes no demoState. So on the real app the user attaches a file, sees 'J'ai bien reçu cette facture.', reloads, and both messages are gone — `loadConversationMessages` (src/lib/assistant-conversations/service.ts:169-186) only returns rows from `public.message`, which was never written. The code itself acknowledges the resulting orphan state at line 1876: 'Une discussion sans ligne serveur (pièces jointes temporaires seules)'.
- **Action :** Call `persistDeterministicTurn(userContent, reply)` in the attachment branch before returning, exactly as the other deterministic branches do. Because `public.message` has `constraint message_contenu_non_vide check (char_length(trim(contenu)) > 0)` (supabase/migrations/20260715120100_core_tables.sql:156) and the composer allows sending files with no text (`canSend = !isBlocked && (trimmed.length > 0 || files.length > 0)`, composer.tsx:268), synthesise a non-empty `userContent` from the filenames when `trimmed` is empty, or block files-only submission until attachment persistence exists.


## Stripe integration and Sidian subscription plans

### Aucune facturation de l'abonnement Sidian n'existe — le modèle économique 49 €/mois n'est pas encaissable

- **Fichier :** `src/config/env-server.ts:28-40`
- **Constat :** `stripeEnabledEnvSchema` ne contient que des clés Connect (STRIPE_SECRET_KEY, STRIPE_CONNECT_WEBHOOK_SECRET, publishable, writer JWT). Recherche exhaustive sur `src/` : aucune occurrence de `stripe.subscriptions`, `billingPortal`, `mode: "subscription"`, `price:`/`priceId`, `STRIPE_PRICE`, `trial_period`. Le seul `price_data` du dépôt est src/lib/stripe/checkout/create-payment-session.ts:492 (paiement client, `product_data: { name: "Paiement à recevoir" }`). `.env.example` ne déclare aucune variable de facturation produit. docs/SIDIAN_02_PRD_V2.md:190 fixe pourtant « Sidian Early Access — 49 € HT par mois » et :194 « sans engagement ; garantie satisfait ou remboursé pendant 30 jours ; […] aucun plan gratuit ».
- **Action :** Construire un module distinct `src/lib/billing/**` sur le compte plateforme (jamais `stripeAccount`) : Product+Price 49 € HT récurrent mensuel, Checkout `mode: "subscription"` à l'inscription, Billing Portal pour résiliation/moyen de paiement, `prestataire.stripe_platform_customer_id` + `stripe_subscription_id` (nouvelle migration), et un webhook plateforme séparé (voir finding suivant) qui pilote `subscription_status`.

### `prestataire.subscription_status` n'a aucun chemin d'écriture — l'accès n'est jamais coupé

- **Fichier :** `src/lib/agent/gateway/adapters/tenant-membership-resolver.ts:127-129`
- **Constat :** `isActiveSubscription` s'appuie sur ACTIVE_SUBSCRIPTION_STATUSES = ["trialing","active","past_due"] (src/lib/agent/gateway/adapters/constants.ts:41-44) ; seul `cancelled` refuse. Or `subscription_status` est créé avec `default 'trialing'` (supabase/migrations/20260715120100_core_tables.sql:9) et grep sur toutes les migrations ne trouve aucun `set subscription_status = …` ni aucune RPC l'écrivant ; les triggers (20260717220000:26, 20260719150000:126, 20260721210100:19, 20260803120000:34) l'interdisent explicitement via PostgREST. Aucun code src/ ne l'écrit non plus (seules lectures + deux tests d'intégration qui font un UPDATE direct).
- **Action :** Ajouter une RPC SECURITY DEFINER `apply_platform_subscription_status(p_prestataire_id, p_status, p_stripe_subscription_id, p_period_end)` appelée uniquement depuis le webhook plateforme (customer.subscription.created|updated|deleted, invoice.payment_failed), plus une échéance de `trialing` (sinon `trialing` = accès gratuit illimité).

### Séparation abonnement-produit / paiements-clients : un seul secret, un seul endpoint, rien de prévu pour la plateforme

- **Fichier :** `src/lib/stripe/client.ts:61-63`
- **Constat :** `getStripeWebhookSecret()` renvoie l'unique `STRIPE_CONNECT_WEBHOOK_SECRET`, utilisé par processStripeWebhookRequest (src/lib/stripe/webhooks/process.ts:133) pour la seule route POST /api/stripe/webhook. Tous les handlers financiers appellent `requireConnectedAccount(event)` qui lève `stripe_connected_scope_mismatch` terminal si `event.account` est absent (src/lib/stripe/webhooks/payment-effects.ts:54-63 ; authorization-effects.ts:44-53). Un événement plateforme (`customer.subscription.*`, `invoice.*`) tomberait sur `isKnownStripeWebhookEvent` = false → `{outcome:"ignored", reason:"unknown_event_type"}` (dispatch.ts:232-234) et serait acquitté 200 sans trace métier. La séparation est donc réelle par défaut d'existence de (b), pas par conception.
- **Action :** Avant d'ajouter la facturation : créer une route dédiée `POST /api/stripe/webhook-plateforme` avec `STRIPE_PLATFORM_WEBHOOK_SECRET` distinct, refuser terminalement tout événement portant `event.account` sur cette route et tout événement sans `event.account` sur la route Connect (déjà le cas), et étendre `validateStripeEnvironment` pour exiger les deux secrets ensemble.

### Aucune révocation d'autorisation par le client, alors que le texte de consentement la promet

- **Fichier :** `src/lib/stripe/authorizations/consent.ts:6-8`
- **Constat :** Le texte coché par le client dit « Cette autorisation pourra être révoquée. » et docs/SIDIAN_02_PRD_V2.md:127 impose « Sa révocation résulte uniquement d'une décision explicite du client, d'un événement Stripe […] ». Or `REVOQUEE` n'est atteint que par webhook : supabase/migrations/20260721210300_sid_stripe_003_future_authorizations.sql:2119 (`etat = 'REVOQUEE'` dans apply_mandate_updated_authorization, branche `p_mandate_status = 'inactive'`) et le détachement de PaymentMethod. Aucune RPC `revoke_payment_authorization` n'existe (grep sur supabase/migrations = 0), et grep `payment_authorization` hors de src/lib/stripe et src/lib/runtime = 0 résultat : aucune page, aucune server action, aucun composant ne permet à un prestataire ou à un client de lister ou révoquer une autorisation.
- **Action :** Ajouter (a) une RPC `revoke_payment_authorization_public(p_public_token_hash)` accessible depuis une page /p (lien de révocation dans le mail de confirmation), (b) une RPC prestataire `revoke_client_payment_authorization(p_authorization_id)` sous RLS, (c) l'écran de gestion correspondant. Sans cela, ne pas afficher la phrase « pourra être révoquée ».


## Workers, crons, outbox, jobs

### La file runtime_job n'a aucun consommateur : tous les scanners écrivent dans le vide

- **Fichier :** `src/lib/runtime/jobs/types.ts:49`
- **Constat :** `RuntimeJobRepository` n'expose qu'une seule méthode : `enqueue(input: EnqueueRuntimeJobInput): Promise<EnqueueRuntimeJobResult>` — aucun `claim`, `complete` ou `fail`. La RPC `public.claim_runtime_jobs` existe bien (supabase/migrations/20260726220000_runtime_jobs.sql:529, commentaire « worker aval (bounded + lease), hors scanners ») mais un grep repo-wide sur `runtime_jobs|claim_runtime_job|enqueue_runtime_job` ne renvoie que deux fichiers : `src/lib/runtime/jobs/supabase-repository.ts` (enqueue) et la migration elle-même. `src/lib/runtime/cron/run-drains.ts:52-61` ne construit que 4 drains (whatsapp, email, paymentAudit, notification) — aucun ne touche `runtime_job`. La migration ne définit d'ailleurs même pas de `complete_runtime_job` / `fail_runtime_job` : un job passé en `claimed` resterait bloqué.
- **Action :** Implémenter le worker aval : (1) ajouter `claim`/`complete`/`fail` à `RuntimeJobRepository` + RPC SQL `complete_runtime_job(p_job_id, p_lease_token, p_outcome, p_error_code)` et `fail_runtime_job` avec `available_at` de backoff et plafond `attempt_count` ; (2) créer `src/lib/runtime/cron/run-jobs.ts` qui claim par `job_kind` et route vers des handlers déterministes (prevention_notice → enqueue email/WhatsApp, due_send_link → vérif lien partageable puis enqueue, silence_escalate → transition dossier ESCALADE_HUMAINE, closure_close_dossier → dossier CLOS, autopay_intent → `enqueue_payment_execution_job`, retry_failed_notify → notification prestataire) ; (3) le brancher dans `/api/cron/drains` (ou une 3e route cron) avec le même soft-deadline.

### Aucun effet métier automatique n'existe : les 6 scanners du §7 sont sans issue

- **Fichier :** `src/lib/runtime/cron/run-scanners.ts:36`
- **Constat :** `SCANNER_ORDER = [prevention, due, silence, closure, auto_pay, retries]` ; `runner.ts:144` fait `input.deps.jobs.enqueue({...jobKind, payload})` puis `leases.complete(...)`. `SCANNER_TO_JOB_KIND` (workflow-policy.ts:120) mappe vers `prevention_notice`, `due_send_link`, `silence_escalate`, `closure_close_dossier`, `autopay_intent`, `retry_failed_notify`. Aucun de ces 6 job kinds n'est lu nulle part. `docs/implementation/SID_GATE_P0_RUNTIME_AUTOMATION.md:36-43` décrit pourtant la chaîne « enqueue runtime_job / outbox → Cron drains → Executor / Provider » — la flèche `runtime_job → drains` n'existe pas dans le code. La lease `runtime_scan_lease` étant passée en `completed` définitivement (migration ligne 289-292 : « completed : ne jamais re-claimer la même occurrence »), l'occurrence est consommée sans effet et ne sera jamais rejouée après correction.
- **Action :** Bloquant lancement. Après implémentation du worker (finding précédent), prévoir un script de replay : remettre en `open` les `runtime_scan_lease` dont le `runtime_job` correspondant est encore `pending`, ou plutôt faire consommer les `runtime_job` déjà accumulés — ils sont intacts et idempotents par `idempotency_key`.

### payment_execution_job : retry infini sans backoff ni plafond, avec blocage de tête de file

- **Fichier :** `supabase/migrations/20260726210000_sid_p0_payment_execution_jobs.sql:174`
- **Constat :** `claim_payment_execution_job` (p_job_id null) sélectionne `where j.status in ('pending','failed_retryable','unknown') ... order by j.created_at asc ... limit 1`. La table (ligne 22-49) n'a ni colonne `available_at`/`next_attempt_at` ni `max_attempts` : la seule contrainte est `payment_execution_job_attempt_count_ck check (attempt_count >= 0)`. `complete_payment_execution_job` remet `status='failed_retryable'` et `lease_token=null` sans délai. Côté TS, `src/lib/runtime/cron/payment-jobs.ts:107-119` boucle `for (let i = 0; i < limit; i += 1) { ... await runtime.drain(); }` avec `limit` = 10 : la même ligne en échec, étant la plus ancienne, est re-claimée à chaque itération de la boucle, puis à chaque exécution du cron (toutes les 5 min), indéfiniment — elle consomme les 10 slots et affame tous les jobs plus récents.
- **Action :** Ajouter `available_at timestamptz not null default now()` et `max_attempts integer not null default 4` à `payment_execution_job` ; filtrer `available_at <= v_now` dans `claim_payment_execution_job` ; faire passer `complete_payment_execution_job` en `failed_terminal` quand `attempt_count >= max_attempts` et poser `available_at = v_now + backoff exponentiel` sinon (réutiliser `computeRetryDelaySeconds` de src/lib/communication-channels/outbound/backoff.ts). Ajouter dans la boucle de `payment-jobs.ts` une garde anti-relance du même `jobId` au sein d'un même run.


---

# P1 — indispensable au MVP


## AI runtime, LLM providers and agent tools

### No Anthropic adapter and no fallback provider — the runtime is structurally single-provider

- **Fichier :** `src/lib/llm/factory.ts:93`
- **Constat :** The `live` branch is hardcoded: `return createLlmRuntime({ transport: createOpenAiCompatibleTransport({ apiKey: env.apiKey, baseUrl: env.baseUrl, model: env.model, fetchImpl: options.fetchImpl }), mode: "live", ... })`. `CreateLlmRuntimeOptions` in src/lib/llm/runtime.ts:27 declares a single `transport: LlmTransport`; the retry loop (runtime.ts:177-244) re-invokes `options.transport.complete` — there is no second transport to fall back to. `src/lib/llm/providers/` contains exactly two files: `openai-compatible.ts` and `stub.ts`. `src/lib/llm/env.ts:12-52` has no provider discriminator and no `SIDIAN_LLM_FALLBACK_*` variables.
- **Action :** An Anthropic adapter must satisfy, file by file: (1) `src/lib/llm/types.ts` `LlmTransport` — `{ provider_id, mode: "live", complete({messages, max_output_tokens, temperature, json_mode, timeout_ms, signal}) => Promise<{content: string, usage?: {prompt_tokens, completion_tokens, total_tokens}}> }`; the Anthropic Messages API needs the `system` message hoisted out of `messages` into a top-level `system` param, `x-api-key` + `anthropic-version` headers instead of `Authorization: Bearer`, `max_tokens` (required), response read from `content[0].text` instead of `choices[0].message.content`, and `usage.input_tokens`/`output_tokens` mapped onto `prompt_tokens`/`completion_tokens`; `json_mode` has no `response_format` equivalent and must be emulated (assistant prefill or tool-use). (2) `src/lib/llm/errors.ts` — add a classifier for Anthropic's `{type:"error",error:{type:"overloaded_error"|"rate_limit_error"|...}}` bodies mapping onto the existing `LlmErrorCode` union (the current `classifyHttp` lives inside `providers/openai-compatible.ts:25` and is not reusable). (3) `src/lib/llm/env.ts` — add `SIDIAN_LLM_PROVIDER: z.enum(["openai","anthropic"])` plus `SIDIAN_LLM_FALLBACK_PROVIDER/_API_KEY/_BASE_URL/_MODEL`. (4) `src/lib/llm/factory.ts` — switch on provider and compose primary+fallback. (5) `src/lib/llm/runtime.ts` — either accept `transports: LlmTransport[]` or add a `createFallbackTransport(primary, secondary)` composite that switches on `LLM_PROVIDER_AUTH`/`LLM_PROVIDER_RATE_LIMITED`/`LLM_PROVIDER_ERROR`. (6) `src/lib/llm/index.ts` barrel export. (7) mirror tests in `src/lib/llm/runtime.test.ts`.

### No streaming and no server-side cancellation — the assistant cannot stream and the Stop button does not stop server work

- **Fichier :** `src/lib/llm/providers/openai-compatible.ts:65`
- **Constat :** The request body is `{ model, messages, max_tokens, temperature }` with no `stream: true`, and the response is consumed with `const rawText = await response.text()` (line 91). `grep -rn "stream" src/lib/llm/ src/lib/agent/conversational-runtime/` returns nothing. On the cancel path, `parseUserMessage` builds its own controller and never accepts the caller's signal — `ParseUserMessageInput` has no `signal` field and `withTimeout(timeoutMs, run)` (src/lib/agent/conversational-runtime/parse.ts:42-53) takes no parent signal, so `service.ts:91 parseUserMessage(options.provider, {user_message, reference_now, timeout_ms, max_retries, correlation_id})` drops it. Server-side, `raceWithTimeout(deps.router.route(...), routerTimeoutMs, request.signal)` (src/lib/agent/server/route-handler.ts:194) only abandons the promise: its own comment says «Ne prétend pas annuler un effet externe déjà déclenché».
- **Action :** If streaming is in MVP scope, add `stream: true` + SSE parsing to the transport, a `complete_stream` method on `LlmTransport`, and an SSE/ReadableStream response mode in `src/lib/agent/server/response-adapter.ts`. Independently, thread the caller AbortSignal end-to-end: add `signal?: AbortSignal` to `ParseUserMessageInput` and `ConversationalTurnInput`, pass `input.signal` into `withTimeout` in parse.ts, and pass `request.signal` from the executor down through `ToolExecutorInput`.

### No model allowlist — SIDIAN_LLM_MODEL and SIDIAN_LLM_BASE_URL accept any value

- **Fichier :** `src/lib/llm/env.ts:16`
- **Constat :** `SIDIAN_LLM_BASE_URL: z.string().url().default("https://api.openai.com/v1")` and `SIDIAN_LLM_MODEL: z.string().min(1).max(128).default("gpt-4o-mini")`. Any URL (including `http://` and RFC1918 hosts) and any model string is accepted. docs/SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md §10 requires «allowlist d'outils» and a `ModelProfile` abstraction (`"classification" | "conversation" | "reasoning"`) rather than a free-form model name; §10 also requires «quota et budget» per profile.
- **Action :** Add `const ALLOWED_MODELS = [...] as const` and validate `SIDIAN_LLM_MODEL` with `z.enum(ALLOWED_MODELS)`; constrain `SIDIAN_LLM_BASE_URL` with `.refine(u => u.startsWith('https://'))` and an allowlist of hostnames. Introduce the `ModelProfile` → model mapping required by §10 so `LlmCompletionRequest` carries a profile rather than the caller inheriting a single global model.

### Per-tenant LLM budget is dead code: budget_scope_key is never supplied in production

- **Fichier :** `src/lib/agent/server/auth/create-router.ts:148`
- **Constat :** `provider: resolveConversationalLlmProvider(),` is called with no arguments, so `ResolveConversationalLlmProviderOptions.budget_scope_key` is `undefined` (src/lib/llm/resolve-conversational-provider.ts:24-39) and is passed as `budget_scope_key: undefined` into `createConversationalExtractProvider`, which forwards it into `runtime.complete({... budget_scope_key: options.budget_scope_key})` (adapters/conversational-extract.ts:91). In `budget.ts:96` the per-scope counter is guarded by `if (input.scope_key) { ... }` — so `SIDIAN_LLM_BUDGET_MAX_REQUESTS_PER_SCOPE_PER_HOUR` (default 200) is never enforced. Only the global RPM/TPM applies, and those counters are process-local `Map`s (budget.ts:50-51), i.e. per serverless instance.
- **Action :** Thread the trusted tenant id into the provider: build the LlmProvider per-request (or pass a `budget_scope_key` resolver) so `resolveConversationalLlmProvider({ budget_scope_key: fingerprintOpaque(trusted.tenant_id) })` is used, and move the counters to a shared store (Supabase table or Redis) so limits hold across instances.

### No health or diagnostic endpoint reports LLM provider state

- **Fichier :** `src/app/api/health/route.ts:19`
- **Constat :** `GET` returns only `{ status, app: "sidian-v2", environment, database }` where `database` comes from `checkDatabaseHealth()` (src/lib/health/check-database.ts). There is no field for LLM provider configured / transport mode / model / key-present. `src/lib/health/` contains only `check-database.ts` and `check-database.test.ts`. Combined with `NullLlmObservabilitySink` and masked HTTP errors, an operator has no way to tell whether the assistant is running on a live model or on the deterministic fallback.
- **Action :** Extend the health payload with a non-secret `llm` block derived from `loadLlmEnv()`: `{ enabled, mode, model, base_url_host, api_key_present: Boolean(env.apiKey) }` — never the key itself. Wrap `loadLlmEnv()` in try/catch so a misconfiguration surfaces as `llm: { status: "misconfigured" }` (200/503) rather than throwing.

### A misconfigured SIDIAN_LLM_* env permanently bricks POST /api/agent/tools with an opaque 500

- **Fichier :** `src/lib/agent/server/auth/create-router.ts:110`
- **Constat :** `export async function getAgentHttpToolRouter() { if (!cachedRouterPromise) { cachedRouterPromise = buildAgentHttpToolRouter(); } return cachedRouterPromise; }` — a **rejected** promise is cached forever. `buildAgentHttpToolRouter` calls `resolveConversationalLlmProvider()` (line 148) → `loadLlmEnv()`, which throws `"Configuration LLM invalide : TRANSPORT_MODE requis si provider activé."` when `SIDIAN_LLM_PROVIDER_ENABLED=true` without `SIDIAN_LLM_TRANSPORT_MODE` (src/lib/llm/env.ts:73-78) and `"Configuration LLM live incomplète (API_KEY manquante)."` when mode=live without a key (env.ts:96-100). Every subsequent request awaits the same rejected promise; `createAgentServerHandler` masks it via `mapCaughtErrorToHttp` → `buildErrorHttpResponse(meta, "INTERNAL_SERVER_ERROR", 500)` (route-handler.ts:201-218). Same failure mode for a transient `createAgentPersistenceClient()` failure at line 127.
- **Action :** Only cache the promise on success: `cachedRouterPromise = buildAgentHttpToolRouter().catch(err => { cachedRouterPromise = null; throw err; })`. Separately, validate `SIDIAN_LLM_*` at boot/CI (a startup assertion or a `pnpm` env-check script) so misconfiguration fails loudly before serving traffic, and surface an `LLM_MISCONFIGURED` code rather than a bare 500.

### The 256 KiB body cap is bypassed by an unbounded request.clone().json() executed before the bounded reader

- **Fichier :** `src/app/api/agent/tools/route.ts:54`
- **Constat :** `const body = (await request.clone().json()) as AgentRequestPreview;` inside `inspectConversationIntent`, called from `POST` at line 141 — before `createAgentToolsRouteHandler(request)` (line 162). The size guard lives further downstream in `readBoundedRequestBody` (src/lib/agent/server/request-adapter.ts:88-125), which enforces `limits.max_body_bytes` = 256 KiB (src/lib/agent/server/limits.ts:16). `request.clone().json()` buffers the entire body with no cap, and App Router route handlers have no default body-size limit. It also runs before any authentication.
- **Action :** Read the body once with the bounded reader and derive the conversation intent from the already-parsed `ExternalToolRequest`, or at minimum check `request.headers.get('content-length')` against `DEFAULT_AGENT_SERVER_LIMITS.max_body_bytes` and bail with 413 before cloning.

### No rate limiting on POST /api/agent/tools — the only LLM-facing endpoint is unthrottled

- **Fichier :** `src/app/api/agent/tools/route.ts:140`
- **Constat :** `POST` performs no rate-limit check. `grep -rn 'rate.?limit' src/ -i` finds only `src/lib/auth/rate-limit.ts` used by `src/app/auth/callback/route.ts:33` and `src/app/actions/auth.ts` — auth only. `src/lib/agent/server/limits.ts` defines only body size and timeouts (max_body_bytes, gateway_timeout_ms, router_timeout_ms, total_timeout_ms); there is no request-count limit. The LLM budget tracker (src/lib/llm/budget.ts) is the sole throttle, it is process-local, and it is bypassed entirely in `disabled`/`stub` mode. docs/SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md §10 lists «quota et budget» as a non-negotiable constraint.
- **Action :** Add a per-tenant + per-actor rate limit to the agent entrypoint, evaluated after the Gateway resolves the trusted context (so it keys on `trusted.tenant_id`/`actor_id`, not on a spoofable header), backed by a shared store. Reuse the shape of `src/lib/auth/rate-limit.ts` and return the existing `AGENT_DEPENDENCY_UNAVAILABLE`-style sanitised 429.

### No LLM usage or cost metrics are persisted — production wires the Null sink for both LLM and agent observability

- **Fichier :** `src/lib/agent/server/auth/create-router.ts:138`
- **Constat :** `const observabilityService = createObservabilityService({ sink: new NullObservabilitySink() });` — `NullObservabilitySink.record()` validates and discards (src/lib/agent/observability/sink.ts:54-66). Separately `resolveConversationalLlmProvider()` (line 148) passes no `observability`, so `createLlmRuntimeFromEnv` falls back to `new NullLlmObservabilitySink()` (src/lib/llm/factory.ts:40-41), whose `record()` is an explicit no-op. `LlmObservabilityEvent` already carries `prompt_tokens`/`completion_tokens`/`total_tokens`/`duration_ms`/`provider_id` (src/lib/llm/types.ts:91-107) and `buildLlmObservabilityEvent` populates them — nothing consumes them. Consequently the alert detectors in `src/lib/agent/observability/detectors/` (repeated_permission_denials, cross_tenant_scope_mismatch, etc.) have no data source in production. `toAuditableTracePayload` (conversational-runtime/trace.ts:42) is likewise only referenced from `security.test.ts` and the barrel.
- **Action :** Implement a Supabase-backed `LlmObservabilitySink` and `ObservabilitySink` (mirroring `src/lib/agent/audit/persistence/supabase-audit-repository.ts`), wire them in `create-router.ts`, and persist `toAuditableTracePayload(result.trace)` on each converse turn. No cost can be attributed to a tenant until token counts are stored.

### The UI never discloses that the assistant ran without an LLM — extraction_source and fallback_used are dropped

- **Fichier :** `src/components/assistant/converse-adapter.ts:227`
- **Constat :** `protectionDraftConverseOutputSchema` returns `extraction_source: z.enum(["llm","deterministic_fallback"])` and `fallback_used: z.boolean()` (src/lib/agent/tools/schemas/protection-draft.ts:240-241), and the executor populates them (conversational-runtime/executors.ts:89-90). But `asConverseOutput(value)` in converse-adapter.ts:227-271 does not copy either field into `ConverseToolOutput`, and `grep -rn 'extraction_source|fallback_used' src/components src/app` returns nothing. With no key, `resolveConversationalLlmProvider` sets `preferDeterministicStub` (src/lib/llm/resolve-conversational-provider.ts:36-38) and `createConversationalExtractProvider` swaps in `createStubLlmProvider({mode:"deterministic"})` — regex extraction from `extractProtectionDraftFromMessage`. The visible prose is identical in both modes because it comes from templates: `generateSummary` / `generateNextQuestion` (src/lib/agent/conversational-runtime/domain.ts:72-105) and `buildAssistantMessageFromConverse` (converse-adapter.ts:71-164), never from the model.
- **Action :** Surface degradation honestly: copy `extraction_source`/`fallback_used` through `asConverseOutput`, and when `fallback_used === true` render a discreet French notice on the assistant message (e.g. « Analyse simplifiée — l'assistant intelligent est momentanément indisponible »). Decide with product whether `disabled` mode should refuse the turn outright rather than silently degrade.

### docs §10 contract not implemented: no ModelProfile, no AITask, no versioned prompt registry, no per-prestataire kill switch

- **Fichier :** `src/lib/llm/types.ts:16`
- **Constat :** `LlmCompletionRequest` carries `purpose: LlmAllowedPurpose` (4 values in safety.ts:11-20) and raw `messages` — there is no `profile: ModelProfile` and no `task: AITask`. docs/SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md §10 specifies `ModelProfile = "classification"|"conversation"|"reasoning"`, `AITask = "classify_message"|"draft_notice"|"draft_reminder"|"summarize_thread"|"detect_dispute_signal"`, an `src/ai/prompt-registry/` («prompts système sélectionnés côté serveur dans un registre versionné») and «kill switch global et par prestataire». `ls src/ai` → no such directory. The only system prompt is the inline `EXTRACTION_SYSTEM_PROMPT` string literal in src/lib/llm/adapters/conversational-extract.ts:19-32, unversioned. The only kill switch is the global `SIDIAN_LLM_PROVIDER_ENABLED` env var, read once at module init via the cached router — flipping it requires a redeploy. None of the five documented AITasks (dispute detection, notice/reminder drafting, thread summarisation) exist.
- **Action :** Add a versioned prompt registry (`prompt_id` + `version` recorded in the observability event and audit metadata), introduce `profile`/`task` on `LlmCompletionRequest`, and add a runtime kill switch readable per request — a `prestataire.ai_enabled` column plus a global flag checked at the top of `handleTurn`, not an env var frozen in a module cache.


## Authenticated application pages

### Aucune page 404 sous /app : une ressource supprimée ou étrangère affiche le 404 anglais par défaut de Next

- **Fichier :** `src/app/app/paiements-a-recevoir/[id]/page.tsx:81`
- **Constat :** `if (!detail) { notFound(); }` (et ligne 68 pour un UUID invalide). Un `find src/app -name "not-found*"` ne renvoie que src/app/p/not-found.tsx : il n'existe ni src/app/not-found.tsx ni src/app/app/not-found.tsx. loadPaymentReceivableDetail (src/lib/receivables/detail.ts:43) filtre sur `.eq("prestataire_id", prestataireId)` et renvoie null, donc l'accès à la créance d'un autre prestataire aboutit au même 404 anglais non stylé, hors coquille AppShell.
- **Action :** Ajouter src/app/app/not-found.tsx rendant l'AppShell + un EmptyState/ErrorState français (« Ce paiement à recevoir n'existe plus ou ne vous appartient pas ») avec un lien retour vers /app/paiements-a-recevoir. Le composant PermissionDenied de src/components/feedback/permission-denied.tsx existe déjà et n'est utilisé nulle part dans /app.

### Toutes les erreurs de chargement de page sont des culs-de-sac : ErrorState est rendu sans action de réessai

- **Fichier :** `src/app/app/clients/page.tsx:57`
- **Constat :** Les quatre pages métier rendent `<ErrorState compact title={UX_COPY.errorLoad.title} description={loadError} />` sans prop onRetry ni action : clients/page.tsx:57-63, paiements/page.tsx:131-137, paiements-a-recevoir/page.tsx:91-96, activite/page.tsx:32-37. Or src/components/feedback/error-state.tsx:29 ne construit un bouton que si `action ?? (onRetry ? ... : undefined)` est défini. UX_COPY.errorLoad.actionLabel = « Réessayer » (src/lib/ux/microcopy.ts:50) existe mais n'est jamais câblé.
- **Action :** Passer une action de rechargement (par ex. un composant client bouton appelant router.refresh()) ou, plus simplement, laisser l'erreur remonter au boundary src/app/app/error.tsx qui, lui, expose unstable_retry.

### Le lien de paiement est affiché une seule fois, sans bouton de copie, sans réémission ni révocation possible

- **Fichier :** `src/components/app/prepare-link-button.tsx:33`
- **Constat :** Le composant affiche `<Input readOnly value={state.shareUrl} onFocus={select} />` et le texte « Ce lien n'est affiché qu'une seule fois. Copiez-le maintenant. » (ligne 42). openPaymentReceivableAction (src/app/actions/clients-creances.ts:435-445) ne renvoie le raw_token qu'à la première ouverture ; ensuite `alreadyPrepared: true` et shareUrl null. revokePaymentLink existe côté lib (src/lib/stripe/customers/bindings.ts:153) mais aucune server action ni aucun bouton ne l'expose. Il n'y a donc aucun chemin UI pour retrouver, révoquer ou réémettre un lien perdu.
- **Action :** Ajouter (a) un bouton « Copier le lien » avec navigator.clipboard et confirmation visuelle, (b) une server action de révocation/réémission s'appuyant sur revokePaymentLink, exposée dans ReceivablePaymentSection quand un lien actif existe.

### Aucune action « envoyer le lien au client » : le partage est entièrement manuel

- **Fichier :** `src/components/app/receivable-payment-section.tsx:123`
- **Constat :** La seule action de la section paiement est `<PrepareLinkButton creanceId={creanceId} />`. Aucun bouton d'envoi email/WhatsApp n'existe sur la page Dossiers, la page Paiements ni la page détail (src/app/app/paiements-a-recevoir/[id]/page.tsx n'expose que PaymentReconciliationButton, FollowUpControls et CancelReceivableButton). Un grep « send_payment_link|sharePaymentLink » dans src/lib/agent et src/app/api/agent ne renvoie rien, alors que src/lib/runtime/scanners/eligibility.ts:106 déclare bien une capacité send_payment_link côté runtime.
- **Action :** Exposer une action serveur de relance/envoi du lien adossée au runtime de communication existant (src/lib/communication-channels), avec états processing/succès/erreur, sur la ligne de créance et sur la page détail.

### L'archivage d'un client ou d'une créance est déclenché sans confirmation et devient irréversible côté interface

- **Fichier :** `src/components/app/client-forms.tsx:122`
- **Constat :** ArchiveButton soumet directement le formulaire (`<Button type="submit" variant="destructive">`) sans aucune confirmation, alors que le composant ConfirmIrreversible (src/components/feedback/confirm-irreversible.tsx) existe et n'est utilisé que par cancel-receivable-button.tsx:27. Après archivage, l'élément disparaît définitivement de l'UI : listActiveClientPayeurs (src/lib/clients/client-payeur-core.ts:22) et listActiveCreances (src/lib/creances/creance-core.ts:41) filtrent tous deux `.is("archived_at", null)`, et aucune page ne propose de vue « archivés » ni de désarchivage.
- **Action :** Envelopper ArchiveButton dans ConfirmIrreversible (copie type UX_COPY.irreversible*) et ajouter soit un filtre « Archivés » sur /app/clients et /app/paiements, soit une action de désarchivage.

### L'entrée de menu « Gérer mon abonnement » pointe vers une page Paramètres qui ne contient aucune section abonnement

- **Fichier :** `src/components/app/app-sidebar.tsx:881`
- **Constat :** Le menu profil contient deux Link vers le même href : ligne 866 « Paramètres » et ligne 881-895 « Gérer mon abonnement » (icône CreditCard), tous deux href="/app/parametres". Or src/app/app/parametres/page.tsx ne rend que trois blocs : ProfileForm (nom + profil agent), ConfigStatusList (canaux) et l'adresse email en lecture seule. Aucun plan, prix, facture, moyen de paiement ni portail de facturation.
- **Action :** Soit retirer l'entrée « Gérer mon abonnement » jusqu'à ce que la facturation existe, soit la pointer vers un écran de facturation réel. Laisser un lien qui ne mène à rien est une promesse non tenue sur un produit payant.

### Les lignes de la page Dossiers ne mènent pas à la page détail — le détail n'est atteignable que depuis Paiements

- **Fichier :** `src/app/app/paiements-a-recevoir/page.tsx:110`
- **Constat :** BusinessRow y est rendu sans prop href (lignes 110-124) ; seul un <details> « Gérer la protection » s'ouvre en place. À l'inverse paiements/page.tsx:160 passe href={`/app/paiements-a-recevoir/${creance.id}`}. La page détail (historique, réconciliation Stripe, dossier de suivi, annulation) est donc invisible depuis la page qui porte le libellé « Dossiers » dans la navigation.
- **Action :** Ajouter href={`/app/paiements-a-recevoir/${creance.id}`} sur BusinessRow de la page Dossiers, ou déplacer le formulaire de brouillon vers la page détail pour n'avoir qu'un seul point d'entrée.

### Aucune page détail client : le répertoire Clients n'ouvre rien

- **Fichier :** `src/app/app/clients/page.tsx:70`
- **Constat :** BusinessRow est rendu sans href, avec pour seul enfant un RowDetails « Modifier le client » contenant ClientForm + ArchiveButton (lignes 72-96). Il n'existe aucune route src/app/app/clients/[id] (arborescence vérifiée). Impossible donc de voir les créances, l'historique de paiement ou les échanges d'un client donné, alors que la description de la page promet « Retrouve un client, vois la prochaine action, prépare un suivi » (ligne 48).
- **Action :** Créer /app/clients/[id] agrégeant les créances du client (filtre client_payeur_id), sa timeline et ses dossiers de suivi, et rendre la ligne cliquable — ou corriger la description de la page pour ne pas promettre ce qui n'existe pas.

### État « aucun résultat » manquant : un filtre vide affiche le message de premier usage

- **Fichier :** `src/app/app/paiements/page.tsx:139`
- **Constat :** `{!loadError && filtered.length === 0 ? <EmptyState title={UX_COPY.emptyPayments.title} ... action={{label:..., href:"/app/assistant"}} /> : null}`. filtered est le résultat du filtre ?filtre=brouillon|actifs (ligne 86). Un prestataire ayant 30 créances actives et 0 brouillon voit donc « Aucun paiement attendu — Crée un premier paiement à recevoir » (microcopy.ts:32-36) sur l'onglet Brouillons. Le paramètre filtre n'est par ailleurs pas validé : ?filtre=xyz renvoie toutes les lignes sans onglet actif.
- **Action :** Distinguer empty (creances.length === 0) de no-results (filtered.length === 0 && creances.length > 0), avec une copie du type « Aucun brouillon » + lien « Voir tous les paiements », et valider filtre contre la liste autorisée.

### Le message d'erreur précis de la préparation de lien est calculé puis jeté

- **Fichier :** `src/components/app/prepare-link-button.tsx:53`
- **Constat :** `{state && !state.ok ? <p role="alert">{UX_COPY.requestSaveFailed.title}</p> : null}` — state.message est ignoré. Or openPaymentReceivableAction renvoie via mapOpenReceivableError (src/app/actions/clients-creances.ts:398-409) des messages actionnables : « Ce paiement à recevoir n'est pas dans un état permettant de préparer un lien. », « Ce paiement à recevoir est archivé. », « Paiement à recevoir introuvable. ». L'utilisateur reçoit toujours « Je n'ai pas pu enregistrer ta demande. »
- **Action :** Afficher {state.message} et ne retomber sur UX_COPY.requestSaveFailed.title que si message est vide.

### Le proxy renvoie un JSON technique brut en anglais lors d'une navigation HTML vers /app

- **Fichier :** `src/proxy.ts:24`
- **Constat :** `catch { response = NextResponse.json({ error: "service_unavailable" }, { status: 503 }); }` dans le bloc requiresAuthRefresh (pathname === "/app" || startsWith("/app/"), ligne 11). Une navigation navigateur vers /app/clients pendant une indisponibilité Supabase (assertSupabaseDeploymentEnvironment ou updateSession en échec) affiche donc littéralement {"error":"service_unavailable"} dans la fenêtre, en anglais, hors charte.
- **Action :** Pour les requêtes dont Accept contient text/html, rediriger vers une page d'indisponibilité française stylée (ou rewrite vers un segment /indisponible) et réserver la réponse JSON aux requêtes API.


## Authentication and onboarding

### Boucle sans issue pour une session authentifiée mais non confirmée : ni déconnexion ni renvoi d'email

- **Fichier :** `src/app/inscription/verifier-email/page.tsx:14-20`
- **Constat :** La page ne contient qu'un `<Link href="/connexion">Se connecter</Link>` — aucun `SignOutButton`, aucune action de renvoi. Or `/connexion` appelle `redirectIfAuthenticated()` (`src/app/connexion/page.tsx:26`), qui redirige vers `/app` dès que `getAuthenticatedUser()` retourne un user, **sans vérifier `email_confirmed_at`** (`src/lib/auth/session.ts:42-48`). `/app` redirige vers `/app/assistant` (`src/app/app/page.tsx:5`), qui appelle `requireConfirmedUser()` → redirect `/inscription/verifier-email` (`src/lib/auth/session.ts:32-40`). L'utilisateur boucle entre les deux pages. L'état est atteignable : le callback pose la session via `exchangeCodeForSession` puis redirige vers `/inscription/verifier-email` si `!user?.email_confirmed_at` (`src/app/auth/callback/route.ts:59-68`), en laissant les cookies de session en place.
- **Action :** Faire vérifier la confirmation à `redirectIfAuthenticated` (rediriger vers `/inscription/verifier-email` si `!user.email_confirmed_at`), et ajouter sur `/inscription/verifier-email` un `SignOutButton` plus une server action de renvoi appelant `supabase.auth.resend({ type: 'signup', email })`, protégée par une nouvelle catégorie de rate limit `auth_confirmation_resend_*`.

### forgotPasswordAction annonce « email envoyé » alors qu'aucun email n'est parti quand le backend de quota est indisponible

- **Fichier :** `src/app/actions/auth.ts:171-185`
- **Constat :** ```
const rateLimit = await authRateLimit("password_reset", parsed.data.email);
if (rateLimit.status !== "allowed") {
  return success(AUTH_MESSAGES.genericPasswordResetSent);
}
```
Le commentaire au-dessus ne parle que du cas `limited` (anti-énumération), mais la condition capture aussi `unavailable`. Or `evaluateAuthRateLimit` retourne `{ status: "unavailable" }` sur toute exception — y compris `getSupabaseServerEnv()` qui jette si `SUPABASE_SERVICE_ROLE_KEY` est absent (`src/lib/security/rate-limit.ts:68`, capturé en `src/lib/auth/rate-limit.ts:75-83`). Dans ce cas `supabase.auth.resetPasswordForEmail` n'est jamais appelé (`createClient()` est ligne 178, après le `return`) et l'utilisateur lit « vous recevrez un email » indéfiniment. Le test `src/app/actions/auth.test.ts:111-123` ne couvre que `limited`.
- **Action :** Distinguer les deux cas : conserver la réponse générique pour `limited`, mais sur `unavailable` émettre un `logServerEvent("error", ...)` et retourner `AUTH_MESSAGES.genericAuthError` (« La connexion n'a pas abouti… ») plutôt qu'un faux succès. Ajouter un test couvrant `status: "unavailable"`.

### Une panne du backend de quota verrouille toute connexion en affichant « Trop de tentatives », un diagnostic faux

- **Fichier :** `src/app/actions/auth.ts:129-132`
- **Constat :** `if (rateLimit.status !== "allowed") return failure(undefined, AUTH_MESSAGES.genericRateLimitError);` — la même branche traite `limited` et `unavailable`. Le test `src/app/actions/auth.test.ts:100-109` confirme que c'est intentionnel (« échoue fermé sur la connexion si le quota est indisponible »). Mais `unavailable` survient dès qu'une seule dépendance tombe : RPC `consume_public_rate_limit` absente, enum `public_rate_limit_category` non migrée, `SUPABASE_SERVICE_ROLE_KEY` mal renseignée, ou `assertSupabaseDeploymentEnvironment()` en échec dans `createAdminClient()` (`src/lib/supabase/admin.ts:12`). Le message affiché est alors « Trop de tentatives. Patientez quelques minutes avant de réessayer. » (`src/lib/auth/messages.ts:6-7`) : ni l'utilisateur ni le support ne peuvent diagnostiquer une panne d'infrastructure, et l'attente ne résout rien.
- **Action :** Garder le fail-closed mais séparer le message : sur `unavailable`, retourner `AUTH_MESSAGES.genericAuthError` et logguer `logServerEvent("error", "auth.rate_limit_unavailable", { operation })` en niveau error (aujourd'hui `warn` seulement, `src/lib/auth/rate-limit.ts:67-72`). Câbler une alerte sur cet événement — c'est le signal d'une indisponibilité totale de la connexion.

### /reinitialiser-mot-de-passe accepte n'importe quelle session authentifiée, sans preuve de contexte recovery ni réauthentification

- **Fichier :** `src/app/reinitialiser-mot-de-passe/page.tsx:8-12`
- **Constat :** La page ne vérifie que `const user = await getAuthenticatedUser(); if (!user) redirect("/connexion?erreur=session")`. Aucun contrôle que la session provient du parcours recovery (pas de lecture de `amr` / `aal`, pas de marqueur posé par le callback). `resetPasswordAction` (`src/app/actions/auth.ts:200-222`) appelle `supabase.auth.updateUser({ password })` sans jamais demander le mot de passe actuel. Côté Supabase, `secure_password_change = false` (`supabase/config.toml:233-234`) désactive l'exigence de réauthentification récente. Un cookie de session volé permet donc de changer le mot de passe et d'expulser le titulaire du compte, sans connaître l'ancien mot de passe.
- **Action :** Passer `secure_password_change = true` dans `supabase/config.toml` (et dans le dashboard), et sur ce parcours exiger soit un `nonce` de réauthentification (`supabase.auth.reauthenticate()`), soit la vérification que la session porte bien un contexte recovery — par exemple en faisant poser au callback un cookie court `sb-recovery` quand `nextPath === "/reinitialiser-mot-de-passe"` (`src/app/auth/callback/route.ts:70`) et en l'exigeant côté page et action.

### Aucune error boundary ne couvre les pages d'authentification

- **Fichier :** `src/app/layout.tsx`
- **Constat :** `find src/app -maxdepth 2 -name "error.tsx" -o -name "global-error.tsx"` ne retourne que `src/app/app/error.tsx` et `src/app/p/error.tsx`. Il n'existe ni `src/app/error.tsx` ni `src/app/global-error.tsx`. Or `/connexion`, `/inscription` et `/mot-de-passe-oublie` appellent tous `redirectIfAuthenticated()` → `createClient()` → `await assertSupabaseDeploymentEnvironment()` (`src/lib/supabase/server.ts:13`), qui jette `environment_attestation_failed` ou `service_role_attestation_failed` (`src/lib/supabase/environment-attestation.ts:58,71`) si l'attestation échoue ou expire (timeout 5 s). Sans boundary, la page de connexion tombe sur l'écran d'erreur par défaut de Next, en anglais, sur un produit entièrement francophone.
- **Action :** Ajouter `src/app/error.tsx` (et `src/app/global-error.tsx` pour les erreurs de layout racine) rendant `ErrorState` avec la copy `UX_COPY.errorGeneric`, sur le même modèle que `src/app/app/error.tsx` — en réutilisant `AuthShell` ou `BrandLockup` pour rester cohérent avec les écrans d'auth.

### Les formulaires d'auth perdent toutes les saisies à la moindre erreur de validation

- **Fichier :** `src/components/auth/sign-up-form.tsx:22-98`
- **Constat :** Aucun `AuthField` du formulaire d'inscription ne reçoit de `defaultValue` — comparer avec `src/components/app/client-forms.tsx:81,90` et `src/components/app/profile-form.tsx:52` qui, eux, passent `defaultValue={initial?...}`. Et `AuthActionState` (`src/app/actions/auth.ts:26-30`) ne transporte que `{ ok, message, fieldErrors }` : les valeurs soumises ne sont jamais renvoyées au client. Avec `useActionState` + `<form action={formAction}>` sous React 19, le formulaire est réinitialisé à la fin de l'action, y compris en échec. Un utilisateur qui se trompe de confirmation de mot de passe doit re-saisir 5 champs et re-cocher 2 cases. Même problème sur `sign-in-form.tsx` (email perdu) et `reset-password-form.tsx`.
- **Action :** Ajouter `values?: Record<string, string>` à `AuthActionState`, le remplir dans `failure()` avec les champs non sensibles (`displayName`, `agencyName`, `email`, et l'état des cases `acceptCgu`/`acceptPrivacy` — jamais les mots de passe), et câbler `defaultValue` / `defaultChecked` dans les trois formulaires.

### Aucun moyen de renvoyer l'email de confirmation

- **Fichier :** `src/app/inscription/verifier-email/page.tsx`
- **Constat :** `grep -rn -i "resend|renvoyer|renvoi" src/` ne retourne aucune occurrence liée à l'authentification (uniquement le provider email `resend` de `src/lib/email/outbox/service.ts:53` et des commentaires sans rapport). `supabase.auth.resend` n'est appelé nulle part. La page de vérification est purement informative. Combiné à `[auth.rate_limit] email_sent = 2` par heure (`supabase/config.toml:203-205`), un email perdu, filtré en spam ou une adresse mal saisie condamne le compte : l'utilisateur ne peut ni réessayer, ni se réinscrire avec la même adresse.
- **Action :** Ajouter une server action `resendConfirmationAction` appelant `supabase.auth.resend({ type: 'signup', email })`, rate-limitée par email + IP via une nouvelle catégorie `auth_confirmation_resend_*` dans `PERSISTENT_RATE_LIMIT_CATEGORIES` et `consume_public_rate_limit`, avec réponse générique non énumérante. Prévoir aussi un chemin de correction d'adresse (support ou `updateUser({ email })`).

### La page d'onboarding /app/demarrage est orpheline : elle a été explicitement retirée de la navigation

- **Fichier :** `src/components/app/app-nav-config.ts:52-66`
- **Constat :** `LEGACY_NAV_LABELS` contient littéralement `"Bien démarrer"` — le titre exact de `DemarragePage` (`src/app/app/demarrage/page.tsx:56`) — dans une liste commentée « Libellés / destinations héritées — ne doivent plus apparaître dans la nav ». `APP_NAV` ne contient que 5 entrées (`/app/assistant`, `/app/paiements-a-recevoir`, `/app/paiements`, `/app/clients`, `/app/activite`). Après confirmation d'email, le callback redirige vers `/app` (`src/lib/auth/safe-redirect.ts:1`) → `/app/assistant` (`src/app/app/page.tsx:5`). Aucun lien vers `/app/demarrage` n'existe sur cette page. `grep -rn demarrage src/` ne trouve de `href` que dans `src/lib/ux/config-status.ts:36,87` (CTA de bannières `MissingConfigBanner`), rendues uniquement dans `/app/demarrage` lui-même et dans `/app/parametres` via `ConfigStatusList`. Le checklist de progression (`buildOnboardingSteps`, `getOnboardingCompletion`) est donc atteignable seulement via Paramètres → CTA d'un canal en défaut.
- **Action :** Trancher : soit reconnecter `/app/demarrage` (redirection depuis `/app` tant que `getOnboardingCompletion().completed < total`, ou entrée temporaire dans `APP_NAV`), soit porter la progression d'onboarding dans l'empty state de `/app/assistant` conformément au verrou de `docs/design/SIDIAN_DESIGN_LOCK.md` et supprimer la page. En l'état, le parcours §2bis du PRD n'est pas atteignable par un nouvel utilisateur.

### Hors Vercel, tous les utilisateurs partagent le même sujet de rate limit IP — verrouillage global de l'authentification

- **Fichier :** `src/lib/stripe/checkout/client-ip.ts:14-25`
- **Constat :** ```
export function clientIpFromHeaders(headers, trustedVercelProxy = process.env.VERCEL === "1") {
  if (!trustedVercelProxy) return "untrusted-proxy";
```
Cette valeur alimente le sujet `ip:${clientIp}` de `evaluateAuthRateLimit` (`src/lib/auth/rate-limit.ts:61`). Si `VERCEL !== "1"`, chaque requête d'auth consomme le même compteur. Les quotas de `consume_public_rate_limit` (`supabase/migrations/20260721200100_sid_sec_006_rate_limit_policy.sql:38-67`) sont : `auth_signup_ip` 10 / 10 min, `auth_signin_ip` 30 / 10 min, `auth_callback_ip` 30 / 10 min — soit, globalement, 30 connexions toutes plateformes confondues par tranche de 10 minutes, après quoi `signInAction` échoue fermé pour tout le monde.
- **Action :** Documenter explicitement dans `README.md` / `docs/operations/` que le déploiement hors Vercel est non supporté pour l'authentification, ou rendre l'en-tête de confiance configurable (`SIDIAN_TRUSTED_IP_HEADER`) et refuser de démarrer si l'IP cliente n'est pas résoluble en environnement `staging`/`production`.

### Aucun parcours de suppression de compte — et la contrainte FK l'interdit au niveau base

- **Fichier :** `supabase/migrations/20260715120100_core_tables.sql:6`
- **Constat :** `user_id uuid not null unique references auth.users (id) on delete restrict` : tant qu'une ligne `prestataire` existe, la suppression de l'utilisateur Auth est rejetée par PostgreSQL. Côté produit, `src/app/app/parametres/page.tsx` n'expose que `ProfileForm` (nom + profil agent), `ConfigStatusList` et un panneau « Adresse du compte » en lecture seule (lignes 32-58) — aucune action de suppression ni d'export. Aucun endpoint ni server action de suppression n'existe (`src/app/actions/` : approvals, auth, clients-creances, payment-reconciliation, profile, receivable-workflows).
- **Action :** Implémenter le droit à l'effacement RGPD : un RPC `SECURITY DEFINER` de suppression/anonymisation cascadant sur les tables `prestataire`-scopées, ou passer la FK en `on delete cascade` avec une politique de rétention documentée pour les données financières (obligation comptable). L'arbitrage rétention légale vs effacement est une décision produit/juridique.

### resolveSafeRedirectPath — le seul garde-fou contre l'open redirect — n'a aucun test

- **Fichier :** `src/lib/auth/safe-redirect.ts:10-28`
- **Constat :** `ls src/lib/auth/*.test.ts` ne retourne que `rate-limit.test.ts` et `schemas.test.ts`. Il n'existe pas de `safe-redirect.test.ts`, et `src/app/auth/callback/route.test.ts` n'exerce que `next=/app` (lignes 77, 94, 130) — jamais une valeur hostile. La fonction est pourtant la défense unique du callback contre l'open redirect, et sa logique est subtile : elle rejette `//evil.com` par `candidate.startsWith("//")` mais ne traite pas explicitement les variantes `/\\evil.com`, `/%2f%2fevil.com` ou `\\/evil.com`, qui tombent aujourd'hui dans l'allowlist par défaut — comportement correct, mais non verrouillé par un test.
- **Action :** Ajouter `src/lib/auth/safe-redirect.test.ts` couvrant : `//evil.com`, `/\\evil.com`, `https://evil.com`, `/%2f%2fevil.com`, `javascript:alert(1)`, `/app?next=//evil.com`, `/app/../../etc`, `null`, `""`, et un chemin hors allowlist — en asseyant que le retour est toujours `/app` ou un des 4 chemins autorisés.

### Le lien de confirmation ouvert depuis un autre appareil ou navigateur échoue silencieusement (PKCE)

- **Fichier :** `src/app/auth/callback/route.ts:44-57`
- **Constat :** `supabase.auth.exchangeCodeForSession(code)` exige le code verifier PKCE, stocké en cookie par `createServerClient` (`@supabase/ssr` utilise le flow PKCE par défaut ; aucun `flowType` n'est surchargé dans `src/lib/supabase/server.ts:17-40`). Ce cookie est posé lors de `supabase.auth.signUp` dans la server action (`src/app/actions/auth.ts:93`), donc dans le navigateur d'inscription uniquement. Si l'utilisateur ouvre le mail sur son téléphone ou dans un autre navigateur, l'échange échoue et l'utilisateur est renvoyé sur `/connexion?erreur=callback`, qui affiche `AUTH_MESSAGES.genericAuthError` (`src/app/connexion/page.tsx:9`) — un message qui ne mentionne pas la cause réelle ni la marche à suivre.
- **Action :** Soit basculer les emails de confirmation sur le flow `token_hash` (template Supabase `{{ .TokenHash }}` + `supabase.auth.verifyOtp({ token_hash, type })` dans le callback), qui fonctionne cross-device ; soit, a minima, distinguer l'erreur d'échange dans `ERROR_MESSAGES` avec une copy explicite (« Ouvrez le lien depuis le navigateur utilisé lors de l'inscription, ou demandez un nouvel envoi »).


## Communication channels — Email

### Drain email : pas de lease, pas de backoff, lignes `processing` définitivement bloquées

- **Fichier :** `src/lib/email/outbox/supabase-repository.ts:306`
- **Constat :** `listClaimable` (lignes 306-330) fait `.eq("status","queued")` uniquement — les lignes restées en `processing` (crash pendant un send) ne sont jamais reprises, et `claimForProcessing` (ligne 213-218) refuse tout ce qui n'est pas `queued`. `markFailedRetryable` (lignes 254-268) remet `status:'queued'` **sans** écrire `next_attempt_at`, donc aucun backoff (contrairement à WhatsApp, cf. outbound/backoff.ts:6 + supabase-message-repository.ts:371). Le RPC de lease existe pourtant : `supabase/migrations/20260726200000_runtime_outbox_leases.sql:328 create or replace function public.claim_email_outbox_batch(...)` (il gère `processing` expiré, `next_attempt_at`, dead_letter au plafond), et son adaptateur `claimEmailOutboxBatchSql` (src/lib/runtime/drains/email/claim-sql.ts:61) n'est appelé que par le re-export `src/lib/runtime/drains/index.ts:42` — jamais par le drain (`src/lib/runtime/drains/email/drain.ts:90` appelle `processQueuedEmailBatch`).
- **Action :** Faire passer `createEmailOutboxDrain` par `claimEmailOutboxBatchSql`, ajouter `alreadyClaimed` à `processEmailOutboxRecord` (comme `processOutboundMessage`), et propager `leaseToken` + `retryDelaySeconds` (`computeRetryDelaySeconds`) dans `markFailedRetryable` → `next_attempt_at`. Ajouter le filtre `next_attempt_at <= now()` si `listClaimable` est conservé.

### Aucun traitement des bounces / plaintes email — pas de webhook Resend

- **Fichier :** `src/lib/email/outbox/repository.ts:35`
- **Constat :** `findByProviderMessageId(providerKind, providerMessageId)` est déclaré (repository.ts:35-38) et implémenté (supabase-repository.ts:203-211) mais n'a aucun appelant : il n'existe aucune route webhook email (`find src/app/api -type d` → agent, assistant, cron, health, stripe, whatsapp uniquement). `EMAIL_DELIVERY_STATUSES` (types.ts:18-24) s'arrête à `sent` : ni `bounced`, ni `complained`, ni `delivered`. `canTransitionEmailStatus` (types.ts:111) n'est appelé nulle part côté persistance.
- **Action :** Ajouter `src/app/api/email/webhook/route.ts` vérifiant la signature Svix de Resend (`svix-id`/`svix-timestamp`/`svix-signature`, secret dédié `SIDIAN_EMAIL_WEBHOOK_SECRET`), dédupliquer sur un `email_webhook_events` calqué sur `communication_webhook_events`, et étendre l'enum `email_delivery_status` avec `delivered|bounced|complained` + une table de suppression consultée par `enqueue`.

### Aucun mécanisme d'opt-out / désabonnement sur les emails sortants

- **Fichier :** `src/lib/email/outbox/processor.ts:44`
- **Constat :** Les seuls headers posés sont `X-Sidian-Template` et `X-Sidian-Outbox-Id` (processor.ts:44-47) — pas de `List-Unsubscribe` ni `List-Unsubscribe-Post`. Le corps généré par `layoutHtml` (templates/registry.ts:122-136) ne contient ni lien de désinscription, ni mentions légales, ni adresse de l'expéditeur. Aucune table/colonne de suppression n'existe dans `supabase/migrations/20260726190000_email_outbox.sql`. Aucune vérification d'opt-out dans `createEmailOutboxService.enqueue` (outbox/service.ts:65-150).
- **Action :** Décider avec le conseil juridique le statut des relances (transactionnel vs marketing), puis a minima : ajouter `List-Unsubscribe`/`List-Unsubscribe-Post` (Gmail/Yahoo l'exigent au-delà de 5k/jour), une table `email_suppression (tenant_id, recipient_email_hash, reason, created_at)` consultée par `enqueue` avant `insertQueued`, et un pied de page légal dans `layoutHtml`.

### From / Reply-To globaux plateforme : les réponses clients n'atteignent jamais le prestataire

- **Fichier :** `src/lib/email/outbox/processor.ts:30`
- **Constat :** `buildMessageFromRecord` prend `from: {email: env.fromAddress, name: env.fromName}` et `replyTo: env.replyTo` (processor.ts:30-35) — trois valeurs d'environnement uniques pour tous les tenants (`src/lib/email/env.ts:12-14`). Les templates disent pourtant « Je m'occupe du suivi des paiements pour ${prestataireName} » (templates/registry.ts:175) et docs/SIDIAN_02_PRD_V2.md §8 fait de la « fenêtre de réponse client » un élément du bloc MVP 2. Le `EmailOutboxRecord` n'a aucun champ from/reply-to (types.ts:69-98), ni la table (`migrations/20260726190000_email_outbox.sql:32-119`).
- **Action :** Ajouter `reply_to` (et optionnellement `from_name`) à `email_outbox`, alimenté à l'enqueue depuis l'email du prestataire, et faire lire ces colonnes par `buildMessageFromRecord` avec fallback sur l'env. Le `from` doit rester un domaine Sidian vérifié (DKIM/SPF) pour la délivrabilité.

### Clé d'idempotence email dégénérée quand relatedEntityId et occurrenceKey sont absents

- **Fichier :** `src/lib/email/outbox/service.ts:82`
- **Constat :** outbox/service.ts:82-98 : `const entityId = input.relatedEntityId?.trim() || input.occurrenceKey?.trim() || recipientEmailHash;` puis `occurrenceKey: ... || 'default'`. Pour un appel sans `relatedEntityId` ni `occurrenceKey` (les deux sont optionnels — `EnqueueEmailInput` lignes 33-39), la clé devient `hash(tenantId|templateKey|recipientEmailHash|'default'|recipientEmailHash)` : constante. Le hit d'idempotence lignes 104-117 renvoie alors éternellement la première ligne, et l'index unique `email_outbox_tenant_idempotency_uidx` (migration:133) verrouille définitivement l'envoi. `guide_internal_notice` (aucune entité liée naturelle) est le cas typique.
- **Action :** Rendre `occurrenceKey` obligatoire dans `EnqueueEmailInput` (type + garde runtime rejetant `email_enqueue_rejected:occurrence_required`) plutôt que de retomber silencieusement sur `'default'`, ou intégrer un hash du `variablesSnapshot` dans la matière de la clé.

### SIDIAN_WHATSAPP_GUIDE_RECIPIENT_TECHNICAL_ID absent de la validation live mais fatal à l'envoi

- **Fichier :** `src/lib/communication-channels/whatsapp/env.ts:103`
- **Constat :** La liste `missing` du mode live (env.ts:103-121) contrôle ACCESS_TOKEN, PHONE_NUMBER_ID, WEBHOOK_VERIFY_TOKEN, APP_SECRET, SIDIAN_SENDER_E164 — pas GUIDE_RECIPIENT_TECHNICAL_ID (déclaré `.optional()` ligne 29). Or `processOutboundMessage` fait `const toTechnicalId = params.env.guideRecipientTechnicalId; if (!graphBody || !toTechnicalId) { finalizeFailed(..., 'validation_error', 'payload_incomplete', ...) }` (outbound/processor.ts:77-88) — échec **terminal**, pas retryable : chaque message est dead-lettered dès la première tentative. La route webhook, elle, exige bien la variable (`src/app/api/whatsapp/webhook/route.ts:52-56`), d'où une incohérence entre les deux chemins.
- **Action :** Ajouter `GUIDE_RECIPIENT_TECHNICAL_ID` à la liste `missing` du bloc `if (mode === 'live')` dans `loadWhatsAppEnv`, pour échouer au chargement de config plutôt que d'empoisonner l'outbox.

### Le webhook WhatsApp ignore les statuts de livraison quand le payload contient aussi des messages entrants

- **Fichier :** `src/app/api/whatsapp/webhook/route.ts:187`
- **Constat :** route.ts:187-216 : `if (hasInboundMessages(payload)) { ...traite l'inbound...; return Response.json(...) }` — le `return` se fait **avant** `processWhatsAppStatusWebhook` (ligne 218). Un `entry[].changes[].value` Meta peut porter simultanément `messages[]` et `statuses[]` ; dans ce cas les statuts `sent/delivered/read/failed` sont perdus définitivement, car `communication_webhook_events` n'aura enregistré aucun `dedupe_key` correspondant et Meta ne rejouera pas (HTTP 200 renvoyé).
- **Action :** Ne pas court-circuiter : exécuter `processWhatsAppStatusWebhook` puis, si `hasInboundMessages(payload)`, exécuter aussi la boucle inbound, et agréger les deux résultats dans la réponse.

### Aucune validation build/boot des variables SIDIAN_EMAIL_* et SIDIAN_WHATSAPP_* (contrairement à Stripe)

- **Fichier :** `next.config.ts:169`
- **Constat :** `next.config.ts` exécute `validateDeploymentReadiness({...})` (ligne 156) et `assertStripeBuildReadiness()` (ligne 216), qui font échouer le build si Stripe est activé sans clés cohérentes. `grep -n 'SIDIAN_EMAIL_\|SIDIAN_WHATSAPP_' next.config.ts` ne retourne rien. `loadEmailEnv` / `loadWhatsAppEnv` ne sont appelés que paresseusement : `src/lib/runtime/drains/email/from-env.ts:26`, `whatsapp/from-env.ts:32`, `src/app/api/whatsapp/webhook/route.ts:49/119/146` et `src/lib/ux/config-status.ts:41/92`. Une prod avec `SIDIAN_EMAIL_PROVIDER_ENABLED=true` et `TRANSPORT_MODE` absent déploie sans erreur, puis casse au premier tick de cron.
- **Action :** Ajouter `assertCommunicationBuildReadiness()` dans `next.config.ts` appelant les mêmes règles que `loadEmailEnv`/`loadWhatsAppEnv` (sans jamais imprimer de secret), sur le modèle de `assertStripeBuildReadiness`.

### Aucun health check des canaux : /api/health ne couvre que la base, et config-status avale les erreurs

- **Fichier :** `src/app/api/health/route.ts:19`
- **Constat :** `GET` de `/api/health` ne mesure que `checkDatabaseHealth()` (route.ts:20) — rien sur email/WhatsApp. Les seules sondes sont `probeEmail()` (src/lib/ux/config-status.ts:32) et `probeWhatsApp()` (ligne 83), qui (a) n'inspectent que l'env, sans aucun appel réseau vers Resend ou Graph, et (b) enveloppent tout dans `try { ... } catch { return {state:'unavailable', description:'On n’a pas pu vérifier ...'} }` (lignes 70-80 et 121-131) : une config invalide devient un libellé UX générique sans log ni alerte.
- **Action :** Étendre `/api/health` avec un bloc `channels: {email, whatsapp}` reflétant `mode` + `enabled` (jamais les secrets), logger l'exception via `logServerEvent('error', ...)` dans les catch de `config-status.ts`, et exposer un `/api/health/deep` (protégé CRON_SECRET) faisant un GET `graph.facebook.com/{version}/{phone_number_id}` et un ping Resend.


## Configuration, environment variables, validation, scripts, observability

### NEXT_PUBLIC_APP_URL silently defaults to http://localhost:3000, and that value is baked into customer-facing payment links

- **Fichier :** `src/config/env-public.ts:12`
- **Constat :** publicEnvSchema declares `NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000")` (env-public.ts:12) — the only var in that schema with a fail-open default. src/app/actions/clients-creances.ts:441 builds the shareable payment link as `shareUrl: \`${getPublicEnv().NEXT_PUBLIC_APP_URL}/p/${rawToken}\``, and src/app/p/[token]/authorization-reconsideration-action.ts:34 uses it the same way. The build-time guard validateDeploymentAppUrl (next.config.ts:32-77) only fires when VERCEL_ENV is "preview" or "production" (early return at l.38-40), so any non-Vercel build, self-hosted runtime, or runtime where the var is later unset emits links pointing at localhost to real payers.
- **Action :** Remove the `.default("http://localhost:3000")` from publicEnvSchema and make NEXT_PUBLIC_APP_URL required, keeping the localhost value only in .env.example. The dev experience is preserved because .env.example already sets it at line 2.

### The G1-K/G1-L auth integration tests silently self-skip under the aggregate `pnpm test`, and their fail-closed variants are not in it

- **Fichier :** `src/lib/agent/server/server.auth.integration.test.ts:48`
- **Constat :** server.auth.integration.test.ts:48 reads `const REQUIRE_AUTH = process.env.SIDIAN_G1L_REQUIRE_AUTH === "1";` and l.69-75 throws only `if (REQUIRE_AUTH && !authAvailable)`. Otherwise `probeLocalAuth()` (l.58-68) returns false on any fetch error and the suite degrades to skipped. SIDIAN_G1L_REQUIRE_AUTH=1 is set only by scripts/test-g1-l-agent-server-auth.mjs:164 (and the G1-K equivalent at scripts/test-g1-k-agent-gateway-auth.mjs:168). Neither `test:g1-k:auth` nor `test:g1-l:auth` appears in the package.json:68 aggregate, and `test:forms` is bare `vitest run`. So a CI that runs `pnpm test` reports green with the agent HTTP auth/tenant/RLS assertions never executed.
- **Action :** Include `pnpm test:g1-k:auth && pnpm test:g1-l:auth` in the release script (previous finding), or set SIDIAN_G1K_REQUIRE_AUTH=1 / SIDIAN_G1L_REQUIRE_AUTH=1 in the CI environment so the existing fail-closed branch fires.

### SIDIAN_PAYMENT_AUTHORIZATION_TOKEN_SECRET is not part of the build-time gate despite being a hard runtime dependency

- **Fichier :** `next.config.ts:156`
- **Constat :** src/config/env-server.ts:13-19 defines paymentAuthorizationTokenSecretSchema requiring >= 32 chars and rejecting values starting with "eyJ" or containing "SERVICE_ROLE", and getPaymentAuthorizationTokenSecret() (l.165-182) throws "Configuration du secret d’autorisation de paiement manquante ou invalide." when absent. .env.example:10-12 documents it as mandatory ("jamais NEXT_PUBLIC_, jamais recyclé depuis SUPABASE_SERVICE_ROLE_KEY. >= 32 caractères"). But the DeploymentReadinessInput type (next.config.ts:14-21) has no field for it and validateDeploymentReadiness never reads it. A production deploy missing it builds cleanly and fails at the first payment-authorization request.
- **Action :** Add supabasePaymentAuthorizationSecret to DeploymentReadinessInput and assert length >= 32 plus the same two anti-reuse refinements inside validateDeploymentReadiness, so the failure moves from first-payment to build time.

### Six environment variables are read from process.env but absent from .env.example

- **Fichier :** `.env.example:1`
- **Constat :** Cross-checking every `process.env.X` in src/ + next.config.ts + scripts/ against the keys in .env.example: undocumented are EMAIL_PROVIDER_API_KEY (src/config/env-server.ts:338), EMAIL_FROM_ADDRESS (env-server.ts:339), SIDIAN_ALLOW_DEV_ASSISTANT_PREVIEW (src/app/dev/assistant/page.tsx:36 and src/app/dev/workspace/page.tsx:38), SIDIAN_WHATSAPP_SIDIAN_API_TOKEN (src/lib/communication-channels/providers/whatsapp-sidian.ts:97), SIDIAN_TEST_SUPABASE_URL (scripts/lib/assert-local-supabase.mjs:151, src/lib/agent/server/server.auth.integration.test.ts:41, src/lib/agent/gateway/gateway.auth.integration.test.ts:30), SIDIAN_TEST_DATABASE_URL (scripts/lib/assert-local-postgres.mjs:131), SIDIAN_G1K_REQUIRE_AUTH / SIDIAN_G1L_REQUIRE_AUTH. Platform vars NODE_ENV, VERCEL, VERCEL_ENV, VERCEL_URL, VERCEL_BRANCH_URL are also read (13 sites for VERCEL_ENV alone) with no note that they are Vercel-injected.
- **Action :** Add a '# Variables de test local (jamais en production)' section to .env.example for SIDIAN_TEST_SUPABASE_URL, SIDIAN_TEST_DATABASE_URL, SIDIAN_G1K_REQUIRE_AUTH, SIDIAN_G1L_REQUIRE_AUTH; add SIDIAN_ALLOW_DEV_ASSISTANT_PREVIEW with an explicit 'ne jamais définir en production' warning; and a '# Injectées par Vercel — ne pas définir' comment block listing VERCEL, VERCEL_ENV, VERCEL_URL, VERCEL_BRANCH_URL. Delete EMAIL_PROVIDER_API_KEY/EMAIL_FROM_ADDRESS along with the dead code that reads them (next finding).

### Dead config getters read three env vars superseded by the SIDIAN_* runtime, and .env.example plus the deployment checklist still point at them

- **Fichier :** `src/config/env-server.ts:318`
- **Constat :** `getAiServerEnv()` (env-server.ts:318-334, reads OPENAI_API_KEY) and `getEmailServerEnv()` (l.336-353, reads EMAIL_PROVIDER_API_KEY + EMAIL_FROM_ADDRESS) have zero call sites: `grep -rn "getAiServerEnv|getEmailServerEnv" src/ scripts/ docs/` returns only the two definitions. The live paths are loadLlmEnv() (src/lib/llm/env.ts:85, SIDIAN_LLM_API_KEY) and loadEmailEnv() (src/lib/email/env.ts:67, SIDIAN_EMAIL_API_KEY/SIDIAN_EMAIL_FROM_ADDRESS). Meanwhile .env.example:48-49 keeps OPENAI_API_KEY labelled 'Legacy alias (non utilisé par le runtime typé SIDIAN_LLM_*)' — which is false, the dead getter does read it — and docs/operations/PRE_DEPLOYMENT_CHECKLIST.md lists OPENAI_API_KEY among the vars to configure.
- **Action :** Delete getAiServerEnv, getEmailServerEnv, aiServerEnvSchema and emailServerEnvSchema from src/config/env-server.ts; remove the OPENAI_API_KEY block from .env.example:48-49; and replace OPENAI_API_KEY with SIDIAN_LLM_API_KEY in PRE_DEPLOYMENT_CHECKLIST.md so operators do not provision a variable nothing consumes.

### PRE_DEPLOYMENT_CHECKLIST.md omits CRON_SECRET, the payment-token secret, the attestation vars and all three provider families

- **Fichier :** `docs/operations/PRE_DEPLOYMENT_CHECKLIST.md:1`
- **Constat :** Extracting SCREAMING_SNAKE identifiers from the checklist yields exactly: NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_SUPABASE_URL, OPENAI_API_KEY, SIDIAN_ENVIRONMENT, STRIPE_CONNECT_WEBHOOK_SECRET, STRIPE_MODE, STRIPE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STRIPE_BINDING_WRITER_JWT. `grep -c 'SIDIAN_LLM\|SIDIAN_EMAIL\|SIDIAN_WHATSAPP' docs/operations/PRE_DEPLOYMENT_CHECKLIST.md` = 0, and grep for CRON_SECRET, 'attestation', 'rotation' and 'expir' all return 0 matches. Missing from the checklist but required by .env.example and/or the build gate: CRON_SECRET, SIDIAN_PAYMENT_AUTHORIZATION_TOKEN_SECRET, SIDIAN_SUPABASE_PROJECT_REF, SUPABASE_ENVIRONMENT_ATTESTATION_JWT, NEXT_PUBLIC_APP_URL, and the 28 SIDIAN_LLM_*/SIDIAN_EMAIL_*/SIDIAN_WHATSAPP_* vars.
- **Action :** Rewrite the checklist's env section as a table generated from .env.example, one row per variable with columns: nom, obligatoire en production (oui/non/si module actif), validé au build (oui/non), conséquence si absent. That makes the CRON_SECRET and payment-secret gaps visible to the operator even before the code gate is added.

### Both operational JWTs carry an exp claim that hard-fails the app on expiry, with no expiry monitoring anywhere

- **Fichier :** `src/config/env-server.ts:235`
- **Constat :** SUPABASE_ENVIRONMENT_ATTESTATION_JWT: env-server.ts:230-238 rejects when `claims.exp <= Math.floor(Date.now() / 1000)`. src/lib/supabase/environment-attestation.ts:78-88 calls this on every non-local request, and src/proxy.ts:20-29 catches the throw and returns HTTP 503 for every `/app/*` route — a total outage. SUPABASE_STRIPE_BINDING_WRITER_JWT: env-server.ts:99-106 applies the same exp check inside getStripeReadiness(), so expiry breaks every Stripe code path. The same two checks are duplicated at build time (next.config.ts:140-148 and 202-214), meaning a redeploy after expiry also fails. No code anywhere reads these exp values for warning purposes: grep for 'expir' across src/ and docs/operations/ returns nothing.
- **Action :** Expose remaining lifetime for both JWTs in the /api/health response (decode the payload, report days-to-expiry without echoing the token), and add a scanners-cron check that emits `logServerEvent("warn", "jwt_expiring_soon", { key, daysRemaining })` under 30 days. Document the regeneration procedure in docs/operations/ — it currently exists nowhere.

### /api/health reports only database connectivity — no Stripe, cron, provider or attestation readiness

- **Fichier :** `src/app/api/health/route.ts:19`
- **Constat :** The GET handler (route.ts:19-38) returns `{ status, app, environment, database }` where database comes from checkDatabaseHealth() (src/lib/health/check-database.ts:17-51), which only does `supabase.from("prestataire").select("id").limit(0)`. It never calls getStripeReadiness(), getCronSecret(), loadEmailEnv(), loadWhatsAppEnv() or loadLlmEnv(). isHealthOperational (route.ts:9-17) even returns true for `database === "not_configured"` when environment is 'local'. There is therefore no endpoint that can answer 'is this deployment actually able to send a relance or take a payment', which is precisely the class of failure the CRON_SECRET and disabled-provider findings describe.
- **Action :** Add a separate `/api/health/ready` route (keeping /api/health as the cheap liveness probe) that reports, without leaking values: stripe (readiness.enabled + STRIPE_MODE), cron (getCronSecret() !== null), email/whatsapp/llm (resolved mode from the loadXEnv functions), and attestation JWT days-to-expiry. Return 503 when any MVP-required component is not ready.

### Per-tenant LLM quota is dead: budget_scope_key is never supplied by the production wiring

- **Fichier :** `src/lib/agent/server/auth/create-router.ts:146`
- **Constat :** src/lib/llm/env.ts:46-51 defines SIDIAN_LLM_BUDGET_MAX_REQUESTS_PER_SCOPE_PER_HOUR (default 200) and src/lib/llm/runtime.ts:152-155 calls `options.budget.consume({ scope_key: request.budget_scope_key, estimated_tokens: 200 })`. But resolve-conversational-provider.ts:38 sets `budget_scope_key: options.budget_scope_key` and create-router.ts calls `resolveConversationalLlmProvider()` with no arguments, so scope_key is always undefined. src/lib/llm/budget.ts:88 then only enforces the global per-minute counters; the per-scope hourly cap has no key to bucket on. One tenant can consume the entire process-wide budget.
- **Action :** Thread the TrustedExecutionContext tenant id into resolveConversationalLlmProvider as budget_scope_key from create-router.ts. Since the provider is constructed once per request in that file, the tenant is already available at that point.

### LLM budget tracker is process-local, so its caps do not hold across Vercel serverless instances

- **Fichier :** `src/lib/llm/budget.ts:41`
- **Constat :** createLlmBudgetTracker keeps state in two module-local `new Map<string, WindowCounter>()` (budget.ts:49-50) and its own comment at l.41-43 says: 'Compteur glissant approximatif par fenêtre fixe (minute / heure). Suffisant pour plafonner un processus Node ; pas un quota distribué.' The agent route is `export const runtime = "nodejs"` with `dynamic = "force-dynamic"` (src/app/api/agent/tools/route.ts:29-30) on Vercel, where concurrent lambda instances each get a fresh Map. The effective ceiling is therefore SIDIAN_LLM_BUDGET_MAX_REQUESTS_PER_MINUTE multiplied by the instance count, unbounded.
- **Action :** Back the budget counters with a Supabase table keyed on (scope_key, window_start) using an atomic upsert-and-increment RPC, mirroring the existing persistent quota approach validated by scripts/test-sid-sec-006.mjs ('quotas persistants Auth, callback et webhook Stripe'). Until then, treat the documented per-minute caps as advisory in the runbook.

### Three divergent environment resolvers disagree on the value for a Vercel preview deployment

- **Fichier :** `src/config/env-shared.ts:14`
- **Constat :** (1) getAppEnvironment() (env-shared.ts:14-24) returns the raw VERCEL_ENV string — 'preview' or 'production' — else 'production' when NODE_ENV is production, else 'local'. (2) getApplicationEnvironment() (env-server.ts:256-260) maps VERCEL_ENV preview -> 'staging' and ignores SIDIAN_ENVIRONMENT entirely. (3) resolveDeploymentEnvironment() in src/lib/email/env.ts:33-47 and src/lib/communication-channels/whatsapp/env.ts:52-66 prefers SIDIAN_ENVIRONMENT and only falls back to VERCEL_ENV. On a preview deploy the same runtime reports 'preview' to /api/health (route.ts:21), 'staging' to the Stripe/attestation validators, and whatever SIDIAN_ENVIRONMENT says to the email and WhatsApp loaders.
- **Action :** Keep getApplicationEnvironment() in src/config/env-server.ts as the single resolver (it is the one the build gate agrees with — next.config.ts:91-97 uses the same preview->staging mapping), have env-shared.getAppEnvironment and both resolveDeploymentEnvironment helpers delegate to it, and reduce SIDIAN_ENVIRONMENT to a value that is *asserted equal* rather than a value that is *trusted*.

### Email and WhatsApp trust SIDIAN_ENVIRONMENT over VERCEL_ENV, so a mis-set value enables stub mode outside local

- **Fichier :** `src/lib/email/env.ts:36`
- **Constat :** resolveDeploymentEnvironment returns `explicit` (SIDIAN_ENVIRONMENT) before ever consulting VERCEL_ENV (email/env.ts:36-46; identical code at whatsapp/env.ts:55-65). The stub guard at email/env.ts:79-83 is `if (mode === "stub" && deployment !== "local") throw`. So SIDIAN_ENVIRONMENT=local on a production runtime makes the stub transport legal — emails and WhatsApp messages are accepted and discarded. The only thing preventing this today is the build-time check at next.config.ts:91-97, which requires SIDIAN_ENVIRONMENT === expectedEnvironment but early-returns when VERCEL_ENV is neither preview nor production (l.82-87).
- **Action :** In both resolveDeploymentEnvironment helpers, derive from VERCEL_ENV first and treat SIDIAN_ENVIRONMENT as an assertion that must match (throw on mismatch) rather than as an override. This preserves local behaviour, where VERCEL_ENV is unset, while removing the production stub path.

### Build-time validation is entirely skipped when VERCEL_ENV is unset

- **Fichier :** `next.config.ts:38`
- **Constat :** validateDeploymentAppUrl returns immediately `if (vercelEnvironment !== "preview" && vercelEnvironment !== "production")` (l.38-40), and validateDeploymentReadiness does the same at l.82-87. Only assertStripeBuildReadiness (l.170) runs unconditionally, and even it computes deploymentEnvironment purely from VERCEL_ENV (l.185-190), defaulting to 'local' — which then only demands STRIPE_MODE=test and sk_test_/pk_test_ prefixes. A `next build` in GitHub Actions, Docker, or any non-Vercel host therefore ships with no Supabase URL/project-ref coherence check, no attestation JWT check, and no HTTPS app-URL check.
- **Action :** Introduce an explicit SIDIAN_DEPLOY_TARGET (or reuse SIDIAN_ENVIRONMENT) as the gate condition instead of VERCEL_ENV, so `SIDIAN_ENVIRONMENT=production next build` triggers the same assertions regardless of host. Keep the VERCEL_ENV mapping as the automatic default when the explicit variable is absent.

### The dev-only assistant preview routes ship in the production bundle behind an undocumented env flag

- **Fichier :** `src/app/dev/assistant/page.tsx:34`
- **Constat :** isAssistantPreviewAllowed() is `if (process.env.NODE_ENV !== "production") return true; return process.env.SIDIAN_ALLOW_DEV_ASSISTANT_PREVIEW === "1";` (dev/assistant/page.tsx:34-37), duplicated verbatim at src/app/dev/workspace/page.tsx:38. Both routes are `export const dynamic = "force-dynamic"` and are compiled into every build. The header comment at l.13 claims 'jamais exposée en production déployée', which holds only while the flag stays unset — and the flag appears nowhere in .env.example or docs/operations/, so nothing prevents an operator from setting it, and nothing detects that it has been set.
- **Action :** Gate on the resolved application environment rather than the flag: `if (getApplicationEnvironment() !== "local") notFound();`, keeping the env flag only as an additional local opt-in. Alternatively exclude src/app/dev/** from production builds. Either way, document the variable in .env.example with an explicit production warning.


## Conversation / Assistant page — non-regression baseline

### Renaming a discussion before its first persisted turn is silently discarded

- **Fichier :** `src/components/assistant/conversational-workspace.tsx:1872`
- **Constat :** `handleRenameConversation` sets `setLocalConversationTitle(next)` then `if (!activeConversationId) return;` (:1879-1880) — no PATCH is sent when the conversation row does not exist yet (reachable: an attachment-only turn shows the title bar without ever creating a server row). The displayed title is `activeHistoryTitle ?? localConversationTitle ?? derived` (:3877-3886). As soon as a real turn is persisted, `refreshConversationHistory()` (:2260) replaces the list with the server payload whose `title` is derived from the last user message (src/lib/assistant-conversations/service.ts:138-144), so `activeHistoryTitle` wins and the user's title disappears with no message. The existing test conversational-workspace.test.tsx:2000 only asserts the pre-persistence state and explicitly checks that no PATCH is sent.
- **Action :** Keep `localConversationTitle` as pending intent: in `ensureActiveConversation` (and in the `initialAction` bootstrap at :3585), once a conversation id is obtained, if `localConversationTitle` is non-null call `renameAssistantConversation(id, localConversationTitle)` before the first `refreshConversationHistory()`. Add a regression test: rename → send a text message → assert a PATCH {title} and that the title survives the history refresh.

### Attachment turns and local document commands are never persisted, leaving holes in an otherwise persisted transcript

- **Fichier :** `src/components/assistant/conversational-workspace.tsx:3059`
- **Constat :** In `handleSend`, the attachment branch (:3059-3076) and the `documentRequest` branch (:3082-3145) both `setWorkspace(...)` and `return` without calling `persistDeterministicTurn` or `runConverse`. The only writer to public.message is `persistConversationTurn` (src/lib/assistant-conversations/service.ts:270). Consequence: 'J’ai bien reçu cette facture.' and every 'Protège-les' exchange vanish on refresh, while the later text turns are persisted — the reloaded transcript shows answers whose question is missing. Attachments themselves are `persistenceStatus: "temporary"` (types.ts:76) and their blob URLs are revoked on conversation switch (:1279, :1372), so they also disappear when navigating between discussions inside the same session.
- **Action :** Call `persistDeterministicTurn(userText || "Pièce jointe : <noms>", replyText)` in both branches so the transcript stays continuous, and persist the attachment file names as message text (metadata only, no file upload needed). If keeping files ephemeral is the deliberate MVP scope, state it in the assistant reply copy instead of leaving the turn invisible after reload.

### Stop only aborts the browser fetch — the server still persists the interrupted turn and advances the draft

- **Fichier :** `src/components/assistant/conversational-workspace.tsx:2297`
- **Constat :** `handleStopGeneration` (:2297-2304) aborts the client `AbortController`; agent-client.ts:88-97 converts the abort into `{code:"ABORTED"}` and `runConverse` returns "aborted" and shows 'Génération interrompue.' (:2282) without appending the assistant message. But `POST /api/agent/tools` runs `await handler(request)` and then `await persistConversationTurn(...)` (src/app/api/agent/tools/route.ts:162-184) — aborting the browser fetch does not abort the route handler. The turn the user stopped is written to public.message and the protection draft has already advanced server-side, so the stopped answer reappears after a refresh or a conversation switch.
- **Action :** Either (a) reload the conversation messages after a voluntary abort so the UI matches the stored transcript, or (b) pass the request signal down and skip `persistConversationTurn` when `request.signal.aborted`, or (c) change the toast copy to state that the answer was interrupted on screen only and remains in the history. Add a test covering abort + reload.

### Message feedback (👍/👎 + comment) is collected and silently discarded — no backend exists

- **Fichier :** `src/components/assistant/conversational-workspace.tsx:1935`
- **Constat :** `handleMessageFeedback` (:1935-1956) only calls `setWorkspace`. Grepping `feedback` across src/lib and src/app/api returns nothing, and no migration in supabase/migrations declares any feedback column or table. `loadConversationMessages` returns only {id, role, content, createdAt, status} (src/lib/assistant-conversations/service.ts:180-186), so the feedback is lost on refresh AND on every conversation switch. types.ts:105 documents it as 'local à la session', but the UI (thumbs, active states, a comment dialog with a 500-char textarea and an 'Envoyer' button, message-hover-actions.tsx:436-499) presents it as a submitted signal.
- **Action :** Decide: either persist it (new `message_feedback` table scoped by prestataire + a PATCH on /api/assistant/conversations/[id], and rehydrate on load) or remove the comment dialog and keep only a non-committal local reaction. Do not ship an 'Envoyer' button that writes nowhere.

### Returning to a discussion loses the confirmable draft — the protection can no longer be confirmed

- **Fichier :** `src/components/assistant/conversational-workspace.tsx:1387`
- **Constat :** `handleSelectConversation` resets `setDraftSession({draftId: null, confirmationNonce: null})` (:1387) and rebuilds `{...emptyWorkspace(), messages}` (:1388-1391). The reloaded messages carry no `actions` and no `card` (service.ts:180-186), so the 'Confirmer la protection' button is gone, and `runConfirm` refuses without a nonce (:2306-2319, message 'Le brouillon n’est pas prêt pour confirmation.'). The draft still exists server-side with its conversation_id (src/lib/agent/protection-draft/supabase-repository.ts:151) and `protectionDraftApi.get` exists, but nothing calls it — only `.cancel` is used (:3743). The user must restart the entire conversation to create the protection.
- **Action :** On conversation load, call `protection.draft.get` (or a new list-by-conversation) for the selected conversation_id and rehydrate `draftSession` + `activeContext` + the confirm action when an open draft is returned. Add a test: build a draft → switch conversation → switch back → 'Confirmer la protection' is present and works.


## Documents, attachments and file storage

### No Supabase Storage bucket is declared anywhere — storage service is on, zero buckets and zero storage policies exist

- **Fichier :** `supabase/config.toml:116`
- **Constat :** `[storage] enabled = true` with `file_size_limit = "50MiB"` (lines 116-119), but every bucket declaration is commented out: `# [storage.buckets.images]` / `# public = false` / `# allowed_mime_types = [...]` (lines 121-126). `grep -rn 'storage\.\|bucket' supabase/migrations/` over all 50 migration files returns nothing — no `storage.buckets` insert, no `storage.objects` RLS policy. The only bucket-aware code in the repo is `scripts/test-user-data-isolation.mjs:304-309`, which calls `admin.storage.listBuckets()` and asserts `!(buckets ?? []).some((bucket) => bucket.public)` — a check that trivially passes because no bucket exists at all.
- **Action :** Declare a private bucket in a migration (not only in config.toml, so it exists in hosted environments): `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('documents','documents',false,20971520, array['application/pdf','image/png','image/jpeg','image/webp','image/heic','text/plain','text/csv', ...])`. Add `storage.objects` RLS policies keyed on a `prestataire_id`-prefixed path (see next finding). Keep the negative assertion in test-user-data-isolation.mjs and extend it to assert the bucket exists and is private.

### No attachment metadata table and no attachment column on any business table — a document cannot be attached to a créance as the PRD requires

- **Fichier :** `supabase/migrations/20260715120100_core_tables.sql:39`
- **Constat :** `create table public.creance (id, prestataire_id, client_payeur_id, montant, devise, origine, reference_externe, date_echeance, etat, created_at, updated_at)` (lines 39-53) — no document/attachment column. `create table public.message (id, conversation_id, emetteur, contenu, canal, actor_type, created_at)` (lines 148-157) — no attachment column. The only attachment storage in the whole schema is `agent_protection_drafts.attachments jsonb not null default '[]'::jsonb` (supabase/migrations/20260725220000_g1m_protection_drafts.sql:26), commented '-- Pièces jointes facultatives : métadonnées seules (pas d'OCR / contenu)', on a table that expires (`expires_at timestamptz not null`). docs/SIDIAN_02_PRD_V2.md:15 states 'La facture, quand elle existe, est une pièce justificative externe optionnelle rattachée à la créance'; nothing in the schema can hold that rattachement.
- **Action :** Add a `document` table: `id uuid pk, prestataire_id uuid not null references prestataire on delete restrict, creance_id uuid null references creance, conversation_id uuid null references conversation, message_id uuid null references message, storage_path text not null unique, filename text not null, content_type text not null, size_bytes bigint not null check (size_bytes between 1 and 20971520), checksum_sha256 text, created_at, deleted_at`. Enforce `storage_path like prestataire_id || '/%'` with a check constraint, enable RLS scoped to the tenant (mirroring the pattern in supabase/migrations/20260715120400_rls_policies.sql), and match `storage.objects` policies on `(storage.foldername(name))[1] = prestataire_id::text`.

### Blob-URL iframe preview has no sandbox attribute — an uploaded .html file executes script in the Sidian origin

- **Fichier :** `src/components/assistant/attachment-preview-dialog.tsx:154`
- **Constat :** `{kind === "text" && attachment.url ? (<iframe src={attachment.url} title={...} className={styles.frame} />) : null}` — no `sandbox` attribute. `attachment.url` is a `blob:` URL created by the page (`URL.createObjectURL(file)`, composer.tsx:77 and conversational-workspace.tsx:3013), so the framed document is same-origin with the app. `previewKind` routes to "text" for `attachment.type.startsWith("text/")` (line 41), and `validateDocumentFiles` accepts such a file because `classifyAttachmentVisualType` returns "text" for any `mime.startsWith("text/")` (document-attachments.ts:136) — including `text/html`. The CSP does not save it: next.config.ts:244 is `script-src 'self' 'unsafe-inline'` and line 264 explicitly allows `frame-src blob:`. Attack chain matches the product's core use case: a freelance receives 'facture.html' from a client, drops it into the composer, clicks the preview — inline script runs with access to the Sidian origin's storage and cookies.
- **Action :** Add `sandbox=""` (empty value: no allow-scripts, no allow-same-origin) to the iframe, and restrict the text preview to an explicit safe list — accept only `text/plain`, `text/markdown`, `text/csv` for the iframe path and treat every other `text/*` as unsupported. Correspondingly, replace the `mime.startsWith("text/")` catch-all in document-attachments.ts:136 with an explicit MIME allowlist.

### No MIME allowlist: file acceptance is a classification denylist that admits any text/* and any image/* type

- **Fichier :** `src/components/assistant/document-attachments.ts:103`
- **Constat :** `validateDocumentFiles` rejects a file only when `classifyAttachmentVisualType(file) === "unknown"` (lines 56-63). `classifyAttachmentVisualType` returns a category for any `mime.startsWith("image/")` (line 114), any `mime.startsWith("audio/")` (line 115), any `mime.startsWith("text/")` (line 136), and anything whose MIME merely `includes("zip")`/`includes("archive")`/`includes("compressed")` (lines 127-135). There is no positive allowlist anywhere. `IMAGE_EXTENSIONS` even includes `"svg"` (line 77). The backend counterpart is equally permissive: `content_type: z.string().min(1).max(128)` in src/lib/agent/tools/schemas/protection-draft.ts:7 accepts any string.
- **Action :** Replace the classification-based gate with an explicit allowlist checked on both MIME and extension (pdf, png, jpeg, webp, heic/heif, txt, csv, docx, xlsx), and mirror the exact same list in `allowed_mime_types` on the storage bucket and in `attachmentMetaSchema.content_type` as a `z.enum`. Reject `image/svg+xml` and `text/html` explicitly.

### 'Analyser un document' is a headline CTA for a capability that does not exist; the assistant's own next message says analysis is unavailable

- **Fichier :** `src/components/assistant/conversational-workspace.tsx:169`
- **Constat :** `WELCOME_SUGGESTIONS` includes `{ id: "add-invoice", label: "Analyser un document", action: "add_invoice" }` (lines 167-172), duplicated as a permanent composer shortcut in src/components/assistant/shortcuts.ts:50-54 and in src/components/assistant/match-welcome-quick-action.ts:22. Selecting it produces 'Importe ta facture avec le sélecteur de fichiers...' (line 3381), and the moment a file is attached the reply is 'La lecture automatique des documents sera bientôt disponible.' (document-attachments.ts:288, 298, and buildResolvedDocumentReply's 'La lecture automatique n'est pas disponible : je ne déduirai aucune donnée du document' at conversational-workspace.tsx:3103). The label promises analysis, the product answers that analysis does not exist, and the file is then discarded.
- **Action :** Rename the CTA to what the product actually does — e.g. 'Joindre un document' or 'Protéger une facture reçue' — in all three declaration sites (conversational-workspace.tsx:169, shortcuts.ts:52, match-welcome-quick-action.ts:22) and update the assertions in assistant-redesign.test.tsx:137 and match-welcome-quick-action.test.ts:31. Reintroduce 'Analyser' only when extraction actually ships.

### The assistant confirms receipt ('J'ai bien reçu cette facture') of a file that is never sent to any server

- **Fichier :** `src/components/assistant/document-attachments.ts:283`
- **Constat :** `buildAttachmentReceiptReply` returns 'J'ai bien reçu cette facture.' (line 288), 'J'ai bien reçu ce document.' (line 296), 'J'ai bien reçu votre fichier audio.' (line 308), etc. At the moment this string is produced the file exists only as an in-memory `File` plus a blob URL (conversational-workspace.tsx:3011-3040), no network request carrying the bytes is made anywhere in the codebase (no API route accepts multipart; `grep -rn 'FormData' src/` returns only text-only server-action forms), and the turn is not even written to `public.message` (see P0 finding). 'Reçu' is factually false from the user's standpoint: nothing was received by Sidian.
- **Action :** Until storage exists, state the actual scope honestly, e.g. 'J'ai ce document sous les yeux pour cette conversation — il n'est pas encore conservé.' Once storage exists, emit 'J'ai bien reçu' only after the upload has been confirmed persisted, and surface a visible failure state when the upload fails.

### The 20 MB size limit is enforced only in the browser, and three different limits disagree

- **Fichier :** `src/components/assistant/document-attachments.ts:24`
- **Constat :** `export const MAX_DOCUMENT_FILE_SIZE = 20 * 1024 * 1024;` enforced client-side at line 48 with the French message 'dépasse la limite de 20 Mo'. The agent tool schema allows `size_bytes: z.number().int().nonnegative().max(50_000_000)` (src/lib/agent/tools/schemas/protection-draft.ts:8) and `mergeAttachments` clamps to `Math.min(a.size_bytes, 50_000_000)` (src/lib/agent/protection-draft/fields.ts:249). `supabase/config.toml:119` sets `file_size_limit = "50MiB"`. Three values (20 MB / 50 000 000 / 50 MiB) for the same concept, and the only one a client cannot bypass — the server-side one — does not exist because there is no upload endpoint.
- **Action :** Pick one number, define it in a single shared constant, and enforce it in four places: the client validator, the storage bucket `file_size_limit`, the `document.size_bytes` check constraint, and the signed-upload issuance path. Note that `src/lib/agent/server/limits.ts:10` documents `max_body_bytes: 256 KiB — arguments outil, pas d'upload`, so uploads must not route through the agent tools endpoint.

### attachment_id is an unvalidated client-supplied opaque string with no storage backing — no server-side existence or ownership check is possible

- **Fichier :** `src/lib/agent/tools/schemas/protection-draft.ts:8`
- **Constat :** `attachment_id: z.string().min(1).max(128)` — a free-form string. `mergeAttachments` truncates it (`a.attachment_id.slice(0, 128)`, fields.ts:250) and stores it verbatim; nothing anywhere resolves it to a file, checks that it exists, or checks that it belongs to the calling tenant. `filename` (max 255) and `content_type` (max 128) are likewise stored raw into `agent_protection_drafts.attachments`. Since `/api/agent/tools` is browser-reachable, any authenticated user can write arbitrary filenames/content types into their draft's attachment list today.
- **Action :** Once the `document` table exists, type this as `z.string().uuid()` and have the executor verify `select 1 from document where id = $1 and prestataire_id = <trusted tenant_id> and deleted_at is null` before merging. Derive `filename`/`content_type`/`size_bytes` from the `document` row server-side rather than trusting the client-supplied values.

### No signed-upload or signed-download path exists; a sent attachment can never be re-opened

- **Fichier :** `src/components/assistant/message-thread.tsx:285`
- **Constat :** `MessageAttachments` renders a preview trigger passing `url: file.previewUrl, source: file.previewSource` (lines 285-292). `previewSource` is typed `File` and documented 'Fichier local conservé pour le rendu PDF — session courante uniquement' (types.ts:79-80); `previewUrl` is a blob URL revoked by `revokeAttachmentPreviews()` on conversation switch and unmount (conversational-workspace.tsx:1015-1022, 1372). `grep -rniE 'createSignedUrl|getPublicUrl|signedUrl|\.storage\b' src/` returns nothing. There is also no download control anywhere — `grep -rn 'download' src/components/assistant/*.tsx` returns nothing. After any reload or conversation switch the attachment is unrecoverable, and `AttachmentPreviewDialog` would fall through to 'Aperçu indisponible' (attachment-preview-dialog.tsx:161-167) if a metadata-only attachment ever survived.
- **Action :** Implement a two-step flow: (1) POST /api/documents returning a Supabase `createSignedUploadUrl` for path `<prestataire_id>/<document_id>/<sanitised-filename>` after inserting the `document` row; (2) GET /api/documents/[id] returning a short-TTL `createSignedUrl` after an RLS-backed ownership check. Add an explicit download control to `MessageAttachments` and make `AttachmentPreviewDialog` fetch via the signed URL when `previewSource` is absent.

### Permissions-Policy 'microphone=()' blocks the composer's dictation button on every route

- **Fichier :** `next.config.ts:283`
- **Constat :** `{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" }` is applied to `source: "/:path*"` (next.config.ts:335-337), i.e. every page including /app/assistant. `composer.tsx:405-442` builds a `SpeechRecognition`/`webkitSpeechRecognition` instance with `recognition.lang = "fr-FR"` and calls `recognition.start()`; the microphone permission policy gates that API in Chromium. The result is that `recognition.onerror` fires and the user always sees `DICTATION_ERROR_MESSAGE` ('La dictée n'a pas pu démarrer. Vérifiez l'accès au micro…', composer.tsx:46-47) — the button is permanently broken while still being rendered enabled whenever `speechSupported` is true (line 262).
- **Action :** Either allow `microphone=(self)` in the Permissions-Policy for the app routes and keep dictation, or remove the dictation button. Note the privacy implication before choosing: `webkitSpeechRecognition` streams captured audio to the browser vendor's cloud service, which is an undisclosed third-party processor for a French product subject to RGPD — that disclosure must exist before enabling it.

### Zero audio transcription, OCR, image analysis or document parsing exists — every capability is a 'bientôt disponible' template

- **Fichier :** `src/components/assistant/document-attachments.ts:240`
- **Constat :** `availabilityForGroup` returns 'La transcription automatique sera bientôt disponible.' / 'L'analyse visuelle sera bientôt disponible.' / 'La lecture automatique sera bientôt disponible.' (lines 247-256), and per-category replies repeat this at lines 288, 298, 304, 310, 316, 323. `invoice-attachment.ts:1-4` states the header contract explicitly: 'Heuristique UI : … Pas d'OCR — uniquement type MIME + nom de fichier.' The invoice verdict is derived purely from a filename regex `/\b(facture|invoice|receipt|reçu|avoir|devis|bill|proforma)\b/i` (line 12) and a MIME set (lines 20-28). No OCR, PDF-text, docx, xlsx, audio or vision dependency exists in package.json (`grep -rniE 'tesseract|mammoth|xlsx|sharp' package.json` returns nothing; `pdfjs-dist` is rendering-only).
- **Action :** This is a scope decision, not a bug — but the templates must stop being emitted from a CTA labelled 'Analyser'. If extraction is in MVP scope, the missing pieces are: a server-side PDF text layer extractor, an OCR fallback for scanned images, and a structured-extraction pass feeding the existing `protection.draft` field-provenance model as `agent_proposed` (never `confirmed`), which AGENTS.md §sécurité already requires.


## Security, RLS, multi-tenant isolation

### RLS drift detector covers only 19 of 34 tables — 15 tables can lose RLS silently

- **Fichier :** `supabase/migrations/20260729120200_user_data_isolation_rls_inventory_complete.sql:17`
- **Constat :** `sidian_assert_rls_enabled()` hardcodes an `in (...)` list of 19 table names (prestataire … public_rate_limit_event). I enumerated `create table` across all 50 migrations and found 34 tables. The 15 not covered by the guard: agent_audit_events, agent_human_approvals, agent_idempotency_records, agent_protection_drafts, communication_channel, communication_inbound_messages, communication_interaction_sessions, communication_messages, communication_webhook_events, email_outbox, guide_payment_confirmation_state, payment_execution_job, payment_reconciliation_issue, runtime_job, runtime_scan_lease. scripts/test-schema-rls.mjs:27-45 has the same gap — its EXPECTED_RLS_TABLES lists 19 names. All 34 currently DO have RLS enabled (verified via `alter table ... enable row level security` grep), so this is a detection gap, not a live hole: the next migration that adds a table, or any `alter table ... disable row level security`, on any of those 15 passes CI unnoticed.
- **Action :** Replace the hardcoded `in (...)` list with a negative assertion: return every `pg_class` row where `relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`, and have scripts/test-schema-rls.mjs fail if that set is non-empty. That makes the check correct-by-construction for future tables instead of requiring the list to be maintained.

### Production CSP allows script-src 'unsafe-inline' with no nonce

- **Fichier :** `next.config.ts:244`
- **Constat :** `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}` — `'unsafe-inline'` is unconditional, present in production. The only inline script in the app is the theme anti-flash script at src/app/layout.tsx:53 (`<script>{THEME_INIT_SCRIPT}</script>`), a repo constant with no interpolation. So `'unsafe-inline'` buys exactly one script and disables CSP's entire XSS mitigation for the rest of the app, including the assistant surface that renders agent- and user-authored text.
- **Action :** Generate a per-request nonce in src/proxy.ts (which already mints and injects `x-sidian-request-id` on every request), pass it via request header to the root layout, set `nonce={nonce}` on the theme script, and emit the CSP from the proxy as `script-src 'self' 'nonce-<value>' 'strict-dynamic'`. Keep the next.config.ts header as the static fallback for routes the proxy does not touch.

### LLM budget is a process-local in-memory counter — no real quota on the agent endpoint

- **Fichier :** `src/lib/llm/budget.ts:44`
- **Constat :** `createLlmBudgetTracker` builds `const minute = new Map(); const hour = new Map();` inside the module, with the comment at line 43-44: "Suffisant pour plafonner un processus Node ; pas un quota distribué." `SIDIAN_LLM_BUDGET_MAX_REQUESTS_PER_SCOPE_PER_HOUR` (default 200, src/lib/llm/env.ts:46-51) is enforced only against that Map. On Vercel each lambda instance holds its own Map, and instances scale with concurrency. Separately, src/app/api/agent/tools/route.ts has no rate-limit call at all — I grepped src/lib/agent/ for rate limiting and the only hit is a Supabase error-code string match in supabase-auth-principal-resolver.ts:108. src/lib/agent/server/route-handler.ts `limits` are timeouts (gateway_timeout_ms, router_timeout_ms, total_timeout_ms), not quotas.
- **Action :** Add `agent_tools_tenant` and `agent_tools_ip` categories to `public_rate_limit_category` and to `consume_public_rate_limit`, and call `evaluatePersistentRateLimits` in src/app/api/agent/tools/route.ts POST after `resolveAssistantConversationRequestContext()` resolves the tenant — the same fail-closed pattern already used in src/app/auth/callback/route.ts:33-40. The Postgres-backed limiter is shared across lambdas; the in-memory tracker should stay only as a per-process circuit breaker.

### Deployment attestation and readiness gates all key off VERCEL_ENV and silently degrade to 'local'

- **Fichier :** `src/config/env-server.ts:256`
- **Constat :** `getApplicationEnvironment()` returns "production" only if `VERCEL_ENV === "production"`, "staging" only if `"preview"`, and otherwise "local" — it ignores `NODE_ENV` and `SIDIAN_ENVIRONMENT` entirely. src/lib/supabase/environment-attestation.ts:78 then does `if (getApplicationEnvironment() === "local") return;`, so the whole cryptographic project-attestation (the guard that stops a production build from talking to the wrong Supabase project) is a no-op. next.config.ts:82-87 `validateDeploymentReadiness` likewise returns early when `vercelEnvironment` is neither preview nor production, skipping the HTTPS app-URL check, the Supabase project-ref match, and the attestation-JWT expiry check. src/lib/supabase/auth-response.ts:18-19 sets cookie `secure` only for `preview`/`production` VERCEL_ENV. There is no runtime assertion anywhere that a build declaring `SIDIAN_ENVIRONMENT=production` is actually running with VERCEL_ENV set.
- **Action :** Make the environment resolution fail-closed: if `SIDIAN_ENVIRONMENT` is 'staging' or 'production' but `VERCEL_ENV` is unset, throw at module load rather than returning 'local'. Alternatively derive from `SIDIAN_ENVIRONMENT` as the primary source and use `VERCEL_ENV` only to cross-check, keeping the existing mismatch error at next.config.ts:93-97.

### No rate limiting on /api/agent/tools, /api/assistant/*, or the WhatsApp webhook

- **Fichier :** `src/lib/security/rate-limit.ts:10`
- **Constat :** `PERSISTENT_RATE_LIMIT_CATEGORIES` enumerates 15 categories covering public payment links (link_resolution_*, checkout_*), the five auth operations, and stripe_webhook_ip. Nothing covers the authenticated API surface. Confirmed by reading the routes: src/app/api/agent/tools/route.ts, src/app/api/assistant/conversations/route.ts, src/app/api/assistant/conversations/[id]/route.ts, src/app/api/assistant/projects/route.ts and .../[id]/route.ts contain no rate-limit call. src/app/api/whatsapp/webhook/route.ts POST goes straight from `loadWhatsAppEnv()` to `getDeps()` to signature verification with no quota — contrast src/app/api/stripe/webhook/route.ts:52-66 which calls `evaluateStripeWebhookRateLimit` before reading the body. The WhatsApp route also lacks the `assertDeclaredBodyLengthIsBounded(request.headers)` content-length pre-check that the Stripe route does at line 50; it only bounds the stream at 512 KB while reading.
- **Action :** Add `whatsapp_webhook_ip` to the category enum and call it in the WhatsApp POST before `getDeps()`, mirroring the Stripe route's fail-closed 503-on-unavailable handling; add the content-length pre-check. Add tenant-scoped categories for the assistant CRUD routes.

### HSTS lacks includeSubDomains and preload

- **Fichier :** `next.config.ts:280`
- **Constat :** `{ key: "Strict-Transport-Security", value: "max-age=31536000" }` — one year max-age, but no `includeSubDomains` and no `preload`. A subdomain of the production apex (a marketing site, a status page, an abandoned CNAME) can therefore be served over plain HTTP and set or read cookies scoped to the parent domain. This matters more than usual here because src/lib/supabase/auth-response.ts:14 sets the auth cookie with `path: "/"` and `sameSite: "lax"` with no `__Host-` prefix and no explicit Domain restriction.
- **Action :** Change to `max-age=63072000; includeSubDomains; preload` once every subdomain of the production apex is confirmed HTTPS-only, then submit to hstspreload.org.


## Stripe integration and Sidian subscription plans

### Le prélèvement automatique est débranché : le scanner auto_pay n'alimente jamais payment_execution_job

- **Fichier :** `src/lib/runtime/scanners/auto-pay.ts:14-18`
- **Constat :** `runAutoPayScanner` appelle `runScannerBatch({ scannerKind: "auto_pay" })` qui enqueue un `runtime_job` de kind `autopay_intent` (SCANNER_TO_JOB_KIND, src/lib/runtime/workflow-policy.ts:128). Grep `autopay_intent` sur tout src/ ne renvoie que ces deux déclarations : aucun consommateur. Les drains actifs (src/lib/runtime/drains/inventory.ts) sont whatsapp_outbound, email_outbound, payment_connect_audit et notification (not_in_mvp) — aucun ne lit `runtime_job`. `enqueueAutomaticPaymentCandidates` (src/lib/runtime/payments/scanner.ts:27) n'est appelé que depuis service.test.ts:185. `payment_execution_job` n'est donc alimenté que par l'outil agent `payment.create_attempt` (src/lib/agent/server/auth/create-router.ts:170).
- **Action :** Ajouter un pont explicite : soit un drain `runtime_job(autopay_intent)` → `enqueueAutomaticPaymentCandidates`, soit faire enqueuer directement le job paiement par `runAutoPayScanner`. Couvrir par un test d'intégration cron → job → drain.

### Les autorisations SEPA peuvent devenir ACTIVE mais ne seront jamais exécutées

- **Fichier :** `src/lib/runtime/payments/checklist.ts:155-162`
- **Constat :** La Checkout Session `mode: setup` propose tous les rails actifs du compte, `sepa_debit` inclus (src/lib/stripe/authorizations/create-setup-session.ts:113 et :662 `payment_method_types: paymentMethodTypes(rails)`), et `handleSetupIntentSucceededAuthorization` valide un mandat multi_use actif puis active l'autorisation (src/lib/stripe/webhooks/authorization-effects.ts:219-263). Mais la checklist refuse ensuite tout `auth.type === "sepa_core_mandate"` avec `SEPA_PRENOTIFICATION_REQUIRED`, et `createOffSessionCardPaymentIntent` impose `payment_method_types: ["card"]` (src/lib/runtime/payments/stripe-off-session.ts:42).
- **Action :** Soit retirer `sepa_debit` des `payment_method_types` de la Session setup tant que la prénotification (03 §5.3, `[VALIDATION RESTANTE]`) n'est pas validée, soit implémenter la prénotification + un exécuteur off-session SEPA. Ne pas laisser un client signer un mandat inutilisable.

### Aucune révocation de lien de paiement exposée au produit alors que la RPC existe

- **Fichier :** `src/lib/stripe/customers/bindings.ts:153-166`
- **Constat :** `revokePaymentLink()` appelle la RPC `revoke_payment_link`, mais grep sur src/ ne trouve aucun appelant hors ce fichier (ni index.ts, ni server action, ni page). docs/SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md:223 et :227 décrivent pourtant l'état `revoked` et la rotation irréversible comme une propriété de sécurité du lien opaque. Un token `/p/<token>` divulgué ne peut donc pas être neutralisé par le prestataire.
- **Action :** Exposer une server action « Révoquer le lien » sur la page paiement à recevoir (avec confirmation), appelant `revokePaymentLink` sous RLS puis proposant la re-préparation d'un nouveau token via `open_payment_receivable`.

### L'expiration du JWT writer coupe tout le module Stripe et fait échouer le webhook en 500 non capturé

- **Fichier :** `src/app/api/stripe/webhook/route.ts:42`
- **Constat :** `if (!isStripePaymentsEnabled())` est appelé AVANT le `try {` de la ligne 48. `isStripePaymentsEnabled()` (src/config/env-server.ts:310-312) délègue à `getStripeReadiness()` → `validateStripeEnvironment`, qui LÈVE `new Error("Configuration Stripe manquante ou invalide.")` dès que `writerClaims.exp <= Math.floor(Date.now()/1000)` (src/config/env-server.ts:100-106). Le JWT `SUPABASE_STRIPE_BINDING_WRITER_JWT` porte donc une bombe à retardement : à son expiration, tous les webhooks Stripe renvoient une 500 non journalisée par `logServerEvent`, et /p/[token], pay-action et les actions d'autorisation deviennent indisponibles. Aucun test ne couvre le cas `exp` dépassé (src/config/env-stripe.test.ts:5-13 génère toujours `exp: now + 3600`).
- **Action :** Déplacer l'appel dans le `try`, distinguer « désactivé » (404) de « configuration invalide » (503 + log `stripe.config_invalid`), ajouter un test avec `exp` passé, et surveiller la date d'expiration du writer JWT (alerte à J-30) ou basculer sur un JWT sans `exp` court avec rotation planifiée.

### `ensureStripeCustomerForClient` avale toute erreur de relecture et crée un Customer doublon qui orpheline les autorisations actives

- **Fichier :** `src/lib/stripe/customers/ensure-customer.ts:84`
- **Constat :** Après avoir trouvé un binding actif, le code fait `stripe.customers.retrieve(...)` dans un `try` dont le `catch {}` (ligne 84) est vide — il n'inspecte ni le type d'erreur ni sa disposition. Une indisponibilité réseau/API transitoire (StripeAPIError, StripeConnectionError) tombe donc dans le chemin `stripe.customers.create(...)` (ligne 86, sans idempotencyKey), puis `bindStripeCustomerForConnectedAccount` remplace le binding (l'ancien passe `superseded`). Les `payment_authorization` ACTIVE référencent toujours `stripe_customer_id` de l'ancien Customer, ainsi que les PaymentMethods/mandats qui y sont attachés.
- **Action :** Classer l'erreur avec `classifyStripeFailure` : sur `retryable`, propager une `StripeDomainError` retryable (le claim checkout sera libéré et la tentative rejouée) ; ne créer un nouveau Customer que si l'erreur est terminale de type resource_missing. Ajouter un `idempotencyKey` dérivé du claim sur `customers.create`.

### L'expiration d'une Session Checkout dépend uniquement du webhook — aucune reprise locale par TTL

- **Fichier :** `supabase/migrations/20260721210600_sid_stripe_003_checkout_expiry_projection.sql:8`
- **Constat :** `apply_checkout_session_expired_payment` n'est appelable que depuis `handleCheckoutSessionExpiredPayment` (src/lib/stripe/webhooks/payment-effects.ts:155-172). Aucun job cron ne balaie `tentative_paiement.session_expires_at` : les crons déclarés sont uniquement `/api/cron/scanners` et `/api/cron/drains` (vercel.json). Or `resolve_payment_link_by_token_hash` renvoie `pending_payment` tant qu'une tentative est non terminale, ce qui rend le lien non payable (src/lib/stripe/checkout/create-payment-session.ts:297-301, `reason: "pending_payment"`). Si `checkout.session.expired` n'est pas abonné, échoue 8 fois (STRIPE_WEBHOOK_MAX_ATTEMPTS, process.ts:19) ou arrive après la fenêtre de retries Stripe, le paiement à recevoir reste bloqué ; le seul recours est le bouton de réconciliation manuelle.
- **Action :** Ajouter un balayage cron (ou l'intégrer à /api/cron/drains) qui, pour toute tentative `CREEE` dont `session_expires_at < now() - marge`, relit la Session dans le compte Connect et applique l'expiration via une primitive dédiée ; et vérifier explicitement en pré-déploiement que les 11 événements sont abonnés sur l'endpoint Connect.

### `purge_expired_public_rate_limits` n'est jamais appelée — croissance non bornée de public_rate_limit_event

- **Fichier :** `supabase/migrations/20260726170000_sid_stripe_002_a_purge_expired_rate_limits.sql:16`
- **Constat :** La fonction est créée (et regrantée à service_role ligne 56) mais grep `purge_expired` sur src/ ne renvoie que src/types/database.generated.ts:3128 (le type généré). Aucun cron, aucune route, aucun drain ne l'invoque. `consume_public_rate_limit` ne supprime que les lignes du couple (category, subject_hash) courant (20260721200100:82-86), donc les sujets inactifs ne sont jamais nettoyés. Chaque affichage de page /p consomme 2 lignes (link_resolution_ip + link_resolution_token) avec des fenêtres de 10 minutes.
- **Action :** Ajouter l'appel `purge_expired_public_rate_limits(batch, now)` en fin de `runScheduledDrains` (src/lib/runtime/cron/run-drains.ts) ou dans un cron dédié quotidien, avec une boucle bornée par le soft-deadline.


## Theming

### theme_preference migration is untracked in git and has zero consumers

- **Fichier :** `supabase/migrations/20260803120000_theme_preference.sql`
- **Constat :** `git status --porcelain supabase/migrations/` reports `?? supabase/migrations/20260803120000_theme_preference.sql` — the file is untracked, so it would not deploy. It creates `public.theme_preference` enum ('light','dark','system'), adds `prestataire.theme_preference not null default 'light'` (line 17), extends `protect_prestataire_sensitive_columns()` to block direct PostgREST writes (line 41), and exposes `set_current_prestataire_theme_preference(p_theme)` granted only to `authenticated` (lines 56-98). `grep -rn "theme_preference|themePreference|set_current_prestataire_theme" src/` returns nothing.
- **Action :** Commit the migration, run the Supabase type generation so `theme_preference` and the RPC appear in `src/types/database.generated.ts`, then wire a read path and a write path (see the two following findings). Validate locally with `npx supabase@2.109.1` per the recorded CLI-version constraint.

### Profile read path does not select theme_preference, so the server cannot render the user's theme

- **Fichier :** `src/lib/profile/profile-core.ts:16`
- **Constat :** `const PROFILE_COLUMNS = "id, nom, email, profil_agent_defaut, onboarding_profile_completed_at";` and `PrestataireProfile` (lines 6-13) is a `Pick<>` over the same five columns. Nothing in `src/lib/profile/` mentions theme.
- **Action :** Add `theme_preference` to `PROFILE_COLUMNS` and to the `Pick<>` in `PrestataireProfile`. Read it in the authenticated layout/server component so `data-theme` can be stamped on `<html>` server-side, eliminating a flash for logged-in users.

### No write path for the theme RPC — no server action calls set_current_prestataire_theme_preference

- **Fichier :** `src/lib/profile/profile-core.ts:33`
- **Constat :** `configureCurrentPrestataireProfile` calls `supabase.rpc("configure_current_prestataire_profile", { p_nom, p_profil_agent })` — the only profile RPC wired. The migration's `set_current_prestataire_theme_preference` (migration line 56) has no caller: `grep -rn set_current_prestataire_theme src/` is empty. The migration deliberately blocks direct UPDATE (line 41), so a plain PostgREST write will raise `42501`.
- **Action :** Add `setCurrentPrestataireThemePreference(supabase, theme)` in `src/lib/profile/profile-core.ts` calling the RPC, a zod enum `'light'|'dark'|'system'` in `src/lib/profile/schemas.ts`, and a server action alongside `configureProfileAction` in `src/app/actions/profile.ts`.

### No theme control in the Paramètres UI

- **Fichier :** `src/app/app/parametres/page.tsx:32`
- **Constat :** The page renders exactly three blocks: `<ProfileForm>` (nom + profilAgent), `<ConfigStatusList>` and an 'Adresse du compte' panel. `grep -niE "thème|theme|apparence|sombre|clair|automatique" src/app/app/parametres/page.tsx` returns nothing.
- **Action :** Add a `WorkspacePanel` titled « Apparence » with a three-way segmented control (Clair / Sombre / Automatique) posting to the new server action, plus optimistic `document.documentElement.dataset.theme` update so the switch is instant.

### No data-theme on <html>, no no-flash script, no suppressHydrationWarning in the root layout

- **Fichier :** `src/app/layout.tsx:22`
- **Constat :** `<html lang="fr" className={`${outfit.variable} h-full antialiased`}>` and `<body className="min-h-full flex flex-col font-sans">` — 26 lines total, no `<script>`, no `data-theme`, no `suppressHydrationWarning`. `grep -rn 'prefers-color-scheme' src/` returns nothing.
- **Action :** Stamp `data-theme` on `<html>` from the server-read preference; add `suppressHydrationWarning` to `<html>`; inject a synchronous inline `<script>` in `<head>` that reads the persisted preference (cookie preferred over localStorage so SSR matches) and, when it is 'system', resolves `window.matchMedia('(prefers-color-scheme: dark)')` before first paint. The CSP already permits this — `next.config.ts` sets `script-src 'self' 'unsafe-inline'` — so no nonce plumbing is required.

### body background and shell background resolve to different tokens — visible mismatch under dark

- **Fichier :** `src/app/globals.css:289`
- **Constat :** `body { background: var(--background); ... }` where `--background: var(--ds-color-surface)` (globals.css:41 → #ffffff). But `src/components/app/app-shell.module.css:5` uses `background: var(--ds-color-background)` (#f7f8fb). Under `.agentDark` these become #14161b vs #0b0c0f — a lighter band visible on overscroll and outside the shell.
- **Action :** Point `--background` at `--ds-color-background` (not `--ds-color-surface`) and set the same on `html`, so overscroll and any area outside `.shell` matches the app canvas in both themes.

### tokens.css hardcodes color-scheme: light at :root with no dark override

- **Fichier :** `src/design-system/tokens.css:11`
- **Constat :** `:root { color-scheme: light; ... }`. The only `color-scheme: dark` declarations are scoped to component classes: `src/components/app/app-shell.module.css:9`, `src/components/assistant/attachment-preview-dialog.module.css:2`, `src/components/assistant/message-suggestions.module.css:27`.
- **Action :** Make `color-scheme` theme-driven: `:root[data-theme="dark"] { color-scheme: dark; }` and `:root[data-theme="light"] { color-scheme: light; }`. This also fixes native form controls, scrollbars and `<input type=date>` pickers, which currently render light-chrome inside the agent-dark workspace.

### The complete dark palette already exists but is trapped in a component-scoped CSS module class

- **Fichier :** `src/components/app/app-shell.module.css:8`
- **Constat :** `.agentDark` (lines 8-58) overrides all 35 colour custom properties declared in `tokens.css:14-60` — background #0b0c0f, surface #14161b, surface-raised #1a1d24, surface-muted #22262f, border #2c313c, border-strong #3d4554, text-primary #f4f6fa, text-secondary #a7b0bf, text-muted #7d8696, text-inverse #0b0c0f, brand/accent/accent-hover/pressed/soft/soft-hover/border, the 9 success/warning/danger surface+border triples, info triple, hover/pressed/disabled-surface/disabled-text, focus-ring, overlay — plus `--ds-shadow-xs/sm/md/lg` and `--sidian-aurora-a/b/c`. It is applied only via `cx(..., isAgentDark && styles.agentDark)` at `src/components/app/app-shell.tsx:165`.
- **Action :** Lift this block verbatim into `src/design-system/tokens.css` under `:root[data-theme="dark"]`, keep `.agentDark` as a thin alias (or delete it and pass `data-theme="dark"` from the shell). This single move gives dark mode to every `*.module.css` in the repo for free, since all of them consume only `--ds-*` tokens.

### 27 literal colour values in globals.css have no dark counterpart anywhere

- **Fichier :** `src/app/globals.css:13`
- **Constat :** Aliased-and-therefore-dark-safe: `--sidian-nuit`→`--ds-color-text-primary` (:12), `--sidian-brume`→accent-soft (:18), `--sidian-gris-50/100/200/300/500/600`→background/surface-muted/border/border-strong/text-muted/text-secondary (:21-27), `--background`/`--surface` (:41,43), `--surface-elevated` (:46), `--text-inverse` (:54). NOT aliased (raw literals, no dark value): `--sidian-ardoise: #1d2535` (:13), `--sidian-blue: #3b6df8` (:14), `--sidian-blue-hover: #315fd9` (:15), `--sidian-blue-active: #2a52c4` (:16), `--sidian-ciel: #6b96fa` (:17), `--sidian-gris-400: #9aa1ae` (:25), `--sidian-success: #059669` (:30), `--sidian-success-bg: #ecfdf3` (:31), `--sidian-success-border: #a7f3d0` (:32), `--sidian-warning: #d97706` (:33), `--sidian-warning-bg: #fffaeb` (:34), `--sidian-warning-border: #fde68a` (:35), `--sidian-danger: #dc2626` (:36), `--sidian-danger-bg: #fef3f2` (:37), `--sidian-danger-border: #fecaca` (:38), `--sidian-shadow-sm/card/float` rgba(13,17,23,…) (:73-75), and the `--assistant-*` literals (:166,171-174,177,178,180).
- **Action :** Re-alias every one of these onto its `--ds-*` equivalent so a single dark override drives them: `--sidian-success`→`--ds-color-success`, `--sidian-success-bg`→`--ds-color-success-surface`, `--sidian-success-border`→`--ds-color-success-border`, same for warning/danger; `--sidian-gris-400`→`--ds-color-disabled-text`; `--sidian-ciel`→`--ds-color-accent` (dark) per the design system; `--sidian-shadow-sm/card/float`→`--ds-shadow-xs/sm/lg`. Delete the `--assistant-*` block (see dead-token finding).

### Semantic status tokens keep their light tinted backgrounds in dark, which the design system explicitly forbids

- **Fichier :** `src/app/globals.css:31`
- **Constat :** `--sidian-success-bg: #ecfdf3` (:31), `--sidian-warning-bg: #fffaeb` (:34), `--sidian-danger-bg: #fef3f2` (:37). `docs/SIDIAN_DESIGN_SYSTEM.md:143` states: « Les fonds teintés light (`#ECFDF3`, `#FFFAEB`, `#FEF3F2`) ne doivent pas être réutilisés tels quels en dark mode. Utiliser des versions sombres teintées. » Correct dark values already exist unused at `src/components/app/app-shell.module.css:28,31,34`: success-surface #1c342b, warning-surface #392f20, danger-surface #3a2425.
- **Action :** Alias `--sidian-*-bg` and `--sidian-*-border` onto `--ds-color-*-surface` / `--ds-color-*-border`. Consumers today are `src/components/auth/auth-banner.tsx:7-8` (`border-danger-border bg-danger-bg text-danger`, `border-success-border bg-success-bg text-success`).

### 93 raw Tailwind palette utilities across 23 files bypass the token layer entirely

- **Fichier :** `src/components/app/stripe-connect-panel.tsx:35`
- **Constat :** Verified by regex over non-test `*.tsx`. Worst offenders: `stripe-connect-panel.tsx` (17 — lines 35,58,81,96,120,135,136,143,158,159,193,199,217,303,318,328,340); `src/app/app/paiements-a-recevoir/[id]/page.tsx` (8 — 93,110,141,145,152,154,156,183); `dashboard-deadlines.tsx` (6 — 20,24,32,43,108,126); `follow-up-controls.tsx` (5 — 34,126,145,162,168); `dashboard-actions.tsx` (5 — 15,32,42,59,60); `dashboard-portfolio.tsx` (4 — 19,72,73,76); `src/app/app/approbations/page.tsx` (4 — 51,57,71,110); `dashboard-summary.tsx` (3 — 14,27,41); `src/app/app/demarrage/page.tsx` (3 — 63,112,118); `src/app/p/retour/authorization-proposal.tsx` (3 — 102,112,118); `approval-decision.tsx` (2 — 28,46); `src/app/p/[token]/pay-button.tsx` (2 — 82,87); and one each in `auth-shell.tsx:25`, `cancel-receivable-button.tsx:42`, `src/app/page.tsx:10`, `src/app/p/retour/recheck-button.tsx:26`, `src/app/p/public-payment-shell.tsx:14`, `src/app/p/error.tsx:25`, `src/app/p/autorisation/retour/recheck-authorization-button.tsx:14`, `src/app/p/autorisation/retour/page.tsx:15`, `src/app/p/autorisation/annulation/page.tsx:7`, `src/app/p/annule/resume-payment-link.tsx:53`, `src/app/p/[token]/authorization-reconsideration.tsx:45`.
- **Action :** Mechanical substitution: `bg-white`→`bg-surface`; `text-white` on coloured CTAs→`text-ds-text-inverse` (or keep literal white only on the blue CTA where it is correct in both themes); `bg-red-50`/`text-red-700`→`bg-danger-bg`/`text-danger`; `bg-amber-50`/`text-amber-700`→ new `bg-warning-bg`/`text-warning`; `bg-emerald-50`/`text-emerald-700`/`text-emerald-800`→`bg-success-bg`/`text-success`; `border-red-200`→`border-danger-border`. Then add an ESLint or a CI grep rule banning the Tailwind default palette in `src/**/*.tsx`.

### bg-nuit inverts to near-white in dark mode — CTA becomes unreadable

- **Fichier :** `src/app/p/retour/authorization-proposal.tsx:102`
- **Constat :** `className="rounded-xl bg-nuit px-4 py-3 text-sm font-medium text-white …"`. `--color-nuit` maps to `--sidian-nuit` (globals.css:12) which is `var(--ds-color-text-primary)`. Under `.agentDark` (`app-shell.module.css:16`) that becomes `#f4f6fa` — a near-white background carrying `text-white` text. Same trap at `src/app/app/paiements-a-recevoir/[id]/page.tsx:157` (`bg-gris-500` → `--ds-color-text-muted`).
- **Action :** Replace `bg-nuit`/`bg-gris-500` used as a *surface* with a surface-role token (`bg-ds-surface-raised`, or `bg-sidian-blue` if it is meant to be the primary CTA). Text-role tokens must never be used as backgrounds — add this to the design system doc.

### Sixteen assistant CSS modules composite against literal #ffffff / #050608, hardcoding a dark substrate

- **Fichier :** `src/components/assistant/composer.module.css:45`
- **Constat :** `color-mix(in srgb, #ffffff N%, …)` occurrences per file: composer.module.css 15, protection-panel/protection-panel.module.css 10, conversation-resources.module.css 8, message-hover-actions.module.css 6, workspace-name-dialog.module.css 5, composer-shortcuts.module.css 5, message-suggestions.module.css 4, message-card.module.css 4, message-thread.module.css 3, suggestion-date-picker.module.css 2, attachment-preview-dialog.module.css 2, workspace-toast.module.css 1, project-creation-drawer.module.css 1. E.g. `composer.module.css:45 border-color: color-mix(in srgb, #ffffff 12%, transparent);` — a white-veil border that is invisible on a light surface. Also literal foregrounds `composer.module.css:349 color: #e8ecf2;`, `:405 color: #ffffff;`, `:450 color: #d0d5de;`, `suggestion-date-picker.module.css:87 color: #ffffff;`.
- **Action :** Introduce two theme-driven veil tokens in tokens.css, e.g. `--ds-veil-raise` (white in dark / black in light) and `--ds-veil-strength`, and rewrite these as `color-mix(in srgb, var(--ds-veil-raise) N%, …)`. Replace the four literal foregrounds with `var(--ds-color-text-primary)` / `var(--ds-color-text-inverse)`. Note `docs/design/SIDIAN_DESIGN_LOCK.md:40` locks « Dark mode par défaut » for the Agent IA, so this is only needed if the assistant must also render light.


## Workers, crons, outbox, jobs

### email_outbox n'a aucun producteur en production — le drain email tourne à vide

- **Fichier :** `src/lib/email/channel.ts:28`
- **Constat :** Grep `createEmailChannel|createEmailOutboxService|email_outbox` hors de `src/lib/email/**` ne renvoie que `src/lib/runtime/drains/drains.test.ts:185,228` (tests) et l'inventaire/documentation. Aucun fichier de `src/app`, `src/components` ou `src/lib/agent` n'importe le canal email. Le drain `createEmailOutboxDrainFromEnv` (src/lib/runtime/drains/email/from-env.ts:66-81) est bien branché dans le cron (run-drains.ts:53-57) mais `processQueuedEmailBatch` → `outbox.listClaimable()` ne trouvera jamais rien.
- **Action :** Décider quels templates du registre email (8 templates transactionnels documentés) doivent être émis et par qui, puis appeler `emailChannel.enqueue(...)` depuis les handlers de `runtime_job` (prevention_notice, due_send_link, retry_failed_notify) et depuis les server actions concernées (onboarding, confirmation de paiement).

### Le drain email ignore le lease et le backoff ajoutés par la migration : retry immédiat en boucle

- **Fichier :** `src/lib/email/outbox/supabase-repository.ts:307`
- **Constat :** `listClaimable(limit)` fait `.select('*').eq('status','queued').order('queued_at').limit(limit)` — aucun filtre sur `next_attempt_at`. Et `markFailedRetryable` (ligne 255-269) remet `status:'queued'` sans écrire `next_attempt_at`. Or la migration 20260726200000_runtime_outbox_leases.sql:319-326 ajoute bien `lease_token`, `lease_expires_at`, `next_attempt_at` à `email_outbox` et l'index `email_outbox_claimable_idx`. Résultat : un email en échec transitoire est retenté à chaque passage du cron (toutes les 5 minutes) sans aucun délai croissant, jusqu'à épuisement de `max_attempts`.
- **Action :** Écrire `next_attempt_at = now() + computeRetryDelaySeconds(attemptCount)` dans `markFailedRetryable` et ajouter le filtre `.or('next_attempt_at.is.null,next_attempt_at.lte.<now>')` dans `listClaimable` — ou basculer le drain sur la RPC `claim_email_outbox_batch` qui fait déjà tout cela atomiquement.

### Pas de reprise après crash pour l'email : les lignes bloquées en 'processing' ne sont jamais reprises

- **Fichier :** `src/lib/email/outbox/supabase-repository.ts:213`
- **Constat :** `claimForProcessing` met `status:'processing'` sans poser `lease_token` ni `lease_expires_at`. Si le process meurt entre le claim et `markSent`/`markFailed*` (timeout de fonction Vercel à 60s, redéploiement), la ligne reste en `processing` pour toujours : `listClaimable` ne sélectionne que `status='queued'`. La RPC `claim_email_outbox_batch` (migration 20260726200000:328-408) gère explicitement ce cas (`status='processing' and lease_expires_at <= v_now`), mais son adaptateur TypeScript `claimEmailOutboxBatchSql` (src/lib/runtime/drains/email/claim-sql.ts:61) n'a aucun appelant hors de l'export barrel — code mort.
- **Action :** Remplacer `listClaimable` + `claimForProcessing` par un appel à `claimEmailOutboxBatchSql` dans `createEmailOutboxDrain`, et faire consommer par le processor les enregistrements déjà claimés (comme le fait le drain WhatsApp via `alreadyClaimed`). Sinon, ajouter au minimum un balayage de reprise des `processing` expirés.

### Une seule config de canal invalide fait tomber tous les drains et bloque les paiements

- **Fichier :** `src/lib/runtime/cron/run-drains.ts:53`
- **Constat :** `const [whatsapp, email, paymentAudit] = await Promise.all([createWhatsAppOutboxDrainFromEnv(), createEmailOutboxDrainFromEnv(), createPaymentConnectAuditOutboxDrainFromEnv()]);`. Or `loadWhatsAppEnv()` lance `Error('Configuration WhatsApp live incomplète...')` (src/lib/communication-channels/whatsapp/env.ts:118-122) et `loadEmailEnv()` lance `Error('Configuration email invalide : production exige mode live ou provider désactivé.')` (src/lib/email/env.ts:87-91). Un rejet dans le `Promise.all` remonte au `catch` de run-drains.ts:139, qui retourne `status:'failed'` avec `paymentJobs.reasonCode = 'skipped_after_outbox_failure'` — `runPaymentJobsDrain` n'est jamais appelé.
- **Action :** Remplacer par `Promise.allSettled` et n'inclure que les drains résolus, en journalisant les autres comme `not_configured` ; déplacer `runPaymentJobsDrain` hors du chemin d'échec des outbox (l'appeler dans un `finally`/bloc indépendant) pour que les paiements ne dépendent pas de la config WhatsApp/Email.

### Les routes cron renvoient HTTP 200 en cas de not_configured ou partial : échec silencieux, aucune alerte

- **Fichier :** `src/app/api/cron/_lib/handler.ts:61`
- **Constat :** `const httpStatus = body.ok ? 200 : body.status === 'failed' ? 500 : 200;`. Or `run-scanners.ts:264` renvoie `ok: overall === 'completed' || 'not_configured' || 'partial' || 'deadline_reached'` et `run-drains.ts:209-213` fait de même. Donc un cron scanners qui échoue intégralement faute de `SUPABASE_SERVICE_ROLE_KEY` renvoie `{ok:true, status:'not_configured'}` → HTTP 200, et le monitoring cron Vercel affiche un succès. Idem pour `partial` (un ou plusieurs scanners en `failed`).
- **Action :** Renvoyer un statut HTTP non-2xx pour `not_configured` (503) et `partial` (207 ou 500 selon la politique d'alerte), ou publier une métrique/alerte dédiée sur `status !== 'completed'`. Ajouter une alerte sur l'absence d'exécution (heartbeat) plutôt que sur le seul code retour.

### Toute l'observabilité par item des drains est jetée en production (sink null)

- **Fichier :** `src/lib/runtime/drains/whatsapp/drain.ts:63`
- **Constat :** `const sink = deps.sink ?? createNullDrainObservabilitySink();` — identique dans `email/drain.ts:76` et `payment/drain.ts:39`. Aucune des trois factories FromEnv ne fournit de `sink` : `whatsapp/from-env.ts:79-85`, `email/from-env.ts:76-80`, `payment/from-env.ts:12-13`. `createNullDrainObservabilitySink` (drains/observability.ts:19-25) est un no-op. Les événements `DrainObservabilityEvent` (outcome par message, `idempotencyKeyHash`, `errorCode`) — le seul endroit où les dead-letters et lease_lost sont tracés au niveau item — ne sortent nulle part. Seuls les agrégats de batch sont loggués via `logServerEvent` dans run-drains.ts:123-136.
- **Action :** Implémenter un sink de production (écriture `audit_log` ou log structuré via `logServerEvent`) et l'injecter dans les trois factories FromEnv. Le §8 du doc 03 exige un suivi du taux de succès des livraisons — impossible en l'état.

### Le soft-deadline n'est jamais transmis aux drains outbox : dépassement possible de maxDuration

- **Fichier :** `src/lib/runtime/drains/inventory.ts:87`
- **Constat :** `runAllActiveDrains` ne prend ni `deadline` ni `signal` : `for (const drain of options.drains) { results.push(await drain.run({limit, leaseSeconds, now})); }`. Dans `run-drains.ts:101-110` la deadline n'est testée qu'une seule fois, *avant* de construire les drains, et n'est jamais repassée. Avec `limit` = 10 par drain, 3 drains actifs et un `SIDIAN_WHATSAPP_HTTP_TIMEOUT_MS` / `SIDIAN_EMAIL_HTTP_TIMEOUT_MS` par envoi, 30 envois séquentiels peuvent dépasser les 50s de budget puis les 60s de `maxDuration` (route.ts:20) — la fonction est tuée, les leases restent posés jusqu'à expiration et `runPaymentJobsDrain` n'est jamais atteint.
- **Action :** Passer la `Deadline` à `runAllActiveDrains` et à `DrainRunOptions`, et interrompre la boucle d'items dans chaque drain dès `deadline.isExpired()` (les leases expirent d'eux-mêmes, la reprise est déjà idempotente). Réserver explicitement un budget résiduel pour `runPaymentJobsDrain`.

### Les scanners relisent intégralement la table creance 4 fois par exécution, sans pagination ni limite

- **Fichier :** `src/lib/runtime/scanners/supabase-candidate-source.ts:108`
- **Constat :** `listOpenCreances()` fait `.from('creance').select(...).in('etat',['OUVERTE','PARTIELLEMENT_REGLEE']).is('archived_at',null)` sans `.limit()` ni `.range()`, puis 5 requêtes dérivées dont `.from('paiement').select('creance_id, montant').in('creance_id', creanceIds)` — la liste d'IDs est passée en entier dans l'URL PostgREST. Cette méthode est appelée par `prevention.ts:13`, `due.ts:13`, `silence.ts:13` et `auto-pay.ts:13`, soit 4 fois par run (24 requêtes non bornées), sans mise en cache entre scanners alors que `run-scanners.ts:129` crée une source unique partagée.
- **Action :** Mémoïser `listOpenCreances()` par exécution de cron (cache dans la closure de `createSupabaseScannerCandidateSource`), et pousser le filtrage temporel côté SQL (vue ou RPC `list_scanner_candidates(p_today, p_limit, p_cursor)`) avec pagination par curseur, plutôt que de charger tout l'encours en mémoire de fonction serverless.

### Requête payment_authorization non filtrée : scan de toutes les autorisations de tous les tenants

- **Fichier :** `src/lib/runtime/scanners/supabase-candidate-source.ts:147`
- **Constat :** Dans `listOpenCreances`, le bloc `client.from('payment_authorization').select('prestataire_id, client_payeur_id').eq('etat','ACTIVE').eq('is_default', true)` n'est restreint ni par `prestataire_id` ni par les `creanceIds` du lot, contrairement aux 4 autres requêtes du même `Promise.all` qui utilisent `.in('creance_id', creanceIds)`. Idem pour la requête `regle` ligne 155-162. L'ensemble est ensuite matérialisé en `Set`/`Map` en mémoire (lignes 174-195).
- **Action :** Restreindre par `.in('prestataire_id', [...new Set(creances.map(c => c.prestataire_id))])` sur `payment_authorization` et `regle`, ou déporter la jointure en SQL dans la RPC de candidats.

### Débit de traitement plafonné à 50 occurrences par scanner et par jour

- **Fichier :** `src/lib/runtime/scanners/runner.ts:108`
- **Constat :** `leases.claim({... batchSize})` avec `batchSize` résolu depuis `WORKFLOW_POLICY.scanner.defaultBatchSize = 50` (workflow-policy.ts:91) et plafonné à `maxBatchSize = 200`. La RPC `claim_runtime_scan_leases` applique `limit v_batch` (migration runtime_jobs.sql:295). Le cron scanners ne tourne qu'une fois par jour (`vercel.json` : `20 5 * * *`) et `run-scanners.ts` n'appelle chaque scanner qu'une seule fois par exécution, sans boucle de pagination. Au-delà de 50 créances éligibles pour un même scanner, le reste attend 24 h — le retard s'accumule sans jamais se résorber si le flux quotidien dépasse 50.
- **Action :** Boucler sur `runOneScanner` tant que `claimedCount === batchSize` et que la deadline n'est pas atteinte, ou augmenter `defaultBatchSize` et découper l'exécution en plusieurs invocations cron (fan-out par scannerKind).

### Le seul trafic WhatsApp sortant est réactif : aucun message n'est produit par un worker

- **Fichier :** `src/lib/communication-channels/inbound/service.ts:91`
- **Constat :** Le seul appel de production à `outboundMessages.insertQueued(...)` est `queueGuideConfirmationText` dans le service inbound, déclenché par le webhook WhatsApp entrant (`src/app/api/whatsapp/webhook/route.ts:23`) pour poster un accusé `guide_payment_ack`. Aucun autre producteur : grep `insertQueued` ne renvoie sinon que les définitions de repository, les stubs `disabled` des factories de drain et les tests. Le drain WhatsApp (bien implémenté : claim SQL avec lease, fencing, backoff, dead-letter) n'a donc à traiter que ces accusés de réception.
- **Action :** Une fois le worker `runtime_job` en place, faire produire les messages sortants par les handlers `prevention_notice`, `due_send_link` et `silence_escalate` via `createOutboundMessageService`. Sans cela, la promesse produit « l'agent relance à votre place » n'est portée par aucun code.


---

# P2 — après lancement


## AI runtime, LLM providers and agent tools

### protection.draft.confirm is risk_level high, creates a client and a créance, yet requires no approval — only a client-held nonce

- **Fichier :** `src/lib/agent/tools/definitions/protection.draft.confirm.1.0.0.ts:32`
- **Constat :** `risk_level: "high"`, `side_effects: ["create_client_payeur","create_creance_brouillon"]`, but `autonomy: { maximum_level: 2, human_validation_required: false, allowed_modes: ["agir"] }`. The gate is therefore purely `explicit_confirmation: z.literal(true)` + `confirmation_nonce: z.string().min(8).max(128)` in the input schema (tools/schemas/protection-draft.ts:140-159), and the nonce is handed to the browser in the converse output (`confirmation_nonce` in protectionDraftConverseOutputSchema:238). Compare payment.create_attempt@1.0.0 which sets `human_validation_required: true` and is correctly forced through `decide("require_approval", "VALIDATION_REQUIRED")` (src/lib/agent/permissions/service.ts:330-337). RBAC adds nothing here: `deriveGrants` (src/lib/agent/router/derive-grants.ts:51-63) grants **every** `definition.permissions.required` entry to any principal with a non-empty trusted role, and `tenant-membership-resolver.ts:133` returns `membershipRoleForSoloOwner()` for everyone.
- **Action :** Confirm with product that a client-held nonce is the intended confirmation gate for MVP (single-user tenants make this defensible). If multi-user tenants land, either set `human_validation_required: true` on confirm or make `deriveGrants` role-aware instead of granting all required permissions to every member.

### Caller-initiated abort is misclassified as LLM_TIMEOUT and consumes a retry plus a budget slot

- **Fichier :** `src/lib/llm/runtime.ts:230`
- **Constat :** In the retry loop: `if (isAbortError(err)) { lastError = new LlmError("LLM_TIMEOUT", { message: "llm_timeout" }); }`. `LLM_TIMEOUT` is in the `RETRYABLE` set (src/lib/llm/errors.ts:45-49), so `if (!lastError.retryable || attempt >= attemptsAllowed) break;` (line 240) does not break — a second attempt is started even though the caller's signal is already aborted. `withTimeout` then immediately re-aborts (`if (parent?.aborted) controller.abort()`, line 54). There is no distinct `LLM_ABORTED` code in `LLM_ERROR_CODES`, so user cancellation is indistinguishable from a provider timeout in every trace and metric.
- **Action :** Distinguish the parent signal from the timeout: check `request.signal?.aborted` before classifying, add an `LLM_ABORTED` (non-retryable) code to `LLM_ERROR_CODES`/`CODE_CATEGORY`/`RETRYABLE`, and break out of the loop immediately on caller abort.

### Nested timeouts inflate provider calls and double-count the LLM budget

- **Fichier :** `src/lib/agent/conversational-runtime/parse.ts:30`
- **Constat :** `const DEFAULT_TIMEOUT_MS = 4_000; const DEFAULT_MAX_RETRIES = 1;` in parse.ts wrap a runtime whose own defaults are `SIDIAN_LLM_HTTP_TIMEOUT_MS` 8000 and `SIDIAN_LLM_MAX_RETRIES` 1 (src/lib/llm/env.ts:21-27). The inner 4 s always fires first, so each of parse.ts's 2 attempts triggers 2 runtime attempts inside `runtime.complete` (one real, one that aborts instantly because the parent signal is already aborted). `options.budget.consume({scope_key, estimated_tokens: 200})` is called once per `complete()` invocation (src/lib/llm/runtime.ts:153-156), i.e. 4 budget consumptions for 2 real provider calls — the global RPM counter is inflated ~2x.
- **Action :** Make the layering explicit: let `parseUserMessage` own retries (`max_retries: 0` passed to the runtime) or let the runtime own them (`DEFAULT_MAX_RETRIES = 0` in parse.ts), and set `timeout_ms` so the inner budget is strictly larger than the outer. Move `budget.consume` outside the retry loop, or only count real network attempts.

### Bearer-token clients cannot use protection.draft.converse — the route's second auth path is cookie-only

- **Fichier :** `src/app/api/agent/tools/route.ts:142`
- **Constat :** `const context = intent ? await resolveAssistantConversationRequestContext() : null;` and `resolveAssistantConversationRequestContext` (src/lib/assistant-conversations/request-context.ts) uses `createClient()` from `@/lib/supabase/server` — i.e. the SSR **cookie** client only. If it returns null, the `intent.kind === "turn"` branch returns `persistenceFailureResponse()` (503, `CONVERSATION_SAVE_FAILED`, « Je n'ai pas pu enregistrer ta demande. ») at line 158 before the handler ever runs. The Gateway path by contrast fully supports `Authorization: Bearer` (src/lib/agent/server/auth/user-scoped-client.ts:44-53 and gateway/adapters/server-request-auth-adapter.ts). So a Bearer-authenticated client gets a permanent, misleading 503 on the assistant's main tool.
- **Action :** Derive the persistence context from the same AuthMaterial the Gateway uses (or move conversation persistence into the executor, behind the TrustedExecutionContext) so both credential kinds work and the route has a single auth path.

### Demo mode fabricates hardcoded assistant replies indistinguishable from real agent output

- **Fichier :** `src/components/assistant/conversational-workspace.tsx:3153`
- **Constat :** `if (!liveAgent) { ... }` guards a block that appends fully hardcoded French assistant messages — e.g. line 309 `content: \`J'ai créé le client ${protection.clientName} et préparé la protection...\``, line 345 `\`Parfait, je retiens ${protection.clientName}. Quel montant veux-tu sécuriser ?\``, line 3244 `"Je peux vous aider à préparer une protection, créer un client ou consulter vos paiements..."` — with `status: "sent"` and no marker distinguishing them from server output. The gate is `const liveAgent = forceLiveAgent || !demoState;` (line 792), and `demoState` is only supplied by `src/app/dev/assistant/page.tsx:106`; `src/app/app/assistant/page.tsx:309` does not pass it, so production is on the live path. The risk is that the gate is a single prop away from shipping fabricated AI text.
- **Action :** Tag demo-origin messages with an explicit flag on `AssistantMessage` and render a visible « Démo » badge, and/or guard the whole demo branch behind `process.env.NODE_ENV !== "production"` so it cannot be reached from a production build.

### Dead OPENAI_API_KEY config surface suggests a provider integration that does not exist

- **Fichier :** `src/config/env-server.ts:47`
- **Constat :** `const aiServerEnvSchema = z.object({ OPENAI_API_KEY: z.string().min(1) });` and `export function getAiServerEnv()` at line 318 (throwing « Configuration IA manquante ou invalide. »). `grep -rn "getAiServerEnv" src/` returns only its own definition — zero callers. `.env.example:48` documents it as `# Legacy alias (non utilisé par le runtime typé SIDIAN_LLM_*)`. The real runtime reads only `SIDIAN_LLM_API_KEY` (src/lib/llm/env.ts:15).
- **Action :** Delete `aiServerEnvSchema`, `getAiServerEnv` and the `OPENAI_API_KEY` line from `.env.example`, or wire `getAiServerEnv` to the real `SIDIAN_LLM_*` schema. Leaving two competing AI env contracts guarantees a misconfigured deploy.

### client_name from the model is never cross-checked against the user message, unlike email and amount

- **Fichier :** `src/lib/agent/conversational-runtime/normalize.ts:94`
- **Constat :** `tryField("client_name", (v) => normalizeClientName(String(v)));` — no plausibility check. Compare `client_email` (line 96-106) which rejects with reason `"hallucinated_email_not_in_message"` via `emailAppearsInMessage`, and `expected_amount_minor` (line 108-134) which rejects with `"hallucinated_amount_not_in_message"` via `amountPlausibleInMessage`. A hallucinated or prompt-injected client name at confidence ≥ `MIN_FIELD_CONFIDENCE` (0.55, schemas.ts:86) flows straight into the draft recap and, after user confirmation, into `create_client_payeur`.
- **Action :** Add a substring/fuzzy check that the normalised `client_name` appears in `input.user_message` (or in `known_fields`), pushing `rejected_fields` with reason `"hallucinated_client_name_not_in_message"` otherwise. Same treatment for `libelle` and `reference_externe`, which are currently only trimmed and truncated to 200 chars.

### Prompt-injection detector computes signals then explicitly discards them

- **Fichier :** `src/lib/agent/conversational-runtime/parse.ts:131`
- **Constat :** `void injection;` with the comment «Les injections d'identité / contournement ne changent jamais tenant/actor et n'autorisent jamais confirm — signal uniquement dans la summary si besoin.» The `InjectionScanResult` produced at line 74 by `scanUserMessageForInjection` (injection.ts:41-47) carries `bypass_confirmation` and `identity_injection` booleans that are never recorded, never audited, and never returned in the tool output. `RuntimeTrace` (trace.ts:12-37) has no field for them, so a tenant repeatedly attempting « ignore all previous instructions » / « explicit_confirmation: true » leaves no trace. The structural defences themselves are sound (system prompt separated as a `system` role message, output validated by the strict `llmStructuredExtractionSchema` with a `FORBIDDEN_TOP_LEVEL` blocklist including tenant_id/confirm/payment/system_prompt, 8 000-char input caps in `sanitizeMessageForProvider` and `sanitizeUserContentForModel`).
- **Action :** Add `bypass_confirmation_attempt` / `identity_injection_attempt` to `RuntimeTrace` and `toAuditableTracePayload`, persist them via the audit sink, and feed them to the detector set in `src/lib/agent/observability/detectors/` so repeated attempts raise an alert candidate.

### LLM redaction helpers are implemented and tested but unreachable in production

- **Fichier :** `src/lib/llm/redaction.ts:42`
- **Constat :** `redactSensitive` and `redactText` are exported from `src/lib/llm/index.ts:50-55`, but `grep -rn "redactSensitive|redactText" src/ | grep -v "src/lib/llm/"` returns nothing. The only in-package consumer is `sanitizeUserContentForModel`, used by `sanitizeMessages` in runtime.ts:64-74. Because both observability sinks are Null (see the metrics finding), the log-redaction path they were written for never executes.
- **Action :** Once a real observability sink is wired, route every event payload through `redactSensitive` before persistence, and add a test asserting no raw prompt text or PII reaches the sink.


## Authenticated application pages

### Cinq composants de tableau de bord sont du code mort, dont le seul lien vers Approbations

- **Fichier :** `src/components/app/dashboard-overview.tsx:12`
- **Constat :** Un grep de DashboardOverview sur tout src ne renvoie que dashboard-overview.tsx et dashboard-overview.test.tsx. Par transitivité DashboardSummary, DashboardActions, DashboardDeadlines et DashboardPortfolio ne sont rendus dans aucune page (seul DashboardEvents est réutilisé, par activite/page.tsx:44). dashboard-actions.tsx:73 contient le seul lien produit vers /app/approbations.
- **Action :** Soit rebrancher DashboardOverview (aucune route ne le rend depuis que /app/page.tsx est un simple redirect vers /app/assistant), soit supprimer les quatre composants morts — après avoir déplacé le lien Approbations dans la navigation.

### La page Activité est plafonnée à 8 événements sans pagination ni « voir plus »

- **Fichier :** `src/lib/dashboard/dashboard-model.ts:585`
- **Constat :** buildDashboardModel retourne `events: events.slice(0, 8)`. ActivitePage (src/app/app/activite/page.tsx:19-20) consomme dashboard.events tel quel et ne rend qu'une liste, sans contrôle de pagination ni indication de troncature. La description de la page annonce « Les événements récents sur tes protections et paiements » (ligne 27) — un prestataire actif n'a donc aucun moyen de consulter l'historique au-delà de 8 lignes.
- **Action :** Ajouter une pagination (curseur sur occurredAt) ou au minimum un lien « Voir tout l'historique » et signaler la troncature.

### Aucune pagination ni recherche sur les listes Clients, Paiements et Dossiers

- **Fichier :** `src/lib/clients/client-payeur-core.ts:19`
- **Constat :** listActiveClientPayeurs fait `.select(...).is("archived_at", null).order("nom")` sans .range() ni .limit(). Idem listActiveCreances (src/lib/creances/creance-core.ts:36-42). Les pages rendent la totalité (clients/page.tsx:72, paiements/page.tsx:152, paiements-a-recevoir/page.tsx:105). De plus, chaque ligne de /app/clients et /app/paiements-a-recevoir instancie un composant client complet (ClientForm / CreanceForm + ReceivablePaymentSection) dans un <details>, donc N formulaires hydratés.
- **Action :** Introduire une pagination serveur (.range) et un champ de recherche par nom/email/libellé ; ne monter le formulaire d'édition qu'à l'ouverture du <details>.

### Aucun <Suspense> dans l'application authentifiée : chaque page attend sa requête la plus lente

- **Fichier :** `src/app/app/paiements-a-recevoir/page.tsx:51`
- **Constat :** Grep « Suspense » sur src/app/app et src/components/app → 0 résultat. paiements-a-recevoir/page.tsx enchaîne Promise.all([clients, creances]) puis un second await listPaidAmountsByCreanceIds (ligne 56) puis un troisième await getPrestataireStripeReadiness (ligne 64) avant tout rendu. Le seul retour visuel est src/app/app/loading.tsx (PageSkeleton) pour tout le segment ; il n'existe aucun squelette par section.
- **Action :** Encadrer les blocs indépendants (liste, panneau latéral, état Stripe) dans des <Suspense fallback> avec squelettes dédiés pour permettre le streaming.

### getPrestataireStripeReadiness est appelé hors du try/catch de la page Dossiers

- **Fichier :** `src/app/app/paiements-a-recevoir/page.tsx:64`
- **Constat :** Les lignes 51-62 protègent le chargement clients/créances par try/catch → ErrorState local. Mais `const stripeReadiness = await getPrestataireStripeReadiness(supabase, prestataire.id);` (ligne 64) est hors du bloc ; cette fonction lève explicitement `throw new Error("prestataire_stripe_readiness_lookup_failed")` (src/lib/stripe/connect/readiness.ts:33). Une panne sur cette seule lecture fait basculer toute la page vers error.tsx alors que la dégradation partielle était prévue. Même schéma sur demarrage/page.tsx:28-34 où aucun des 5 chargements n'est protégé.
- **Action :** Envelopper l'appel readiness dans le même try/catch avec une valeur de repli non configurée (le pattern existe déjà dans getWorkspaceConfigStatus, src/lib/ux/config-status.ts:207-218) et protéger de même le Promise.all de /app/demarrage.

### La date d'échéance brute de la base est affichée à l'utilisateur sur la page Dossiers

- **Fichier :** `src/app/app/paiements-a-recevoir/page.tsx:113`
- **Constat :** `description={`${clientName} · échéance ${creance.date_echeance}`}` — date_echeance est une colonne date PostgreSQL sérialisée « 2026-08-14 ». La page Paiements, elle, définit et utilise formatDate() avec Intl.DateTimeFormat("fr-FR") (paiements/page.tsx:25-36, utilisée ligne 162), et la page détail utilise formatDate (…/[id]/page.tsx:52).
- **Action :** Réutiliser le formateur fr-FR existant sur cette ligne.

### Le badge d'encaissement affiche le mot « État » au lieu de l'état

- **Fichier :** `src/components/app/receivable-payment-section.tsx:119`
- **Constat :** `accessory={<Badge tone={readiness.tone}>État</Badge>}` — le libellé est la chaîne littérale « État » quelle que soit la situation ; seule la couleur varie. Le vrai libellé (readiness.label, ex. « Action requise pour activer l'encaissement ») est déjà calculé par describeStripeReadiness (lignes 33-60) et n'est utilisé que comme description de l'InfoCard.
- **Action :** Remplacer par un libellé court dérivé de readiness (« Actif », « À finaliser », « Vérification ») ; un badge dont le texte est constant n'apporte aucune information.

### Le formulaire client annonce « Enregistré. » alors qu'aucun client n'a été créé

- **Fichier :** `src/components/app/client-forms.tsx:103`
- **Constat :** `{state?.ok === true ? <p className={styles.formSuccess}>Enregistré.</p> : null}`. Or createClientPayeurAction renvoie `{ ok: true, existing: true, client: {...} }` quand un client actif avec le même email existe déjà (src/app/actions/clients-creances.ts:139-148) : aucune ligne n'est créée, mais le formulaire est réinitialisé (formEpoch++) et affiche « Enregistré. ». Le champ `existing` du résultat n'est jamais lu par le composant.
- **Action :** Lire result.existing dans boundAction et afficher un message distinct (« Ce client existait déjà, il a été rattaché. »).

### L'arrivée sur /app/clients depuis une conversation ne montre aucun contexte ni retour vers la discussion

- **Fichier :** `src/app/app/clients/page.tsx:32`
- **Constat :** La page lit `params.conversation` et se contente de le passer en input caché au ClientForm de création (ligne 109 → clients-creances.ts:91-116 attachConversationToClient). Aucun bandeau n'indique que la création est rattachée à une discussion, et aucun lien ne ramène vers /app/assistant. Le chemin est pourtant emprunté explicitement par l'assistant : conversational-workspace.tsx pousse `/app/clients?conversation=${id}` (branche continue_client_conversation) et `/app/clients` (branche new_client_conversation).
- **Action :** Quand searchParams.conversation est présent, afficher un StatusBanner « Création liée à ta discussion » avec un lien retour vers l'assistant, et rediriger vers la conversation après création réussie.

### La page d'erreur du segment /app perd la navigation et n'enregistre rien

- **Fichier :** `src/app/app/error.tsx:14`
- **Constat :** Le composant rend `<main className={styles.page}>` avec BrandLockup + ErrorState + unstable_retry, sans AppShell ni aucun lien de sortie : si le réessai échoue, l'utilisateur n'a plus aucun moyen de naviguer. Par ailleurs le paramètre error est déstructuré en `error: _error` et n'est jamais utilisé — aucun useEffect de report, alors que node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md (lignes 222-225) recommande explicitement de reporter l'erreur.
- **Action :** Ajouter un lien secondaire « Retour à l'accueil » (/app/assistant) et un useEffect appelant logClientEvent/le logger existant avec error.digest (sans afficher le digest).

### La page /app/demarrage n'a aucun point d'entrée en navigation

- **Fichier :** `src/app/app/demarrage/page.tsx:56`
- **Constat :** La page « Bien démarrer » n'est référencée que par les hrefs de config-status.ts:36 et :87 (canaux email et WhatsApp), c'est-à-dire uniquement via un MissingConfigBanner ou la ConfigStatusList de /app/parametres. « Bien démarrer » est d'ailleurs listé dans LEGACY_NAV_LABELS (app-nav-config.ts:58) et le test app-navigation.test.tsx:48 vérifie son absence de la nav. La sidebar propose un bloc « Bien démarrer » distinct (app-sidebar.tsx:773-842) avec 3 étapes différentes de celles de la page (4 étapes, buildOnboardingSteps), et ce bloc ne s'affiche que si appearance === "agent-dark", donc uniquement sur /app/assistant.
- **Action :** Trancher entre les deux checklists d'onboarding (page /app/demarrage vs bloc sidebar) : soit supprimer la page et ne garder que la sidebar, soit lier la sidebar vers la page. Deux progressions divergentes sur le même onboarding désorientent.

### Six écrans authentifiés contournent le design system au profit de classes Tailwind brutes

- **Fichier :** `src/app/app/paiements-a-recevoir/[id]/page.tsx:93`
- **Constat :** Le lien de retour est écrit en dur : className="inline-flex min-h-10 items-center justify-center rounded-lg border border-gris-200 bg-white px-4 text-sm font-medium text-nuit ..." alors que ButtonLink du design system est utilisé sur paiements/page.tsx:109. Même schéma sur approbations/page.tsx (sections/li/ul stylées à la main), demarrage/page.tsx:112-143, follow-up-controls.tsx:85 et :168, approval-decision.tsx:28 et :37, stripe-connect-panel.tsx:318-344. Les autres pages (clients, paiements, parametres, activite) passent par workspace-blocks.tsx + CSS modules + design-system.
- **Action :** Migrer ces écrans vers Button/ButtonLink/Badge/InfoCard + les blocs de workspace-blocks.tsx. docs/design/SIDIAN_DESIGN_LOCK.md autorise explicitement l'« Optimisation Design System » sans validation supplémentaire.

### La branche vide de DashboardEvents est inatteignable et duplique le titre de la page Activité

- **Fichier :** `src/components/app/dashboard-events.tsx:25`
- **Constat :** DashboardEvents rend `{events.length === 0 ? <p>Les confirmations de paiement ... apparaîtront ici.</p> : ...}`, mais ActivitePage intercepte déjà le cas vide en amont avec son propre EmptyState (activite/page.tsx:38-42) et ne rend DashboardEvents que si events.length > 0. Par ailleurs le composant impose son propre en-tête WorkspaceSection title="Derniers événements" sous le H1 « Activité » de l'AppShell, ce qui produit deux titres pour une seule liste.
- **Action :** Supprimer la branche vide morte et laisser la page décider de l'en-tête (passer title en prop optionnelle), pour éviter le doublon de titres.


## Authentication and onboarding

### minimum_password_length = 6 côté Supabase alors que l'application exige 8

- **Fichier :** `supabase/config.toml:187-191`
- **Constat :** `minimum_password_length = 6` et `password_requirements = ""` (aucune exigence de composition). Côté application, `passwordSchema` impose 8 caractères, au moins une lettre et un chiffre (`src/lib/auth/schemas.ts:7-12`). L'écart n'est pas exploitable via l'UI, mais toute création ou modification passant par l'API Auth directement, l'Admin API ou le dashboard n'est bornée que par le plancher à 6 sans exigence de composition.
- **Action :** Aligner : `minimum_password_length = 8` et `password_requirements = "letters_digits"` dans `supabase/config.toml` et dans le dashboard du projet, pour que la règle soit appliquée au niveau de l'IdP et pas seulement dans le formulaire.

### Le nom d'activité est demandé deux fois : à l'inscription puis à l'étape « profil » de l'onboarding

- **Fichier :** `src/app/actions/auth.ts:99-101`
- **Constat :** `signUpAction` stocke `agency_name` en user_metadata, et `resolveAgencyName` l'utilise pour initialiser `prestataire.nom` (`src/lib/auth/ensure-prestataire-core.ts:10-18, 54-59`). L'étape 1 de l'onboarding — « Présente ton activité » → `/app/parametres` (`src/lib/onboarding/progress.ts:22-31`) — affiche ensuite `ProfileForm` avec `defaultValue={initial.nom}` sur un champ « Nom de votre activité » obligatoire (`src/components/app/profile-form.tsx:48-57`). L'utilisateur re-confirme une donnée déjà fournie. Le PRD §2bis fixe pourtant l'étape 1 à « Création du compte Sidian (email, mot de passe) » et l'étape 2 à l'identification minimale (`docs/SIDIAN_02_PRD_V2.md:49-50`), et exige d'« expliquer pourquoi chaque information est demandée ».
- **Action :** Décider : soit retirer `agencyName` du formulaire d'inscription et laisser l'étape profil le collecter (aligné PRD §2bis, `resolveAgencyName` retombe déjà sur « Mon activité »), soit conserver la collecte à l'inscription et transformer l'étape profil en simple choix du profil agent (« un clic, pas un questionnaire », PRD §2bis étape 3). Arbitrage produit.

### displayName est collecté à l'inscription mais ne sert qu'au message d'accueil

- **Fichier :** `src/components/auth/sign-up-form.tsx:22-31`
- **Constat :** `grep -rn display_name src/` : la donnée est écrite par `signUpAction` (`src/app/actions/auth.ts:99`) et lue uniquement par `src/app/app/assistant/page.tsx:243-256` pour `resolveGreetingFirstName` / `resolveDisplayName`. `ensure-prestataire-core.ts` ne l'utilise pas (il lit `agency_name` puis un legacy `nom`), et la table `prestataire` n'a pas de colonne correspondante. Cela fait 7 champs obligatoires sur l'écran d'inscription, contre l'étape 1 du PRD limitée à email + mot de passe (`docs/SIDIAN_02_PRD_V2.md:49`).
- **Action :** Rendre `displayName` optionnel dans `signUpSchema`, ou le déplacer vers l'étape profil. `resolveDisplayName` gère déjà l'absence via son `fallback`, et `resolveGreetingFirstName` retourne `null` (« Bonjour » seul) — aucun code ne casse.

### Les écrans d'authentification sont en clair alors que la surface d'accueil du produit est verrouillée en sombre

- **Fichier :** `src/components/auth/auth-shell.tsx:14-25`
- **Constat :** `AuthShell` est en clair de bout en bout : `bg-gris-50`, carte `bg-white`, titre `text-nuit`. À l'inverse, la page d'atterrissage post-connexion `/app/assistant` rend `AppShell` avec `appearance="agent-dark"` (`src/components/assistant/conversational-workspace.tsx:3994`), qui pose `data-theme="agent-dark"` (`src/components/app/app-shell.tsx:152-165`). `docs/design/SIDIAN_DESIGN_LOCK.md` fixe « Dark mode par défaut » et « Éviter les cartes multiples et les doubles conteneurs » — or l'écran de connexion est précisément une carte claire dans un conteneur clair. Le premier contact visuel avec le produit ne ressemble pas au produit.
- **Action :** Décision design (le lock relève de Product Design) : soit habiller `AuthShell` avec `data-theme="agent-dark"` et les tokens correspondants, soit acter explicitement dans le DESIGN_LOCK que les écrans hors `/app` restent en clair. À trancher avant lancement pour la cohérence de la première impression.

### Aucun captcha sur l'inscription et la réinitialisation

- **Fichier :** `supabase/config.toml:219-223`
- **Constat :** Le bloc `# [auth.captcha]` est entièrement commenté (`# provider = "hcaptcha"`). La seule protection est le rate limit persistant : `auth_signup_ip` 10 / 10 min et `auth_signup_email` 5 / 10 min (`supabase/migrations/20260721200100_sid_sec_006_rate_limit_policy.sql:38-43`), contourné par rotation d'IP et d'adresses jetables. Chaque inscription crée une ligne `prestataire` avec `subscription_status default 'trialing'` (`supabase/migrations/20260715120100_core_tables.sql:9`), donc un accès produit.
- **Action :** Activer hCaptcha ou Turnstile sur `signUp` et `resetPasswordForEmail` (`[auth.captcha]` dans config.toml + `options.captchaToken` côté client), ou acter que le rate limit suffit pour une bêta limitée à 20 comptes (`docs/SIDIAN_02_PRD_V2.md:194`).

### Les réponses des pages /app/** ne posent pas explicitement d'en-têtes no-store, contrairement aux routes d'auth

- **Fichier :** `next.config.ts:292-309`
- **Constat :** `authSensitiveRouteSources` couvre `/connexion`, `/inscription`, `/inscription/verifier-email`, `/mot-de-passe-oublie`, `/reinitialiser-mot-de-passe`, `/auth/:path*` — mais pas `/app/:path*`. Dans le proxy, `applyAuthNoStoreHeaders` n'est appliqué que sur la redirection d'échec (`src/lib/supabase/proxy.ts:25`), jamais sur la réponse `NextResponse.next()` d'une requête authentifiée (lignes 34-76). Les pages `/app/**` contiennent pourtant nom, email, clients et montants du prestataire, et aucune ne déclare `export const dynamic = "force-dynamic"` (`grep dynamic = src/app/app/` : aucun résultat).
- **Action :** Ajouter `{ source: "/app/:path*", headers: authSensitiveRouteHeaders }` (ou au minimum les trois en-têtes de cache) dans `nextConfig.headers()`, pour ne pas dépendre du défaut implicite de Next sur les réponses dynamiques.

### « Gérer mon abonnement » renvoie vers Paramètres, qui ne contient aucune gestion d'abonnement

- **Fichier :** `src/components/app/app-sidebar.tsx:881-895`
- **Constat :** Le menu compte contient deux entrées pointant vers la même URL : « Paramètres » → `/app/parametres` et « Gérer mon abonnement » → `/app/parametres`. Or `ParametresPage` (`src/app/app/parametres/page.tsx:32-58`) ne rend que `ProfileForm`, `ConfigStatusList` et le panneau « Adresse du compte » en lecture seule — rien sur l'abonnement, alors que `prestataire` porte `subscription_status`, `pricing_version` et `early_access_price_locked_until` (`supabase/migrations/20260715120100_core_tables.sql:9-12`).
- **Action :** Retirer l'entrée « Gérer mon abonnement » du menu compte tant que l'écran n'existe pas, ou la pointer vers un portail de facturation Stripe. Une entrée de menu qui ne tient pas sa promesse est un signal de produit inachevé sur un écran vu à chaque session.

### getCurrentPrestataireProfile s'appuie exclusivement sur la RLS pour cibler la bonne ligne

- **Fichier :** `src/lib/profile/profile-core.ts:18-31`
- **Constat :** ```
const { data, error } = await supabase.from("prestataire").select(PROFILE_COLUMNS).single();
```
Aucun `.eq("user_id", ...)` : la sélection ne repose que sur `prestataire_select_own` (`using (user_id = auth.uid())`, `supabase/migrations/20260715120400_rls_policies.sql:18-22`). C'est correct aujourd'hui, mais `.single()` échoue en erreur PGRST116 si zéro ligne (nouveau compte avant `ensurePrestataire`) et retournerait une ligne arbitraire si la policy venait à être élargie. À comparer avec `getPrestataireForUser` (`src/lib/auth/ensure-prestataire-core.ts:24-28`) qui filtre bien sur `user_id` et utilise `maybeSingle()`.
- **Action :** Ajouter `.eq("user_id", userId)` (défense en profondeur, le paramètre est déjà disponible chez tous les appelants) et remplacer `.single()` par `.maybeSingle()` avec un message d'erreur distinguant « profil absent » de « erreur base ».

### Sur les pages d'auth hors /app, le rafraîchissement de session s'effectue en contexte cookies read-only et perd les tokens tournés

- **Fichier :** `src/lib/supabase/server.ts:26-37`
- **Constat :** `setAll` encadre `cookieStore.set` dans un `try {} catch {}` dont le commentaire dit explicitement : « Server Components en lecture seule : le rafraîchissement est géré par proxy.ts ». Or le proxy n'appelle `updateSession` que pour `/app` et `/app/**` (`src/proxy.ts:10-12,20`). Les pages `/connexion`, `/inscription`, `/mot-de-passe-oublie` et `/reinitialiser-mot-de-passe` appellent pourtant `getAuthenticatedUser()` / `redirectIfAuthenticated()` depuis un Server Component. Avec `enable_refresh_token_rotation = true` et `refresh_token_reuse_interval = 10` (`supabase/config.toml:177-180`), un refresh déclenché sur ces pages produit un nouveau refresh token qui est silencieusement jeté, invalidant la session après 10 secondes.
- **Action :** Étendre `requiresAuthRefresh` (`src/proxy.ts:10-12`) aux routes d'auth qui lisent la session — `/connexion`, `/inscription`, `/mot-de-passe-oublie`, `/reinitialiser-mot-de-passe` — pour que la rotation des cookies soit écrite par le proxy avant l'exécution du Server Component.

### prestataire.email est figé à la création et peut diverger de l'adresse Auth ; aucun parcours de changement d'email

- **Fichier :** `src/app/app/parametres/page.tsx:52-57`
- **Constat :** Le panneau « Adresse du compte » affiche `profile.email`, lu depuis la table `prestataire` (`src/lib/profile/profile-core.ts:11`), et non `user.email`. Cette colonne n'est écrite qu'une fois, à l'INSERT du RPC (`insert into public.prestataire (user_id, email, nom) values (v_uid, lower(btrim(v_email)), v_nom)` — `supabase/migrations/20260716220000_sid_sec_001_prestataire_onboarding_rpc.sql:65-66`) ; la branche `if found then return v_row` ne resynchronise jamais l'email. Le texte affiché promet pourtant « Cette adresse vient de ton compte connecté ». Par ailleurs `supabase.auth.updateUser({ email })` n'est appelé nulle part : il n'existe aucun parcours de changement d'adresse, alors que `double_confirm_changes = true` est configuré (`supabase/config.toml:230`).
- **Action :** Soit afficher `user.email` (source de vérité Auth) au lieu de `profile.email` sur cet écran, soit faire resynchroniser `prestataire.email` par le RPC sur la branche `found`. Décider séparément si un parcours de changement d'email entre dans le périmètre MVP.

### L'étape « Ajoute ton premier client » de l'onboarding est verrouillée par le profil, mais la navigation ne l'est pas

- **Fichier :** `src/lib/onboarding/progress.ts:33-41`
- **Constat :** L'étape `client` porte `available: facts.profileConfigured` ; en cas de `false`, `/app/demarrage` affiche un `DisabledHint` à la place du lien (`src/app/app/demarrage/page.tsx:131-140`). Mais `APP_NAV` expose `/app/clients` en permanence (`src/components/app/app-nav-config.ts:40-43`) et `ClientsPage` ne vérifie que `requireConfirmedUser()` — pas `onboarding_profile_completed_at`. La progression affichée par `getOnboardingCompletion` peut donc atteindre 3/4 sans que l'étape 1 soit franchie, et le verrou de la checklist ne verrouille rien.
- **Action :** Retirer la contrainte `available` sur l'étape client (cohérent avec le PRD §2bis : « L'agent ne bloque jamais la création du premier paiement à recevoir »), ou appliquer réellement le gate au niveau des pages concernées. La checklist ne doit pas prétendre bloquer ce qu'elle ne bloque pas.

### Toutes les pages d'authentification partagent le titre générique « Sidian V2 »

- **Fichier :** `src/app/layout.tsx:12-15`
- **Constat :** `export const metadata: Metadata = { title: "Sidian V2", description: "Suivi des règlements B2B..." }` dans le layout racine. Aucune des pages `src/app/connexion/page.tsx`, `src/app/inscription/page.tsx`, `src/app/inscription/verifier-email/page.tsx`, `src/app/mot-de-passe-oublie/page.tsx`, `src/app/reinitialiser-mot-de-passe/page.tsx` n'exporte de `metadata`. Les onglets, l'historique et les gestionnaires de mots de passe voient tous le même libellé, et « Sidian V2 » est un nom de version interne, pas un nom de produit.
- **Action :** Exporter un `metadata: Metadata = { title: "Connexion — Sidian" }` (etc.) sur chaque page d'auth, et remplacer le titre racine par un `title.template` (`{ default: "Sidian", template: "%s — Sidian" }`) sans le suffixe de version.

### ensurePrestataireForUser est réexécuté à chaque rendu de page, sans mémoïsation

- **Fichier :** `src/app/app/demarrage/page.tsx:24-26`
- **Constat :** Le même triplet `requireConfirmedUser()` → `createClient()` → `ensurePrestataireForUser(supabase, user)` est répété dans `src/app/app/assistant/page.tsx:233-235`, `src/app/app/parametres/page.tsx:17-19`, `src/app/app/demarrage/page.tsx:24-26` et les actions `src/app/actions/profile.ts:44`. Chaque rendu déclenche donc un `auth.getUser()` (déjà exécuté par le proxy sur la même requête, `src/lib/supabase/proxy.ts:68-70`) plus un RPC `ensure_prestataire_for_current_user` qui, hors première fois, ne fait qu'un SELECT. Le RPC est idempotent, il n'y a pas de bug de correction — seulement deux allers-retours Supabase superflus par navigation.
- **Action :** Envelopper la résolution `user + prestataire` dans un helper mémoïsé par requête (`import { cache } from "react"` — sûr ici car le périmètre est la requête, pas le processus), et le réutiliser dans toutes les pages `/app/**`. À faire après le lancement : c'est de la performance, pas de la correction.

### AuthLayout est un export mort dans auth-page.tsx

- **Fichier :** `src/components/auth/auth-page.tsx:5-7`
- **Constat :** `export default function AuthLayout({ children }) { return children; }` — un composant identité exporté par défaut depuis un fichier de composants, jamais importé (`grep -rn AuthLayout src/` ne retourne que cette déclaration). Il n'existe d'ailleurs aucun `layout.tsx` dans `src/app/connexion`, `src/app/inscription`, `src/app/mot-de-passe-oublie` ou `src/app/reinitialiser-mot-de-passe` : chaque page instancie directement `AuthPage` → `AuthShell`.
- **Action :** Supprimer l'export `AuthLayout`. Si un layout partagé est souhaité pour les routes d'auth, créer un vrai `src/app/(auth)/layout.tsx` avec un route group et y déplacer `AuthShell` — ce qui permettrait aussi de mutualiser les `metadata` et une `error.tsx` de segment.


## Communication channels — Email

### Le webhook ne vérifie pas que le phone_number_id / WABA du payload correspond à la configuration

- **Fichier :** `src/lib/communication-channels/whatsapp/webhook/parse.ts:21`
- **Constat :** `parseWhatsAppStatusEvents` (parse.ts:21) et `parseWhatsAppInboundMessages` (whatsapp/inbound/parse.ts:231) descendent `entry[].changes[].value` sans jamais lire `value.metadata.phone_number_id` ni `entry[].id` (WABA id), et la route (route.ts:187-222) ne fait aucun contrôle. `SIDIAN_WHATSAPP_PHONE_NUMBER_ID` et `SIDIAN_WHATSAPP_BUSINESS_ACCOUNT_ID` sont chargés (env.ts:127-128) mais seul le premier sert à l'envoi. Si l'app Meta est abonnée à plusieurs numéros, tout trafic signé par le même app secret est accepté.
- **Action :** Ajouter dans le parse une extraction de `value.metadata.phone_number_id` et rejeter (compteur `ignored`) tout événement dont le numéro ne correspond pas à `env.phoneNumberId`, idem `entry.id` vs `env.businessAccountId` quand il est renseigné.

### Traitement inbound synchrone dans la requête webhook — risque de timeout et de désabonnement Meta

- **Fichier :** `src/app/api/whatsapp/webhook/route.ts:194`
- **Constat :** route.ts:194-198 : boucle `for (const message of inboundMessages) { await current.inboundService.processInboundMessage(message) }`. Chaque itération enchaîne 6 à 10 allers-retours Supabase (tryInsert, claimForProcessing, findByProviderMessageId, identities.resolve, update, confirmations.getOrCreate, save, sessions.*, insertQueued de l'accusé — inbound/service.ts:143-770). La réponse HTTP n'est renvoyée qu'après. Meta attend une réponse rapide et désabonne un endpoint durablement lent.
- **Action :** Répondre 200 dès l'insertion durable (`tryInsert`) et déporter le traitement métier dans un drain inbound claimé par cron (le statut `received` de `communication_inbound_messages` existe déjà pour ça).

### Cache de deps au niveau module dans la route webhook : un échec d'init est définitif

- **Fichier :** `src/app/api/whatsapp/webhook/route.ts:88`
- **Constat :** route.ts:88-97 : `depsInit = createDefaultDeps().then((resolved)=>{deps=resolved; return resolved;})`. Si `createDefaultDeps` rejette (ex. `createAdminClient()` indisponible au premier appel, ligne 57), `depsInit` conserve une promesse rejetée et `getDeps()` la renvoie à chaque requête suivante : la lambda répond 500 en boucle jusqu'au prochain cold start, sans jamais retenter.
- **Action :** Réinitialiser `depsInit = null` dans un `.catch()` avant de propager, afin que la requête suivante retente l'initialisation.

### loadWhatsAppSidianProviderFromEnv fabrique des accusés d'envoi factices sans jamais appeler Meta

- **Fichier :** `src/lib/communication-channels/providers/whatsapp-sidian.ts:60`
- **Constat :** whatsapp-sidian.ts:60-66 : en l'absence de `config.transport`, le provider retourne `{providerMessageId: `wa_sidian_stub_${now().getTime()}`}` — puis `send()` renvoie un `ProviderSendResult` d'apparence normale (lignes 75-78). `loadWhatsAppSidianProviderFromEnv` (ligne 83) ne fournit jamais de `transport` : tout appel réussit silencieusement sans envoi. La fonction est exportée publiquement (`src/lib/communication-channels/index.ts:38`) aux côtés du vrai chemin G1-P.
- **Action :** Faire lever `provider_not_implemented` par défaut au lieu de retourner un id factice, ou supprimer `createWhatsAppSidianProvider` / `createCommunicationOutboundService` / `sendClientMessage` (aucun appelant hors tests) puisque le chemin réel est `OutboundMessageService → processOutboundMessage → WhatsAppTransport`.

### SIDIAN_WHATSAPP_SIDIAN_SENDER_E164 exigé en live mais inutilisé par le chemin d'envoi réel

- **Fichier :** `src/lib/communication-channels/whatsapp/env.ts:113`
- **Constat :** env.ts:113-115 ajoute `SIDIAN_SENDER_E164` aux champs obligatoires du mode live. Or l'unique consommateur est `createWhatsAppSidianProvider` (providers/whatsapp-sidian.ts:47) / `loadWhatsAppSidianProviderFromEnv` (ligne 86), tous deux non câblés. Le transport Graph n'utilise que `phoneNumberId` (transport/graph-client.ts:49) et `processOutboundMessage` ne lit jamais `env.senderE164` (outbound/processor.ts:62-96). Une équipe ops doit donc renseigner un E.164 sans effet, ce qui donne une fausse impression de configuration complète.
- **Action :** Retirer `SIDIAN_SENDER_E164` des champs obligatoires live (le garder optionnel, documenté « métadonnée d'affichage »), ou le câbler réellement dans `public_metadata` du canal via `ensure_whatsapp_sidian_channel`.

### Le tag Resend `tenant_hash` transporte un préfixe d'UUID tenant en clair, pas un hash

- **Fichier :** `src/lib/email/outbox/processor.ts:42`
- **Constat :** processor.ts:40-43 : `tags: [{name:'template_key', value: record.templateKey}, {name:'tenant_hash', value: record.tenantId.slice(0,8)}]`. `record.tenantId` est l'UUID `prestataire.id` ; `.slice(0,8)` en est un préfixe littéral, transmis à un tiers (Resend) et corrélable. Le module dispose pourtant de `hashEmailAddress` (address.ts:24) et le logger utilise déjà des hashs (log.ts:38-40).
- **Action :** Remplacer par un vrai digest, ex. `createHash('sha256').update(record.tenantId).digest('hex').slice(0,16)`, et renommer cohéremment.

### L'observabilité par item des drains est un sink null en production

- **Fichier :** `src/lib/runtime/drains/whatsapp/drain.ts:63`
- **Constat :** `const sink = deps.sink ?? createNullDrainObservabilitySink();` (whatsapp/drain.ts:63 et email/drain.ts:76). Aucune des factories `FromEnv` ne passe de `sink` (whatsapp/from-env.ts:79-85, email/from-env.ts:76-80), donc `emitDrainItem` (observability.ts:39) écrit dans le vide : `createNullDrainObservabilitySink` est un `async record() {}` (observability.ts:19-25). Seuls les agrégats de `run-drains.ts:122-135` sont journalisés — impossible de retrouver quel message a été dead-lettered.
- **Action :** Injecter dans les factories FromEnv un sink qui relaie vers `logServerEvent` (les événements ne contiennent que `itemId`, `idempotencyKeyHash`, `errorCode` — déjà sans PII), ou vers `audit_log` pour les dead-letters.

### Les messages WhatsApp entrants non textuels/non interactifs sont ignorés sans trace ni accusé

- **Fichier :** `src/lib/communication-channels/whatsapp/inbound/parse.ts:201`
- **Constat :** `parseSingleMessage` (whatsapp/inbound/parse.ts:162-202) ne gère que `type === 'interactive'` et `type === 'text'` ; tout le reste retourne `null` (ligne 201) et n'est donc jamais inséré dans `communication_inbound_messages`. Un Guide qui répond par un vocal, une photo de virement, un sticker ou une réaction voit son message disparaître : aucune ligne, aucun log (route.ts:199-204 ne compte que `inboundMessages.length`), aucune réponse.
- **Action :** Persister ces messages avec `processingStatus:'unresolved'` et `failureCode:'unsupported_message_type'`, et déclencher `queueGuideConfirmationText` avec un message FR invitant à utiliser les boutons.

### provider_kind='resend' écrit dans email_outbox même quand le provider est désactivé

- **Fichier :** `src/lib/email/outbox/service.ts:51`
- **Constat :** `function resolveProviderKind(env){ if (env.mode==='stub') return 'stub'; return 'resend'; }` (outbox/service.ts:51-54). En mode `disabled`, `enqueue` insère donc `provider_kind:'resend'` (ligne 136) alors que `createEmailProviderFromEnv` renverra un provider qui lève systématiquement `email_provider_disabled` (provider/index.ts:25-36). Les lignes accumulées portent une attribution de provider mensongère et le drain no-op les laisse en `queued` indéfiniment (email/drain.ts:86-88 sort avant tout claim).
- **Action :** Rejeter l'enqueue (`EmailError('email_provider_disabled')`) quand `env.mode === 'disabled'`, ou introduire une valeur `provider_kind='none'` — ce qui suppose d'élargir `email_outbox_provider_kind_ck` (migration 20260726190000:110-112).

### RLS email_outbox : le navigateur authentifié peut lire recipient_email, subject et body_html en clair

- **Fichier :** `supabase/migrations/20260726190000_email_outbox.sql:164`
- **Constat :** `grant select on table public.email_outbox to authenticated;` (ligne 164) + policy `using (tenant_id = public.current_prestataire_id())` (ligne 170), sur une table dont le commentaire dit pourtant « Ne jamais journaliser en clair côté application » (ligne 125). Le SELECT porte sur toutes les colonnes, dont `recipient_email`, `subject`, `body_text`, `body_html`, `variables_snapshot`. Le scope tenant est correct, mais l'exposition est plus large que nécessaire et aucune vue restreinte n'existe.
- **Action :** Révoquer le SELECT direct et exposer une vue `email_outbox_public` (id, template_key, status, sent_at, related_entity_*, recipient_email_hash) avec `security_invoker`, ou restreindre les colonnes via `grant select (…) on public.email_outbox to authenticated`.


## Configuration, environment variables, validation, scripts, observability

### The cron handler logs drains runs under scanner_* event names, corrupting log-based job metrics

- **Fichier :** `src/app/api/cron/_lib/handler.ts:35`
- **Constat :** handleCronRequest takes `job: "scanners" | "drains"` (l.27) but emits `logServerEvent("warn", "scanner_started", { requestId, job: params.job, authError })` on auth failure (l.35-39) and `logServerEvent("error", "scanner_completed", { requestId, job: params.job, reasonCode })` on handler exception (l.69-73). For the every-5-minutes /api/cron/drains route this files drain failures under the scanner event name. Any log query filtering on event name (the only correlation key available, since there is no metrics backend) will attribute drain outages to the scanner job.
- **Action :** Derive the event name from params.job — e.g. `${params.job === "drains" ? "outbox" : "scanner"}_started` / `_completed` — matching the names already used in run-drains.ts ('outbox_sent'/'outbox_failed') and run-scanners.ts.

### Raw Error messages are logged as reasonCode, bypassing key-based redaction

- **Fichier :** `src/app/api/cron/_lib/handler.ts:68`
- **Constat :** handler.ts:67-68: `const reasonCode = error instanceof Error ? error.message.slice(0, 80) : "cron_handler_failed";` then logged at l.69-73. Same pattern at src/lib/runtime/cron/run-drains.ts:141-146. In src/lib/observability/server-logger.ts the key 'reason_code' does not match SENSITIVE_KEY_PATTERN (l.9-10), so the value only passes through sanitizeString (l.18-28), which redacts only bearer tokens, sk_/pk_/rk_/whsec_ prefixes, JWT-shaped strings and email addresses (SENSITIVE_VALUE_PATTERN, l.11-12). A PostgREST or pg error message containing a table name, column name, constraint detail or row value would be logged verbatim up to 80 chars.
- **Action :** Replace the free-form message slice with a closed set of reason codes (the pattern already used by src/lib/agent/observability/reason-codes.ts), mapping unrecognised errors to a generic code and logging only `error.name` — which is what src/app/api/whatsapp/webhook/route.ts:250 already does correctly (`errorCode: error instanceof Error ? error.name : "unknown"`).

### Log redaction covers emails but has no phone-number or E.164 pattern

- **Fichier :** `src/lib/observability/server-logger.ts:9`
- **Constat :** SENSITIVE_KEY_PATTERN (server-logger.ts:9-10) matches authorization|cookie|password|secret|token|api_key|email|iban|card|otp|message|stack|referer|referrer|url|query — no phone, tel, msisdn, e164, wa_id or recipient. SENSITIVE_VALUE_PATTERN (l.11-12) matches bearer tokens, Stripe key prefixes, whsec_, JWTs and email addresses — no `\+[1-9]\d{7,14}` E.164 form. WhatsApp is a first-class channel (10 SIDIAN_WHATSAPP_* vars, a webhook route, an outbound drain), and SIDIAN_WHATSAPP_SIDIAN_SENDER_E164 is validated against exactly that regex at src/lib/communication-channels/whatsapp/env.ts:26. Current call sites happen not to log phone numbers (verified across all 41 logServerEvent sites), so this is a latent gap rather than an active leak.
- **Action :** Add `phone|tel|msisdn|e164|wa_id|recipient` to SENSITIVE_KEY_PATTERN and `\+[1-9]\d{7,14}` to SENSITIVE_VALUE_PATTERN in src/lib/observability/server-logger.ts, and extend src/lib/observability/server-logger.test.ts with a case asserting an E.164 value is redacted.

### No error-reporting or APM integration exists; structured logs go to console only, with no retention or alerting path

- **Fichier :** `package.json:70`
- **Constat :** package.json dependencies are @supabase/ssr, @supabase/supabase-js, lucide-react, next, pdfjs-dist, react, react-dom, server-only, stripe, yaml, zod — no Sentry, OpenTelemetry, Datadog, Logtail, pino or @vercel/analytics (grep across package.json and src/ returns nothing). logServerEvent (src/lib/observability/server-logger.ts:107-117) terminates at console.error/warn/info. The correlation primitive is sound — src/proxy.ts:15-17 mints a UUID per request into x-sidian-request-id and 41 call sites propagate it — but nothing aggregates on it, so the 11 agent detectors and alert-candidates have no delivery channel even if they were wired.
- **Action :** This is a product/ops decision on the destination (Vercel Log Drains to an existing tool, Sentry, or a Supabase observability table). The code side is one change: give logServerEvent an injectable transport so a second sink can be added without touching the 41 call sites.

### pnpm test cannot run without a local Supabase, and the entry-point guard does not actually verify one is running

- **Fichier :** `scripts/test-local-supabase-guard.mjs:1`
- **Constat :** The guard is a pure unit test — its header states 'Tests table-driven du garde-fou loopback + localOnlyFetch — aucun réseau distant' and its 60+ cases only exercise validateLocalSupabaseUrl / validateLocalPostgresUrl / createLocalPgClient with a SpyClient (l.401-467). It never opens a connection. The actual dependency comes from the 17 downstream scripts: resolveLocalTestConfig (scripts/lib/assert-local-supabase.mjs:148-179) pins the target to http://127.0.0.1:54321 with the Supabase CLI demo keys and *rejects* any real SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY in the environment (l.154-172). So `pnpm test` requires `pnpm supabase:start` AND an environment free of cloud keys — and since .env.local carries a real SUPABASE_SERVICE_ROLE_KEY, any shell that sources it makes every suite abort with 'env_service_role_key_not_local_demo'.
- **Action :** Document both prerequisites at the top of the release script or in README: `pnpm supabase:start` must be running, and the shell must not export cloud Supabase keys. Optionally extend test-local-supabase-guard.mjs with a single connectivity probe to http://127.0.0.1:54321/auth/v1/health so the failure is 'Supabase local non démarré' rather than 17 confusing per-suite errors.

### SIDIAN_WHATSAPP_SIDIAN_API_TOKEN is read from process.env but is deprecated, undocumented and silently ignored

- **Fichier :** `src/lib/communication-channels/providers/whatsapp-sidian.ts:97`
- **Constat :** loadWhatsAppSidianProviderFromEnv reads `apiToken: env.SIDIAN_WHATSAPP_SIDIAN_API_TOKEN` (l.97), passed into WhatsAppSidianProviderConfig where the field is annotated `/** @deprecated G1-P utilise SIDIAN_WHATSAPP_ACCESS_TOKEN via WhatsAppEnv. */` (l.20). createWhatsAppSidianProvider (l.43-82) never uses config.apiToken. The variable is absent from .env.example and from the whatsappEnvSchema in src/lib/communication-channels/whatsapp/env.ts. An operator provisioning a token under this name would see it accepted and discarded.
- **Action :** Remove the apiToken field from WhatsAppSidianProviderConfig and the read at l.97, leaving SIDIAN_WHATSAPP_ACCESS_TOKEN (already validated in whatsappEnvSchema:15) as the single credential name.

### test:user-data-isolation exists but is not reachable from any aggregate script

- **Fichier :** `package.json:33`
- **Constat :** package.json:33 defines `"test:user-data-isolation": "node scripts/test-local-supabase-guard.mjs && node scripts/test-user-data-isolation.mjs"` (321 lines). The aggregate at l.68 lists 18 sub-scripts and this is not among them — it stops at test:security-environment before test:forms. Given the RLS-per-prestataire requirement in AGENTS.md ('RLS activée sur toutes les tables prestataire-scopées'), a cross-tenant isolation suite that no aggregate runs is a meaningful gate gap.
- **Action :** Add `pnpm test:user-data-isolation` to the package.json:68 aggregate (or to the new validate:release script), positioned next to test:security-trust-boundaries which covers the adjacent SID-SEC-002..005 surface.


## Conversation / Assistant page — non-regression baseline

### `data-theme="agent-dark"` violates the documented reserved values of the theme attribute

- **Fichier :** `src/components/assistant/conversational-workspace.tsx:4034`
- **Constat :** The workspace root sets `data-theme="agent-dark"`. src/design-system/tokens.css:236-239 states: '`data-theme` est réservé au thème : il ne vaut que `light` ou `dark`' and app-shell.tsx:159-162 deliberately uses `data-appearance` with the comment 'Volontairement PAS `data-theme`'. A live theme system now sets `data-theme` on `<html>` (src/components/theme/theme-provider.tsx:47-49, migration 20260803120000_theme_preference.sql), so this node shadows the document theme with an invalid value for any descendant `[data-theme]` selector.
- **Action :** Rename the hook to `data-appearance="agent-dark"` (or a neutral `data-surface`) and update any test selector that reads it. No visual change — `.agentDark` on the shell already carries the tokens.

### The dark palette is re-declared in four places, so a theme change cannot reach the assistant

- **Fichier :** `src/components/assistant/message-suggestions.module.css:28`
- **Constat :** The same `--ds-color-*` dark values exist in src/design-system/tokens.css `[data-theme="dark"]`, in src/components/app/app-shell.module.css `.agentDark` (lines 8-48), in message-suggestions.module.css:28-39 and in attachment-preview-dialog.module.css:3-13. The last two exist because those surfaces are portalled to `document.body` and escape the shell — the comment at message-suggestions.module.css:26 says exactly that ('Le portail sort du shell agent-dark : on réapplique le thème ici'). composer.tsx:460-462 already shows the clean alternative: it portals its drop overlay into `[data-testid="assistant-shell"]`.
- **Action :** Portal `AttachmentPreviewDialog` and the message-suggestions date drawer into `[data-testid="assistant-shell"]` (falling back to document.body) like the composer overlay, then delete both local palette blocks. Long term, replace `.agentDark` with the `[data-theme="dark"]` block so the workspace can follow the user's preference.

### ~130 hardcoded colour literals across the assistant components pin the surface to dark

- **Fichier :** `src/components/assistant/composer.module.css:15`
- **Constat :** grep of `#hex|rgb(|hsl(` over src/components/assistant (excluding tests) returns 134 occurrences in 15 files: composer.module.css (33 — incl. non-overlay literals `color: #e8ecf2` :349, `color: #ffffff` :405, `color: #d0d5de` :450, shadows `rgb(13 17 23 / …)` :15-17,:31-33, aurora fallbacks `#3b6df8`/`#6b96fa`/`#4fd1c5` :64,:69,:74,:93,:98), attachment-preview-dialog.module.css (20 — full palette :3-13, `#0f1116` :88, `#ffffff` :102/:124, `#101217` :115), message-suggestions.module.css (16 — full palette :28-39, `#050608` :47), protection-panel/protection-panel.module.css (11 — `color-mix(#ffffff …)` :5,:9,:21,:71,:108,:110,:118,:187,:194,:218 + `rgb(0 0 0 / .28)` :22), message-hover-actions.module.css (10 — incl. `var(--ds-color-warning, #e8a54b)` :117, `#050608` :185), conversation-resources.module.css (10 — :15,:16,:21,:34,:37,:88,:108,:120,:124,:153), workspace-name-dialog.module.css (7 — :8,:17,:22,:26,:67,:84,:88), project-personalization.ts (6 — the project colour swatches `#4f76e8 #8875c4 #60977f #bd9652 #c77b55 #cc706d`, asserted by conversational-workspace.test.tsx:1581/1721), composer-shortcuts.module.css (6 — :68,:88,:89,:101,:112,:113), message-card.module.css (4 — :14,:18,:123,:127), workspace-toast.module.css (3 — :19,:22,:28 incl. `var(--ds-color-warning, #f0a020)`), suggestion-date-picker.module.css (3 — :4,:63,`color:#ffffff` :87), message-thread.module.css (3 — :161,:195,:203), project-creation-drawer.module.css (1 — :197), conversational-workspace.module.css (1 — aurora fallback `#3b6df8` :10).
- **Action :** Two classes of fix. (1) The ~90 `color-mix(in srgb, #ffffff N%, …)` and `rgb(0 0 0 / …)` overlays are white/black-on-dark assumptions: introduce `--ds-overlay-raise-N` / `--ds-shadow-*` tokens defined per theme and substitute. (2) The ~25 literal text/surface colours (composer :349/:405/:450, attachment-preview :88/:102/:115/:124, suggestion-date-picker :87) and the token fallbacks (`--ds-color-warning, #e8a54b` vs `#f0a020` — two different fallbacks for the same token) must become plain `var(--ds-color-*)` with no fallback. Keep project-personalization.ts values as-is (brand swatches, test-locked).

### Whole families of composer shortcuts are unreachable dead code

- **Fichier :** `src/components/assistant/shortcuts.ts:83`
- **Constat :** `composerShortcuts` is `showWelcome ? WELCOME_SUGGESTIONS : []` (conversational-workspace.tsx:3817-3819), so DRAFT_SHORTCUTS and CREATED_SHORTCUTS are never rendered. `getComposerShortcuts` is referenced only by shortcuts.test.ts and the barrel index.ts:16. `workspace.shortcutPhase` is written six times (:614,:663,:2257,:2444,:2625,:2859,:3235,:3753) and never read. Consequently the `handleShortcut` branches for `view_actions` (:3342), `find_client` (:3407), `view_protection` (:3446), `edit_amount`/`change_due_date`/`add_contact` (:3478) and the labels `add_document`/`mark_as_paid`/`add_another_invoice` cannot be triggered from the UI (`reopen_protection_panel` is reachable only through `onOpenCard`, :4180).
- **Action :** Delete DRAFT_SHORTCUTS, CREATED_SHORTCUTS, REOPEN_PANEL_SHORTCUT, `getComposerShortcuts`, its barrel export and its tests, plus the unreachable `handleShortcut` branches and the `shortcutPhase` field — or re-expose the draft/created rows if they are still wanted. Do not leave both.

### `onCreateProtection` is threaded through three components to a prop that is never destructured

- **Fichier :** `src/components/assistant/conversational-workspace.tsx:4021`
- **Constat :** The workspace passes `onCreateProtection` (which awaits `handleNewConversation()` then fires the create_protection intent, :4021-4026) to AppShell, which forwards it at app-shell.tsx:195. AppSidebar declares it at app-sidebar.tsx:89 with the comment 'Conservé pour compatibilité d’appel ; l’action n’est plus exposée ici' and never destructures it (destructuring list app-sidebar.tsx:114-135). The handler can never run.
- **Action :** Remove the prop from AppSidebar's type, from AppShell's forwarding and from the workspace, or wire it to a real sidebar control. Note the sibling `onImportInvoice` IS live (app-sidebar.tsx:832).

### Message editing is disabled in production but the whole edit machinery remains wired

- **Fichier :** `src/components/assistant/conversational-workspace.tsx:4161`
- **Constat :** `onEditMessage={usesServerConversationPersistence ? undefined : handleEditMessage}` (:4161-4165), and message-thread.tsx:126-129 computes `canEdit = Boolean(content) && Boolean(onEditMessage)`, so the pencil never renders for real users. The supporting code — `editingMessageId`, `handleEditMessage` (:1958-1977), `handleCancelEditMessage`, `replaceFromEdit` (:3045-3051), the composer edit banner (composer.tsx:500-522) and its Escape handling — only executes in demo/test mode.
- **Action :** Confirm this is intentional (editing a persisted turn would desynchronise public.message). If yes, document it in a comment at :4161 so a future reader does not 'fix' it; if no, implement server-side truncation of the conversation from the edited message before re-enabling.

### A DELETE that returns 404 leaves an undeletable ghost entry in the history list

- **Fichier :** `src/components/assistant/conversation-client.ts:82`
- **Constat :** `deleteAssistantConversation` returns only on status 204 and throws `SAFE_ERROR` for anything else (:93-95). The route returns 404 'Discussion introuvable.' when the conversation no longer exists (src/app/api/assistant/conversations/[id]/route.ts:254-259). `handleDeleteConversation` catches and only toasts 'Impossible de supprimer cette discussion pour le moment.' (:2039-2040) without removing the row, so a conversation already deleted in another tab can never be cleared from the list without a full reload.
- **Action :** Treat 404 as success in `deleteAssistantConversation` (the desired end state is reached) and remove the entry, or on failure re-run `refreshConversationHistory()` so the list re-syncs with the server.

### Empty conversation rows accumulate when a converse call fails or the tab is closed

- **Fichier :** `src/components/assistant/conversational-workspace.tsx:1161`
- **Constat :** `ensureActiveConversation` POSTs the conversation before the agent call (:1161), and the `initialAction=create_protection` effect creates one eagerly (:3585-3597). If the converse then fails or the user leaves, the row stays. `handleNewConversation` deletes an abandoned row only when it is the active one and has zero local messages (:1292-1305). `listConversationHistory` hides them (service.ts:123 filters conversations without messages), so they are invisible but grow unbounded.
- **Action :** Add a scheduled cleanup (existing runtime_jobs infrastructure) deleting `conversation` rows with no `message` and `created_at < now() - interval '1 day'`, scoped by prestataire.

### The persisted assistant text is rebuilt by a second implementation that diverges from what the user saw

- **Fichier :** `src/app/api/agent/tools/route.ts:92`
- **Constat :** `buildPersistedAssistantContent` (route.ts:92-118) duplicates `buildAssistantMessageFromConverse` (src/components/assistant/converse-adapter.ts:71-101). They disagree on the readiness test: the client uses `isDraftReadyForConfirm` = `confirmation_nonce && (READY_STATES.has(state) || missing_fields.length === 0)` (converse-adapter.ts:33-38) while the route uses only `missingFields.length === 0 && confirmationNonce` (route.ts:107, 111-113). For state `RECAPITULATIF` / `CONFIRMATION_EXPLICITE` with a nonce and a non-empty `missing_fields`, the UI appends 'Rien ne sera envoyé avant ta confirmation.' and the stored transcript does not. Cards, suggestions and action buttons are never stored at all. service.ts:290 calls the transcript 'la donnée probatoire'.
- **Action :** Extract the copy builder into a shared module imported by both converse-adapter.ts and the route (it is pure string logic, no client-only dependency), and add a test asserting the rendered content equals the persisted content for each draft state.

### An in-flight conversation creation survives a conversation switch and makes the next send fail

- **Fichier :** `src/components/assistant/conversational-workspace.tsx:1149`
- **Constat :** `ensureActiveConversation` returns `conversationCreationRef.current` before any epoch check (:1149-1151). `handleNewConversation` (:1258) and `clearConversationScopedState` (:1233) bump `conversationEpochRef` but never reset `conversationCreationRef`. The stale in-flight creation then detects the epoch change, deletes its conversation and resolves to `null` (:1164-1166), so the first send in the new conversation hits the `if (!conversationId)` branch (:2106-2115) and shows 'Je n’ai pas pu enregistrer ta demande.' even though nothing is actually broken.
- **Action :** Set `conversationCreationRef.current = null` alongside the epoch bump in `handleNewConversation` and `clearConversationScopedState` (the orphan promise still self-cleans via its epoch check).

### Selecting a history entry with no local snapshot is a no-op after having already cancelled the in-flight request

- **Fichier :** `src/components/assistant/conversational-workspace.tsx:1335`
- **Constat :** In the local/demo path, `handleSelectConversation` bumps the epoch, calls `cancelActiveRequest()` and `commitCurrentLocalConversation()`, then `const snapshot = demoSnapshotsRef.current.get(conversationId); if (!snapshot) return;` (:1335-1336). Any history item supplied through `initialConversationHistory` without a matching snapshot becomes an inert row that also kills any running generation. Only reachable with `demoState` or an injected `agentTransport` (production always takes the server branch), and it is exactly the configuration used by conversational-workspace.test.tsx.
- **Action :** Fall back to `clearConversationScopedState()` + set the active id when no snapshot exists, so the click at least produces a coherent state instead of silently doing nothing.


## Documents, attachments and file storage

### Backend attachment-metadata path is unreachable dead code: the client type omits attachments entirely

- **Fichier :** `src/lib/agent/tools/schemas/protection-draft.ts:35`
- **Constat :** The `protection.draft.advance` message intent accepts `attachments: z.array(attachmentMetaSchema).max(10).optional()`, and `mergeAttachments` (fields.ts:238-254) persists it into `agent_protection_drafts.attachments`. But the browser client type forbids it: `AdvanceInput.intent` in src/components/assistant/protection-panel/api.ts is typed `{ kind: "message"; text: string } | { kind: "correction"; ... } | { kind: "answer"; text: string } | { kind: "acknowledge_recap" }` — no attachments field — and `protectionDraftApi.advance` forwards `intent` verbatim. `grep -rn 'attachment' src/components/assistant/protection-panel/` matches only `attachments_count?: number` in types.ts:91. In production `agent_protection_drafts.attachments` is therefore always `[]` and `attachments_count` always 0.
- **Action :** Decide whether this path is the intended future wiring. If yes, extend `AdvanceInput` and have the composer send metadata AFTER a real upload, with `attachment_id` set to the `document.id` returned by the upload (see next finding). If no, delete `attachmentMetaSchema`, the `attachments` intent field, `mergeAttachments`, and the `attachments jsonb` column to avoid a permanently-empty write path.

### No fabricated extraction anywhere — verified, and the LLM extraction prompt is text-only by construction

- **Fichier :** `src/lib/llm/adapters/conversational-extract.ts:82`
- **Constat :** The only extraction path builds its user turn from three text pieces: `Date de référence (AAAA-MM-JJ): ${input.reference_date}`, the known-fields JSON, and `Message utilisateur:\n${input.user_message}` (lines 96-103). No file bytes, no filename, no attachment metadata is passed. The system prompt states 'N'invente pas de champs absents du message.' and 'Les montants sont des propositions de brouillon, PAS une décision de paiement ni un débit.' (lines 30, 29). In stub/disabled mode it delegates to a deterministic extractor with zero network (lines 66-78). `buildResolvedDocumentReply` for `create_client` is explicit to the user: 'je préparerai la suite sans déduire d'information du document' (document-reference.ts:219). I found no code path that invents amounts, dates, client names or any other field from a file.
- **Action :** No action required — record this as a verified negative. Preserve the property when extraction ships: any field derived from a document must enter through the existing `field_provenance` mechanism as `agent_proposed`, must be shown to the user before `CONFIRMATION_EXPLICITE`, and must never be written as `confirmed` without an explicit user acknowledgement.

### Dead attachment-reply module whose text would be an outright false claim if ever wired

- **Fichier :** `src/components/assistant/general-attachment.ts:5`
- **Constat :** `buildAttachmentAnalysisMessage` returns 'J'analyse ce document.' / 'J'analyse ces N documents ensemble.' — an assertion of an active analysis that does not exist. `grep -rn 'buildAttachmentAnalysisMessage|buildGeneralAttachmentReply' src/ --include='*.ts*'` excluding tests returns no consumer: the entire 20-line module is dead. The same is true of `buildLikelyInvoiceAttachmentReply` and `buildNonInvoiceAttachmentReply` in invoice-attachment.ts:100-135 — only `hasInvoiceAttachmentIntent` and `summarizeInvoiceAttachments` are imported by conversational-workspace.tsx (lines 121-122).
- **Action :** Delete src/components/assistant/general-attachment.ts and its test, and delete `buildLikelyInvoiceAttachmentReply`/`buildNonInvoiceAttachmentReply` from invoice-attachment.ts. Leaving a 'J'analyse ce document.' string in the tree invites a future wiring that lies to the user.

### File picker has no accept attribute — users select files that are then rejected by a toast

- **Fichier :** `src/components/assistant/composer.tsx:486`
- **Constat :** `<input ref={fileInputRef} type="file" multiple aria-label="Choisir des fichiers" ... />` — no `accept`. The OS picker therefore offers every file type, and rejection happens only afterwards via `validateDocumentFiles` → `showWorkspaceToast(validation.rejected.map((item) => item.message).join(" "))` (conversational-workspace.tsx:3949-3954), producing messages like 'X n'est pas un format pris en charge.'
- **Action :** Add an `accept` attribute listing the same MIME allowlist used by the validator, so the picker filters up front. Keep the validator as the authoritative gate (accept is a hint only, and drag/drop and paste bypass it).

### Word, spreadsheet, archive and audio attachments have no preview at all despite being accepted and iconified

- **Fichier :** `src/components/assistant/attachment-preview-dialog.tsx:30`
- **Constat :** `previewKind` returns only 'image' | 'pdf' | 'text' | 'unsupported' (lines 30-43) — anything not `image/*`, PDF, or `text/*` falls to 'unsupported' and renders 'Aperçu indisponible / Ce format ne peut pas être affiché dans Sidian.' (lines 161-167). Yet `classifyAttachmentVisualType` accepts and iconifies `word` (doc/docx), `spreadsheet` (csv/ods/xls/xlsx), `archive` (7z/gz/rar/tar/tgz/zip) and `audio` (aac/flac/m4a/mp3/oga/ogg/opus/wav) — document-attachments.ts:81-94, 167-186 — and `message-thread.tsx` renders a clickable 'Afficher l'aperçu de X' button for all of them (lines 285-296). CSV in particular routes to 'unsupported' because its MIME is `text/csv` only when the OS sets it; when it does, it lands in the unsandboxed iframe path instead.
- **Action :** Either suppress the preview trigger for categories `previewKind` cannot handle (so the button is not offered for archives/audio/Office files), or add real handling: an `<audio controls>` element for audio, and a plain-text table render for CSV. Do not add Office rendering before the sandbox issue above is fixed.

### Blob URLs accumulate for the whole session and are never released for messages dropped by an edit

- **Fichier :** `src/components/assistant/conversational-workspace.tsx:1015`
- **Constat :** `revokeAttachmentPreviews` iterates `attachmentPreviewUrlsRef.current` and revokes everything (lines 1015-1020); it is invoked only on unmount (`useEffect(() => revokeAttachmentPreviews, [...])`, line 1022), on new conversation when server persistence is on (line 1279), and on conversation switch (line 1372). Every send adds one URL per file (`const previewUrl = URL.createObjectURL(file); attachmentPreviewUrlsRef.current.add(previewUrl);`, lines 3012-3014) and the underlying `File` is additionally retained in `previewSource` (line 3038). When an edit truncates the thread (`replaceFromEdit` → `currentMessages.slice(0, editIndex)`, lines 3044-3049) the discarded messages' blob URLs and File references stay in the ref and in memory. With `COMPOSER_MAX_FILES = 6` and `MAX_DOCUMENT_FILE_SIZE = 20 MB`, a single send can pin 120 MB for the rest of the session.
- **Action :** Track blob URLs per message id rather than in a flat Set, and revoke the entries belonging to messages removed by `replaceFromEdit` and by the document `remove`/`keep` actions (document-reference.ts). Drop `previewSource` once the PDF has been rasterised, since `PdfDocumentPreview` already falls back to `fetch(url)` when `source` is absent (pdf-document-preview.tsx:43-47).

### No malware/content scanning is planned or stubbed anywhere in the upload design

- **Fichier :** `src/components/assistant/document-attachments.ts:32`
- **Constat :** `validateDocumentFiles` performs exactly three checks — `file.size === 0` → 'empty', `file.size > MAX_DOCUMENT_FILE_SIZE` → 'too_large', `classifyAttachmentVisualType(file) === "unknown"` → 'unsupported' (lines 39-65). There is no content sniffing (the declared MIME is trusted verbatim), no magic-byte verification that a '.pdf' really is a PDF, and no scanning hook. Nothing in supabase/migrations or src/lib references a scanner. The product's premise is that users import documents received from third-party clients, which is precisely the untrusted-input case.
- **Action :** When the upload path is built, verify magic bytes server-side against the declared content type before the document row is marked usable, store the detected type rather than the client-declared one, and add a quarantine state (`document.scan_status`) so a file is not served by a signed URL until it passes. Decide separately whether a third-party AV scan is in scope for MVP.

### Composer allows sending with files and no text, producing a user message with empty content

- **Fichier :** `src/components/assistant/composer.tsx:268`
- **Constat :** `const canSend = !isBlocked && (trimmed.length > 0 || files.length > 0);` and `handleSend` mirrors it: `if ((!trimmed && !hasFiles) || ...) return;` (conversational-workspace.tsx:2667-2675). The resulting `userMessage` has `content: userContent` where `userContent = trimmed` = '' (lines 2989, 3032-3034). `MessageThread` guards rendering with `Boolean(message.content.trim() || attachments.length > 0)` (message-thread.tsx:85) so it displays, but the value is empty. This collides directly with `public.message`'s `constraint message_contenu_non_vide check (char_length(trim(contenu)) > 0)` (core_tables.sql:156) and with `userContent: z.string().trim().min(1)` in src/app/api/assistant/conversations/[id]/route.ts:40 — meaning the moment the P0 persistence fix is applied, a files-only send will fail validation.
- **Action :** Fix this together with the P0: when `trimmed` is empty and attachments exist, synthesise a persisted content string from the filenames (e.g. `Documents joints : facture.pdf, contrat.pdf`) so the DB constraint and the Zod schema are both satisfied, and keep the rendered bubble showing only the attachment chips.


## Security, RLS, multi-tenant isolation

### current_prestataire_id() — the linchpin of every RLS policy — does not pin pg_temp in search_path

- **Fichier :** `supabase/migrations/20260715120100_core_tables.sql:267`
- **Constat :** ```\ncreate or replace function public.current_prestataire_id()\nreturns uuid language sql stable security definer\nset search_path = public\n```\nThis function is referenced by 30+ RLS policies and is granted EXECUTE to `authenticated` (line 276). It is never redefined in any later migration — I grepped all 50 files for `function public.current_prestataire_id`. Every other SECURITY DEFINER function in the repo (159 occurrences) uses `set search_path = pg_catalog, public, pg_temp`. The body is fully schema-qualified (`public.prestataire`, `auth.uid()`), so the practical exposure is limited, but the deviation is exactly on the one function whose compromise would collapse the entire multi-tenant boundary.
- **Action :** Add a migration with `alter function public.current_prestataire_id() set search_path = pg_catalog, public, pg_temp;` — no body change required. Do the same for `public.ensure_prestataire_for_current_user(text)` (20260716220000_sid_sec_001_prestataire_onboarding_rpc.sql:16), the only other still-live function with the weak setting.

### ensure_prestataire_for_current_user uses search_path = public

- **Fichier :** `supabase/migrations/20260716220000_sid_sec_001_prestataire_onboarding_rpc.sql:16`
- **Constat :** `security definer` / `set search_path = public` on a plpgsql function that reads `auth.users` and inserts into `public.prestataire`, granted EXECUTE to `authenticated` (20260717220000_sid_sec_001_prestataire_update_hardening.sql:144). It is the account-creation path — it reads `u.email, u.email_confirmed_at` from auth.users under definer rights. Never redefined with the stronger setting in any later migration.
- **Action :** Include in the same `alter function ... set search_path = pg_catalog, public, pg_temp` migration as current_prestataire_id().

### Rate-limit pseudonymisation reuses SUPABASE_SERVICE_ROLE_KEY as its HMAC key

- **Fichier :** `src/lib/security/rate-limit.ts:68`
- **Constat :** ```\nconst key = getSupabaseServerEnv().SUPABASE_SERVICE_ROLE_KEY;\nreturn createHmac("sha256", key).update(`${category}:${value}`).digest("hex");\n```\nThis directly contradicts the design rule stated in src/lib/stripe/authorizations/token.ts:14-15: "Ne dérive jamais de SUPABASE_SERVICE_ROLE_KEY : la rotation du secret d'autorisation est indépendante de la clé service_role." Two operational consequences: rotating the service-role key invalidates every stored `subject_hash` in public_rate_limit_event, resetting all auth/checkout/webhook quotas to zero at exactly the moment (a key compromise) you least want them reset; and the service-role key is now loaded into HMAC context on every unauthenticated public payment page view (src/lib/stripe/checkout/create-payment-session.ts:108).
- **Action :** Introduce a dedicated `SIDIAN_RATE_LIMIT_SUBJECT_SECRET` (min 32 chars, same zod shape as `paymentAuthorizationTokenSecretSchema` at src/config/env-server.ts:13-19) and use it in pseudonymizeRateLimitSubject. Accept that existing buckets reset once on cutover.

### No Origin/CSRF check on the JSON API routes — SameSite=Lax is the sole defence

- **Fichier :** `src/app/api/assistant/conversations/[id]/route.ts:89`
- **Constat :** PATCH/POST/DELETE on the assistant routes and POST on /api/agent/tools authenticate purely from the cookie session via `resolveAssistantConversationRequestContext()` and never inspect `Origin` or `Sec-Fetch-Site`. Unlike Server Actions, Next.js Route Handlers get no built-in origin validation. The saving grace is src/lib/supabase/auth-response.ts:17 `sameSite: "lax"`, which stops cookies riding cross-site POSTs — so this is currently not exploitable, but it is a single-control defence and one cookie-option change away from being a live CSRF surface (including DELETE of conversations).
- **Action :** Add a shared guard that rejects mutating methods when `Sec-Fetch-Site` is `cross-site` or when `Origin` is present and does not match `NEXT_PUBLIC_APP_URL`. Apply it in the assistant routes and /api/agent/tools alongside the existing 401 path.

### Environment attestation is memoised for the process lifetime and never re-verified

- **Fichier :** `src/lib/supabase/environment-attestation.ts:80`
- **Constat :** ```\nsuccessfulAttestation ??= verifySupabaseDeploymentEnvironment().catch((error) => {\n  successfulAttestation = undefined; throw error;\n});\n```\nOn first success the resolved promise is cached in module scope forever. `SUPABASE_ENVIRONMENT_ATTESTATION_JWT` has an `exp` claim that next.config.ts:144-145 checks at build time, but a warm lambda that attested once will keep serving indefinitely after that JWT expires or after the attestor role is revoked. Only failures reset the cache.
- **Action :** Store the attestation timestamp alongside the promise and re-verify after a bounded TTL (e.g. 15 minutes), so revocation of the attestor role or JWT expiry takes effect within one TTL on long-lived instances.

### clientIpFromHeaders collapses every caller into one shared rate-limit bucket off Vercel

- **Fichier :** `src/lib/stripe/checkout/client-ip.ts:18`
- **Constat :** `if (!trustedVercelProxy) return "untrusted-proxy";` where `trustedVercelProxy = process.env.VERCEL === "1"`. The ignoring of `x-forwarded-for` is correct and well-reasoned (lines 5-12). But the fallback is a single constant string, so every IP-keyed category — auth_signin_ip (30/10min), auth_signup_ip (10/10min), checkout_creation_ip (5/10min), link_resolution_ip (30/10min) — becomes one global bucket whenever `VERCEL` is unset. checkout_creation_ip at 5 per 10 minutes globally would make the public payment page unusable, and auth_signin_ip would lock out all users after 30 sign-ins.
- **Action :** Either fail closed (throw at startup if `SIDIAN_ENVIRONMENT` is staging/production and `VERCEL !== "1"`), or make the trusted-proxy header set configurable so a non-Vercel deployment can name its own trusted header. Do not leave a shared constant behind IP-keyed quotas.

### /api/health is unauthenticated and discloses environment name and DB connectivity

- **Fichier :** `src/app/api/health/route.ts:24`
- **Constat :** `NextResponse.json({ status, app: "sidian-v2", environment, database })` with no auth. `environment` comes from `getAppEnvironment()` (src/config/env-shared.ts:14) which returns the raw `VERCEL_ENV` string, and `database` returns a `DatabaseHealthStatus` such as "connected" / "not_configured". This gives an unauthenticated caller a reliable oracle for deployment topology and for whether Supabase is reachable — useful for timing an attack around a DB outage.
- **Action :** Reduce the public body to `{ status: "ok" | "unavailable" }` and move `environment` / `database` behind the existing `assertCronAuthorized` Bearer check (src/lib/runtime/cron/auth.ts:50), or behind a separate ops token.

### Route module exports a mutable dependency setter into the production bundle

- **Fichier :** `src/app/api/whatsapp/webhook/route.ts:83`
- **Constat :** ```\nlet deps: WhatsAppWebhookDeps | null = null;\nexport function setWhatsAppWebhookDeps(next: WhatsAppWebhookDeps): void { deps = next; depsInit = Promise.resolve(next); }\n```\nplus `export { createSupabaseWebhookEventRepository, createLiveWhatsAppWebhookDeps }` at line 254. These are test seams living in a Next.js route module. They are not reachable over HTTP (App Router only dispatches the exported method handlers), so this is not an exploit path — but a writable module-scope handle to the service_role-backed repositories persists for the lifetime of a warm lambda, and any future in-process import of this module can repoint persistence. `assertLiveWebhookPersistence` (line 153) only checks the memory-vs-Supabase flag, not the identity of the client.
- **Action :** Move `setWhatsAppWebhookDeps` and the re-exports into a sibling non-route module (e.g. src/lib/communication-channels/whatsapp/webhook/deps.ts) that tests import directly, leaving route.ts exporting only GET/POST and the route config.

### Dev preview routes can be enabled in production by a single env var

- **Fichier :** `src/app/dev/assistant/page.tsx:34`
- **Constat :** ```\nfunction isAssistantPreviewAllowed(): boolean {\n  if (process.env.NODE_ENV !== "production") return true;\n  return process.env.SIDIAN_ALLOW_DEV_ASSISTANT_PREVIEW === "1";\n}\n```\nThe route renders demo fixtures from src/components/assistant/demo-states.ts, not real tenant data, so the blast radius is disclosure of unreleased UI rather than customer data. But it is an unauthenticated route (no `requireConfirmedUser()`) whose exposure depends on an env var that a rushed deploy could carry over from a staging config. src/app/dev/workspace/page.tsx follows the same pattern.
- **Action :** Gate on `getApplicationEnvironment() === "local"` from src/config/env-server.ts instead of on NODE_ENV plus an opt-in flag, so the route cannot be turned on in a staging or production deployment at all.

### Auth session cookie is not marked Secure outside Vercel preview/production

- **Fichier :** `src/lib/supabase/auth-response.ts:18`
- **Constat :** ```\nsecure: vercelEnvironment === "preview" || vercelEnvironment === "production",\n```\nwith `vercelEnvironment` defaulting to `process.env.VERCEL_ENV`. Any deployment where `VERCEL_ENV` is unset — a self-hosted build, a container, a Vercel build where the variable is stripped — serves the Supabase session cookie without the Secure attribute, allowing it to be transmitted over plain HTTP. Related to the VERCEL_ENV gating finding above; called out separately because the fix is local and the cookie is the session bearer.
- **Action :** Set `secure: true` unconditionally except when the resolved environment is genuinely local (`getApplicationEnvironment() === "local"`), and add the `__Host-` prefix if the Supabase SSR cookie naming permits it, which also forces path=/ and no Domain.

### Superseded weak-search_path definitions remain replayable in migration history

- **Fichier :** `supabase/migrations/20260729120100_user_data_isolation_rls_inventory.sql:7`
- **Constat :** `sidian_assert_rls_enabled()` is defined here with `set search_path = public` and a 14-table list, then redefined 100 seconds later in 20260729120200 with `pg_catalog, public, pg_temp` and 19 tables. supabase/migrations/20260715120600_test_helpers.sql:7 holds a third, earlier definition also with `set search_path = public`. Since all three use `create or replace`, the final applied state is correct on a clean forward migration — but any out-of-order replay, cherry-pick, or partial-reset workflow can leave the weak definition live, and the file pair is confusing for anyone auditing the guard.
- **Action :** Nothing to fix in the applied schema; add a note in the 20260715120600 and 20260729120100 files pointing at 20260729120200 as the authoritative definition, and fold the coverage fix from the P1 finding into a single new migration so there is one current definition.

### Several defence-in-depth response headers are absent

- **Fichier :** `next.config.ts:275`
- **Constat :** `globalSecurityHeaders` sets CSP, COOP `same-origin`, CORP `same-origin`, Referrer-Policy `strict-origin-when-cross-origin`, HSTS, Permissions-Policy, X-Content-Type-Options `nosniff`, X-DNS-Prefetch-Control `off`, X-Frame-Options `DENY`. Absent: `Cross-Origin-Embedder-Policy` (so COOP alone does not give cross-origin isolation), `X-Permitted-Cross-Domain-Policies: none`, and any CSP `report-to`/`report-uri` — meaning a CSP violation in production is invisible, which will make the nonce migration in the P1 finding hard to validate safely.
- **Action :** Add `X-Permitted-Cross-Domain-Policies: none` and a CSP reporting endpoint. Ship the nonce change in `Content-Security-Policy-Report-Only` first, watch the reports, then promote to enforcing.

### payment_reconciliation_issue has RLS with no policy and no authenticated grant

- **Fichier :** `supabase/migrations/20260721210400_sid_prod_004_payment_reconciliation.sql:49`
- **Constat :** ```\nalter table public.payment_reconciliation_issue enable row level security;\nrevoke all on table public.payment_reconciliation_issue from public, anon, authenticated, service_role;\ngrant select on table public.payment_reconciliation_issue to service_role;\n```\nSecurity-wise this is the safest possible configuration (deny by default, writes only through the SECURITY DEFINER trigger `enforce_payment_reconciliation_issue_scope` which cross-checks creance/tentative/approval tenancy). Flagged only so the posture is deliberate: a prestataire cannot read their own reconciliation issues through PostgREST, so any in-app surfacing of `human_required` outcomes (src/app/actions/payment-reconciliation.ts:49-50 returns that status) must go through a service_role path or a new tenant-scoped RPC.
- **Action :** Confirm this is intended. If the /app/approbations surface needs to show these rows, add a `for select to authenticated using (prestataire_id = public.current_prestataire_id())` policy plus `grant select to authenticated` — do not widen it to any DML.

### Theme preference cookie is deliberately non-HttpOnly

- **Fichier :** `src/app/actions/theme.ts:29`
- **Constat :** `httpOnly: false` with the documented rationale at lines 19-21: the anti-flash script at src/app/layout.tsx:53 must read it before first paint. `secure: process.env.NODE_ENV === "production"`, `sameSite: "lax"`, value constrained by `isThemePreference()` before being written and the DB write goes through `set_current_prestataire_theme_preference` which derives the tenant from auth.uid(). No security impact — the value is a display choice, not a secret. Recorded so the exception is not re-litigated in a future audit.
- **Action :** No change needed. If the CSP nonce work lands, the script can read the preference from a server-rendered `data-theme-preference` attribute (already present at src/app/layout.tsx:39) and the cookie could then become HttpOnly.


## Stripe integration and Sidian subscription plans

### Aucune politique de rétention sur processed_webhook_event / stripe_webhook_effect

- **Fichier :** `supabase/migrations/20260720120000_sid_stripe_001_fix_2.sql:19`
- **Constat :** `claim_stripe_webhook_event` insère une ligne `processed_webhook_event` par `event.id` Stripe et la conserve indéfiniment (la déduplication repose sur `on conflict (id) do nothing`). `stripe_webhook_effect` reçoit une ligne par effet appliqué. Aucune fonction de purge n'existe pour ces deux tables dans supabase/migrations (grep `delete from public.processed_webhook_event` = 0). docs/SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md §6.5 prévoit une rétention RGPD.
- **Action :** Définir une fenêtre de rétention (≥ 30 j, supérieure à la fenêtre de retry Stripe) et ajouter une purge cron batchée sur `processed_webhook_event` (statuts terminaux uniquement) et `stripe_webhook_effect` corrélé.

### L'action de réconciliation est sans quota et sans garde `isStripePaymentsEnabled`, avec jusqu'à ~76 appels Stripe par clic

- **Fichier :** `src/app/actions/payment-reconciliation.ts:53`
- **Constat :** `reconcilePaymentReceivableAction` n'appelle ni `isStripePaymentsEnabled()` ni `consumePublicRateLimit`. `reconcilePaymentReceivableFromStripe` fait 1 `accounts.retrieve` puis, pour chaque tentative (jusqu'à MAX_RECONCILED_ATTEMPTS = 25, src/lib/stripe/reconciliation/payment-reconciliation.ts:32), 1 `checkout.sessions.retrieve` + 1 `paymentIntents.retrieve` + 1 `customers.retrieve` (retrieveAttemptObjects, lignes 289-321).
- **Action :** Ajouter un quota persistant par prestataire (nouvelle catégorie `payment_reconciliation_prestataire`, ex. 5/10 min) et un garde `isStripePaymentsEnabled()` en tête d'action.

### L'exécuteur agent lit le flag paiements en brut au lieu de la validation cohérente `getStripeReadiness`

- **Fichier :** `src/lib/agent/server/auth/create-router.ts:67-69`
- **Constat :** `readPaymentsEnabledFlag()` fait `process.env.NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED === "true"`, contournant `validateStripeEnvironment` (cohérence STRIPE_MODE / SIDIAN_ENVIRONMENT / préfixes sk_/pk_ / JWT writer). Ce booléen alimente la porte `payments_enabled` de la checklist (src/lib/runtime/payments/checklist.ts:33-40) et `PaymentExecutorDeps.paymentsEnabled`. Le fail-closed final n'est assuré que plus tard par `getStripeClient()` dans stripe-off-session.ts:33.
- **Action :** Remplacer par `isStripePaymentsEnabled()` (enveloppé d'un try/catch renvoyant false) pour que toutes les portes lisent la même source de vérité.

### Les 5 avertissements no-unused-vars de create-setup-session.ts sont des types morts, pas du code incomplet

- **Fichier :** `src/lib/stripe/authorizations/create-setup-session.ts:35`
- **Constat :** `pnpm exec eslint src/lib/stripe/authorizations/create-setup-session.ts` renvoie exactement 5 warnings, tous sur des alias de types jamais référencés : `ProposalPreparation` (35), `SetupContext` (39), `SetupClaim` (54), `PublicAuthorizationProjection` (64), `ReconsiderationContext` (74). Toutes les lectures de RPC passent en réalité par `rpcJson()` (ligne 143) qui renvoie `Record<string, unknown>`, puis par `rpcString`/`rpcBoolean` (156, 164). Aucun champ décrit par ces types n'est laissé non traité : les 5 fonctions publiques lisent bien authorization_id, etat, expired, stripe_account_id, stripe_customer_id, authorization_text_version, source_checkout_session_id, stripe_setup_checkout_session_id, setup_provisioning_status, prestataire_id, client_payeur_id, idempotency_key, lease_token. Le fichier est donc complet ; les types sont des vestiges d'une approche typée abandonnée.
- **Action :** Supprimer les 5 alias (lignes 35-83), ou — préférable — les réutiliser en remplaçant `rpcJson(): Record<string, unknown>` par une signature générique typée `rpcJson<T>()` afin de retrouver la sécurité de type sur les 12 champs lus dynamiquement.

### `platform_fee_basis_points` n'est jamais lu : la commission 0 % est codée en dur en deux endroits

- **Fichier :** `src/lib/stripe/checkout/create-payment-session.ts:524`
- **Constat :** `p_application_fee_amount: 0` est écrit en dur, et la Checkout Session créée (lignes 483-506) ne passe aucun `application_fee_amount` à Stripe. Côté off-session, `deps.applicationFeeAmount ?? 0` (src/lib/runtime/payments/service.ts:97) n'est jamais renseigné par l'appelant de production (src/lib/agent/server/auth/create-router.ts:163-169). Grep `platform_fee_basis_points` hors database.generated ne renvoie qu'une seule ligne, un trigger d'immuabilité (supabase/migrations/20260717220000:30). docs/SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md:389 prévoit pourtant « Commission via application_fee_amount / platform_fee_basis_points ».
- **Action :** Conforme au 0 % Early Access, mais documenter que la réintroduction d'une commission exige un changement de code, pas un simple UPDATE en base ; ou dès maintenant dériver le montant depuis `prestataire.platform_fee_basis_points` (valeur 0 aujourd'hui) pour supprimer la constante.

### Incohérence `application_fee_amount` : 0 explicite en off-session vs omis en Checkout

- **Fichier :** `src/lib/runtime/payments/stripe-off-session.ts:45`
- **Constat :** `paymentIntents.create` passe `application_fee_amount: input.applicationFeeAmount` (valeur 0), alors que `checkout.sessions.create` n'envoie aucun `application_fee_amount` (src/lib/stripe/checkout/create-payment-session.ts:483-506). Par ailleurs `assertPaymentIntentProjectionIdentity` compare strictement `stripeFee !== localFee` (src/lib/stripe/webhooks/payment-intent-identity.ts:75) : si Stripe normalise différemment un 0 explicite et une absence, l'identité webhook échoue de façon terminale.
- **Action :** Uniformiser : ne pas envoyer `application_fee_amount` quand le montant vaut 0, sur les deux chemins. Valider en mode test (docs/operations/STRIPE_TEST_MODE_VALIDATION.md) que Stripe accepte bien la valeur 0 avant de la conserver.

### `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` est obligatoire pour activer le module mais n'est jamais utilisée

- **Fichier :** `src/config/env-server.ts:37-39`
- **Constat :** La clé est exigée par `stripeEnabledEnvSchema` et sa cohérence de mode est vérifiée (ligne 110-118), mais grep sur src/ ne montre que des lectures/validations d'environnement (env-public.ts:16, 21, 25, 63 ; env-server.ts:37, 110, 272, 291) — aucun composant ne charge Stripe.js. Le parcours de paiement est intégralement hébergé (redirect vers checkout.stripe.com ; CSP `form-action` autorise checkout.stripe.com et connect.stripe.com, next.config.ts:262).
- **Action :** La conserver comme garde de cohérence de mode est défendable, mais le documenter explicitement dans .env.example (« non utilisée au runtime — sert uniquement à détecter une incohérence test/live ») pour éviter qu'on croie Stripe.js embarqué.

### Exports Stripe morts (jamais appelés hors index.ts ou tests)

- **Fichier :** `src/lib/stripe/index.ts:1`
- **Constat :** Vérifié par grep -rl sur src/ en excluant les tests : `MVP_CURRENCY`, `assertMvpCurrency`, `assertCreanceDeviseEur` (src/lib/stripe/shared/currency.ts) n'apparaissent que dans leur module et index.ts ; `assertConnectedAccountPayable` (retrieve-and-sync.ts:187) idem ; `replaceStripeCustomerBinding` et `revokeStripeCustomerBinding` (bindings.ts:37, 135) idem ; `assertAllowlistedAccountLinkUrl` (create-account-link.ts:99) et `createStripeClient` (client.ts:47) n'ont aucun appelant du tout. Les contrôles de devise sont réimplémentés en ligne ailleurs (create-payment-session.ts:308, payment-effects.ts:66-75, checklist.ts:67-78).
- **Action :** Supprimer les exports morts ou brancher `assertCreanceDeviseEur`/`assertMvpCurrency` sur les trois sites de vérification EUR dupliqués, pour que la règle « MVP strict EUR » ait une seule définition.

### Hors Vercel, tous les payeurs partagent un unique seau de quota `checkout_creation_ip` de 5/10 min

- **Fichier :** `src/lib/stripe/checkout/client-ip.ts:18`
- **Constat :** `if (!trustedVercelProxy) return "untrusted-proxy";` — `trustedVercelProxy` vaut `process.env.VERCEL === "1"`. Le sujet pseudonymisé est alors identique pour toutes les requêtes. Le quota `checkout_creation_ip` est de 5 requêtes / 10 minutes (supabase/migrations/20260721200100_sid_sec_006_rate_limit_policy.sql:35-37) et gouverne aussi `createAuthorizationSetupSession`, `declineAuthorizationProposal` et `prepareAuthorizationReconsideration`.
- **Action :** Documenter que le déploiement de production doit être sur Vercel, ou rendre la liste d'en-têtes de confiance configurable (`SIDIAN_TRUSTED_PROXY_HEADER`) avec fail-closed si non renseignée hors Vercel.

### Hors Vercel, `getApplicationEnvironment()` renvoie `local` — un déploiement de production non-Vercel serait forcé en mode test sans message explicite

- **Fichier :** `src/config/env-server.ts:256-260`
- **Constat :** `if (process.env.VERCEL_ENV === "production") return "production"; if (…=== "preview") return "staging"; return "local";`. `validateStripeEnvironment` exige ensuite `appEnvironment !== "production" ⇒ STRIPE_MODE === "test"` (lignes 119-125). Une production auto-hébergée avec des clés live échouerait donc sur « Configuration Stripe incohérente avec l'environnement » sans indiquer que la cause est l'absence de VERCEL_ENV.
- **Action :** Faire dériver l'environnement de `SIDIAN_ENVIRONMENT` (déjà obligatoire et déjà recoupé avec l'attestation Supabase) et n'utiliser VERCEL_ENV que comme contre-vérification, avec un message d'erreur nommant la variable fautive.

### Aucun traitement des remboursements et de la clôture de litige

- **Fichier :** `src/lib/stripe/webhooks/event-types.ts:7-19`
- **Constat :** La liste `SIDIAN_STRIPE_WEBHOOK_EVENTS` contient `charge.dispute.created` mais ni `charge.refunded`, ni `charge.refund.updated`, ni `charge.dispute.closed`, ni `payment_intent.canceled`. Un remboursement émis depuis le Dashboard Express du prestataire laisse donc `paiement` et `creance.etat = REGLEE` inchangés. Cette liste est conforme au verrou de docs/SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md §5.1bis, qui marque explicitement le sujet `[MIGRATION À PRÉVOIR]` (objet `payment_dispute`). docs/operations/PRE_DEPLOYMENT_CHECKLIST.md:96 liste « Événements refund/dispute | Connect | [ ] À faire ».
- **Action :** Post-lancement : introduire `payment_dispute` / `remboursement` et les événements associés, sans surcharger `creance.etat`. Entre-temps, documenter dans le runbook que tout remboursement fait au Dashboard doit être répercuté manuellement.

### `beginStripeConnectAction` et /p/retour ne testent pas `isStripePaymentsEnabled()` — message d'erreur trompeur

- **Fichier :** `src/app/app/connexion-stripe/actions.ts:67`
- **Constat :** L'action appelle directement `ensureConnectedAccountForCurrentPrestataire` → `getStripeClient()` → `getStripeServerEnv()` qui lève « Module de paiement Stripe désactivé. ». `classifyStripeFailure` sur une `Error` nue renvoie `{code:"stripe_unexpected", disposition:"retryable"}` (src/lib/stripe/shared/errors.ts:61), donc `connectErrorMessage` affiche « Stripe est temporairement indisponible. Réessayez dans quelques instants. » (ligne 52). Même absence de garde sur src/app/p/retour/page.tsx (aucun appel à isStripePaymentsEnabled, contrairement à src/app/p/[token]/page.tsx:25).
- **Action :** Ajouter le garde en tête des deux chemins et renvoyer un message distinct (« L'encaissement n'est pas activé sur cet environnement ») plutôt qu'une indisponibilité temporaire.

### `pricing_version` sert d'étiquette d'affichage sans aucun droit associé

- **Fichier :** `src/app/app/assistant/page.tsx:39-42`
- **Constat :** `planLabelFromPricingVersion` renvoie « Early Access » si la valeur vaut `early_solo`, sinon `undefined`. `early_solo` est bien le défaut des nouveaux comptes (supabase/migrations/20260719150000_sid_stripe_001_connect_payment_foundation.sql:84), l'ancien défaut `early_access_49` (20260715120100:10) subsistant pour l'historique. Aucun quota, limite de clients, limite de créances ou d'utilisateurs n'est dérivé de cette valeur nulle part (grep `quota`/`tier`/`limit` sur src/ ne renvoie que du rate limiting HTTP).
- **Action :** Aucune correction technique nécessaire aujourd'hui, mais si la grille Solo/Studio/Agence de 02 §6 (10/30/100 clients actifs) est retenue, prévoir une table `plan` + une couche d'entitlements distincte de `pricing_version`, qui reste par décision une provenance historique et non un droit.


## Theming

### Two components re-declare the dark palette locally and are therefore permanently dark

- **Fichier :** `src/components/assistant/message-suggestions.module.css:26`
- **Constat :** `message-suggestions.module.css:26-39` carries the comment « Le portail sort du shell agent-dark : on réapplique le thème ici. » followed by `color-scheme: dark;` and 11 duplicated `--ds-color-*` overrides. `attachment-preview-dialog.module.css:2-13` duplicates the same 11 values on `.backdrop`. Both are partial copies of `app-shell.module.css:10-48` and will drift.
- **Action :** Once the palette lives at `:root[data-theme]`, delete both local blocks — a portal rendered under `<body>` inherits from `:root` automatically. If the portal must be pinned dark regardless of user theme, render it inside an element carrying `data-theme="dark"` rather than copying hex values.

### Seventeen --assistant-* colour tokens in globals.css are dead code and would double the dark palette to maintain

- **Fichier :** `src/app/globals.css:164`
- **Constat :** `--assistant-bg/surface/sidebar/sidebar-text/sidebar-muted/sidebar-line/sidebar-hover/composer/panel/bubble/bubble-user/text/muted/line/hover/accent/composer-shadow` (lines 164-181) plus their `@theme inline` mappings (lines 240-249) which generate `bg-assistant-*` utilities. `grep -rn -- '--assistant-' src/ | grep -v globals.css` returns only `--assistant-keyboard-offset` (`conversational-workspace.module.css:175`, `conversational-workspace.tsx:4213,4216`) — an unrelated layout variable. No `.tsx` uses any `bg-assistant-*`/`text-assistant-*` class.
- **Action :** Delete lines 164-181 and the corresponding `@theme inline` block (239-249) before building the dark palette, so the dark set does not have to cover 17 unused properties.

### Eleven further globals.css colour tokens are dead and should not be carried into the dark palette

- **Fichier :** `src/app/globals.css:45`
- **Constat :** Zero references outside globals.css for: `--surface-sidebar` (:45), `--surface-empty` (:47, only used by the `.sidian-empty` helper class which itself has no `.tsx` consumer), `--surface-loading` (:48), `--text-link` (:55), `--text-inverse` (:54), `--border-focus` (:60), `--state-hover-bg` (:63), `--state-active-bg` (:64), `--state-focus-ring` (:68), `--overlay-scrim` (:152), `--scrollbar-thumb`/`--scrollbar-thumb-hover` (:148-149, referenced only by `.dashboard-card-scroll` in globals.css itself). Also unused: `--sidian-ardoise` (:13), `--sidian-ciel` (:17), `--sidian-gris-600` (:27), `--sidian-blue-active` — the last is used, at `approval-decision.tsx:28` and `follow-up-controls.tsx:168` via `active:bg-sidian-blue-active`.
- **Action :** Prune the genuinely dead ones. Keep and re-alias `--sidian-ciel` — `docs/SIDIAN_DESIGN_SYSTEM.md:68,134` designates Ciel #6B96FA as the recommended dark accent, and `app-shell.module.css:21` already uses that exact value for `--ds-color-accent` in dark.

### --overlay-scrim inverts to a white scrim under dark

- **Fichier :** `src/app/globals.css:152`
- **Constat :** `--overlay-scrim: color-mix(in srgb, var(--sidian-nuit) 40%, transparent);` where `--sidian-nuit` is `var(--ds-color-text-primary)` (:12). In dark that is `#f4f6fa`, producing a 40% white scrim. Currently harmless because the token has zero consumers, but it is a live trap for anyone who adopts it.
- **Action :** Redefine as `--overlay-scrim: var(--ds-color-overlay);` — `tokens.css:56-60` and `app-shell.module.css:48` already define correct light and dark values for that role.

### --ds-shadow-xl has no dark override in the existing dark palette

- **Fichier :** `src/components/app/app-shell.module.css:54`
- **Constat :** `.agentDark` defines `--ds-shadow-xs` (:49), `--ds-shadow-sm` (:50-52), `--ds-shadow-md` (:53), `--ds-shadow-lg` (:54) — but not `--ds-shadow-xl`, which `tokens.css:151` sets to `0 20px 48px rgb(13 17 23 / 0.12)`. Any component using `shadow-ds-xl` keeps a light-tuned, too-weak shadow in dark.
- **Action :** Add `--ds-shadow-xl: 0 40px 88px rgb(0 0 0 / 0.42);` (or equivalent) to the dark block for completeness.

### data-theme is decorative today — nothing in CSS selects on it

- **Fichier :** `src/components/app/app-shell.tsx:159`
- **Constat :** `data-theme={isAgentDark ? "agent-dark" : isWorkspace ? "assistant-light" : "light"}`. `grep -rn '\[data-theme' src/` across all `*.css` returns zero matches — no stylesheet selects on it. All actual styling comes from the CSS-module class `styles.agentDark` (line 165). The attribute is only read by tests (`app-shell.test.tsx`, `assistant-navigation.test.tsx:225`, `premium-ai-workspace.test.tsx:126`, `assistant-redesign.test.tsx:55,59`). A second, redundant `data-theme="agent-dark"` is stamped on an inner div at `src/components/assistant/conversational-workspace.tsx:4034`.
- **Action :** Repurpose `data-theme` as the real theme switch on `<html>` with values `light|dark` only. Keep the shell's three-value attribute under a different name (e.g. `data-appearance`) or update the four test files that assert `agent-dark`/`assistant-light`; the duplicate at `conversational-workspace.tsx:4034` should be dropped.

### No Tailwind dark variant is configured — dark: utilities silently do nothing

- **Fichier :** `src/app/globals.css:184`
- **Constat :** `grep -rn '@custom-variant|@variant' src/` returns nothing, and `grep -rn 'dark:' --include='*.tsx' src/` returns nothing. Tailwind v4 defaults its `dark:` variant to `prefers-color-scheme`, which would ignore a user's explicit Light/Dark choice.
- **Action :** If any `dark:` utilities will be written, add `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));` to `globals.css`. Preferred alternative: write no `dark:` utilities at all and let the token layer do the work — that is the architecture the CSS modules already follow.


## Workers, crons, outbox, jobs

### ensure_runtime_scan_leases insère ligne par ligne, sans borne, pour tous les candidats éligibles

- **Fichier :** `src/lib/runtime/scanners/runner.ts:102`
- **Constat :** `await input.deps.leases.ensure({ scannerKind, items, policyVersion })` reçoit `items` = **tous** les éligibles (`input.eligible.map(...)`, ligne 97-100), alors que le claim juste après est borné à `batchSize`. Côté SQL, `ensure_runtime_scan_leases` (migration runtime_jobs.sql:199-219) fait `for v_i in 1..v_n loop insert ... on conflict do nothing; end loop;` — une insertion par tour de boucle plpgsql, et les deux tableaux `p_creance_ids` / `p_occurrence_keys` transitent en entier dans le corps de la RPC.
- **Action :** Ne faire l'`ensure` que sur la fenêtre effectivement claimable (trier puis tronquer à `batchSize`), et réécrire la RPC en un seul `insert ... select from unnest(...) on conflict do nothing` au lieu de la boucle.

### Le drain notification_outbound est un no-op permanent appelé à chaque exécution

- **Fichier :** `src/lib/runtime/drains/notification/drain.ts:45`
- **Constat :** `createNotificationOutboxDrainFromEnv()` retourne `createNotificationOutboxDrainStub()` dont le `run()` renvoie `emptyBatchResult('notification_outbound', now)` sans rien faire. Il est pourtant inclus dans `createActiveDrains` (run-drains.ts:59-60, commentaire « appelé pour observabilité ») et déclaré `mvpStatus: 'not_in_mvp'` dans `DRAIN_INVENTORY` (inventory.ts:52-58). Les types `NotificationOutboxRecord` / `NotificationOutboxRepository` (lignes 12-27) sont définis mais implémentés nulle part.
- **Action :** Soit le retirer de `createActiveDrains` (l'inventaire suffit pour la documentation), soit décider de livrer les notifications au MVP et implémenter la file. En l'état il ajoute une entrée vide dans chaque réponse cron et brouille la lecture des métriques.

### Le scanner de paiements automatiques (payments/scanner.ts) n'est jamais appelé — worker mort

- **Fichier :** `src/lib/runtime/payments/scanner.ts:27`
- **Constat :** `enqueueAutomaticPaymentCandidates` n'apparaît hors de son propre fichier que dans le barrel `src/lib/runtime/payments/index.ts:45`. Aucun appelant en production. Le seul producteur réel de `payment_execution_job` est `createPaymentCreateAttemptExecutor` (src/lib/runtime/payments/agent-executor.ts:102 `runtime.enqueue(...)` puis ligne 112 `runtime.drain({jobId: job.id})`), déclenché par l'outil agent `payment.create_attempt` — donc uniquement sur action utilisateur dans la conversation. Le scanner `auto_pay` du cron, lui, écrit un `runtime_job` de kind `autopay_intent` dans une file différente et non consommée.
- **Action :** Décider laquelle des deux voies est la bonne : soit supprimer `payments/scanner.ts`, soit brancher le handler `autopay_intent` du worker runtime_job dessus (`enqueueAutomaticPaymentCandidates`). Ne pas laisser deux files parallèles pour la même intention métier.

### Aucun test sur les orchestrateurs cron ni sur le handler HTTP

- **Fichier :** `src/lib/runtime/cron/run-drains.ts:77`
- **Constat :** Le répertoire `src/lib/runtime/cron/` ne contient que deux fichiers de test : `auth.test.ts` et `candidates-from-env.test.ts`. Il n'existe aucun test pour `runScheduledScanners` (272 lignes, logique d'agrégation de statuts `partial`/`not_configured`/`deadline_reached` en lignes 245-252), `runScheduledDrains` (221 lignes, dont le chemin d'échec ligne 139-166 qui saute les payment jobs) ni `runPaymentJobsDrain`. Aucun test non plus pour `src/app/api/cron/_lib/handler.ts` (mapping ok/status → code HTTP, consommation du body POST, 405 sur PUT/PATCH/DELETE).
- **Action :** Ajouter des tests d'orchestration avec drains et sources injectés : cas deadline atteinte, un drain en erreur, `not_configured`, échec de bootstrap (vérifier que les payment jobs ne sont pas silencieusement sautés), et tests du handler sur les codes HTTP retournés.

### Les échecs d'authentification cron sont journalisés sous l'événement 'scanner_started', y compris pour le job drains

- **Fichier :** `src/app/api/cron/_lib/handler.ts:35`
- **Constat :** `logServerEvent('warn', 'scanner_started', { requestId, job: params.job, authError: auth.error })` — le nom d'événement est `scanner_started` quel que soit `params.job` ('scanners' ou 'drains'), et il est émis alors qu'aucun scanner n'a démarré. Même problème ligne 69 : un échec d'exécution est loggué sous `scanner_completed`. Dans `run-drains.ts:90` la phase de démarrage des drains est loggée sous `outbox_sent` avec `phase:'started'`, ce qui pollue toute métrique construite sur `outbox_sent`.
- **Action :** Introduire des noms d'événements dédiés (`cron_auth_rejected`, `cron_run_failed`, `drain_batch_started`) dans la liste d'événements autorisée de `src/lib/observability/server-logger.ts`, pour que les alertes et compteurs restent lisibles.

### La date métier des scanners est calculée en UTC, ce qui décale les relances manuelles nocturnes

- **Fichier :** `src/lib/runtime/workflow-policy.ts:165`
- **Constat :** `utcCalendarDate(now) { return now.toISOString().slice(0, 10); }` est utilisé comme « aujourd'hui » par prevention/due/silence/auto-pay (`runner.ts:75`, `prevention.ts:12`, etc.) et comparé à `date_echeance` (une date métier française). Le cron planifié à `20 5 * * *` UTC tombe à 06h20/07h20 Paris — même jour civil, sans risque. Mais les routes acceptent aussi un POST de relance manuelle (`scanners/route.ts:34`) : lancé entre minuit et 02h00 heure de Paris en été, le `today` UTC est la veille, et la fenêtre J-5 / l'échéance sont évaluées sur le mauvais jour.
- **Action :** Calculer la date civile en `Europe/Paris` (Intl.DateTimeFormat avec timeZone) plutôt qu'en UTC, ou documenter explicitement que les relances manuelles doivent être déclenchées en journée. Ajouter un test de bord sur une exécution à 23h30 UTC.

### Le corps des requêtes POST cron est lu sans borne de taille

- **Fichier :** `src/app/api/cron/_lib/handler.ts:47`
- **Constat :** `if (params.request.method === 'POST') { try { await params.request.text(); } catch {} }` avec le commentaire « Consume body without trusting it (size-bounded best-effort) » — aucune borne n'est en réalité appliquée. Le contenu est intégralement matérialisé en mémoire. L'exposition reste faible car `assertCronAuthorized` s'exécute avant (ligne 33), donc seul un appelant détenant le `CRON_SECRET` peut l'atteindre.
- **Action :** Ne pas lire le corps du tout (il est ignoré de toute façon) ou le lire via un reader borné à quelques kilo-octets, pour que le commentaire corresponde au code.


---

# Dépend d’un secret ou d’un compte externe


## AI runtime, LLM providers and agent tools

### The live provider path has never been exercised against a real API key

- **Fichier :** `src/lib/llm/providers/openai-compatible.ts:78`
- **Constat :** `.env.example:35-36` ships `SIDIAN_LLM_PROVIDER_ENABLED=false` / `SIDIAN_LLM_TRANSPORT_MODE=disabled` with `SIDIAN_LLM_API_KEY=` empty. `src/lib/llm/runtime.test.ts:60` uses the literal `SIDIAN_LLM_API_KEY: "sk-test-key"` with an injected `fetchImpl`, so `fetch(\`${config.baseUrl}/chat/completions\`, {headers:{Authorization: \`Bearer ${config.apiKey}\`}})` has never hit a real endpoint. Untested-against-reality assumptions in this file: `choices[0].message.content` must be a non-empty string or `LLM_OUTPUT_INVALID` is thrown (line 116-120) — a legitimate `finish_reason: "length"` truncation to empty content, or a refusal, would surface as an output-invalid error; and `response_format: {type:"json_object"}` (line 74-76) is only supported by a subset of OpenAI-compatible gateways.
- **Action :** Provision a real `SIDIAN_LLM_API_KEY`, set `SIDIAN_LLM_PROVIDER_ENABLED=true` / `SIDIAN_LLM_TRANSPORT_MODE=live` in staging, and run one end-to-end `protection.draft.converse` turn asserting `extraction_source === "llm"` and `fallback_used === false`. Verify empty-content, 429 and 401 handling against the live endpoint before launch.


## Authentication and onboarding

### Aucun SMTP de production configuré — les emails de confirmation et de réinitialisation ne partiront pas

- **Fichier :** `supabase/config.toml:242-250`
- **Constat :** Le bloc `# [auth.email.smtp]` est entièrement commenté (`# enabled = true`, `# host = "smtp.sendgrid.net"`, `# pass = "env(SENDGRID_API_KEY)"`). Or `enable_confirmations = true` (ligne 232) et tout le parcours en dépend : `signUpAction` redirige vers `/inscription/verifier-email` (`src/app/actions/auth.ts:113`), `signInAction` déconnecte et renvoie vers cette même page si `!data.user.email_confirmed_at` (lignes 144-147), et `forgotPasswordAction` appelle `supabase.auth.resetPasswordForEmail` (ligne 180). Aucune de ces deux fonctions ne passe par le provider applicatif `SIDIAN_EMAIL_*` de `.env.example` — Supabase Auth envoie avec sa propre configuration SMTP.
- **Action :** Configurer un SMTP de production dans le projet Supabase (dashboard > Authentication > Emails > SMTP Settings, ou décommenter `[auth.email.smtp]` avec `pass = "env(SIDIAN_EMAIL_API_KEY)"` puis `supabase config push`). Personnaliser aussi les templates de confirmation et de recovery en français. Sans cela, aucun compte ne peut être activé en production.

### site_url et additional_redirect_urls Supabase ne contiennent que localhost — et aucune entrée ne correspond à l'URL réellement construite par le code

- **Fichier :** `supabase/config.toml:160-169`
- **Constat :** `site_url = "http://localhost:3000"` et `additional_redirect_urls` liste uniquement `http://localhost:3000/auth/callback`, `http://localhost:3000/reinitialiser-mot-de-passe`, et leurs équivalents `127.0.0.1`. Aucun domaine de production. De plus le code ne produit jamais l'URL nue `/reinitialiser-mot-de-passe` : `forgotPasswordAction` (`src/app/actions/auth.ts:181`) appelle `buildAuthCallbackUrl("/reinitialiser-mot-de-passe")` qui retourne `${APP_URL}/auth/callback?next=%2Freinitialiser-mot-de-passe` (`src/lib/auth/urls.ts:7-15`). Les deux entrées `/reinitialiser-mot-de-passe` de l'allowlist sont donc mortes, et aucune entrée ne couvre la variante avec query `?next=`.
- **Action :** Ajouter le domaine de production (et le motif de preview Vercel) à `site_url` / `additional_redirect_urls` — par ex. `https://<domaine>/auth/callback` et `https://<domaine>/auth/callback?next=*` — puis retirer les deux entrées `/reinitialiser-mot-de-passe` inutilisées. Vérifier en environnement de staging qu'un lien de recovery avec query string est bien accepté par l'allowlist avant lancement.


## Communication channels — Email

### Compte Resend, clé API et domaine d'envoi vérifié (SPF/DKIM/DMARC) absents

- **Fichier :** `.env.example:55`
- **Constat :** .env.example:55-61 déclare `SIDIAN_EMAIL_PROVIDER_ENABLED=false`, `SIDIAN_EMAIL_TRANSPORT_MODE=disabled` et des valeurs vides pour `SIDIAN_EMAIL_API_KEY` / `FROM_ADDRESS` / `FROM_NAME` / `REPLY_TO`. `.env.local` ne contient aucune clé `SIDIAN_EMAIL_*` (seulement NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED, NEXT_PUBLIC_SUPABASE_*, SIDIAN_PAYMENT_AUTHORIZATION_TOKEN_SECRET, SUPABASE_SERVICE_ROLE_KEY). Le code live est complet : `loadEmailEnv` exige API_KEY + FROM_ADDRESS (env.ts:91-100) et `createResendEmailProvider` est prêt (provider/resend.ts:47).
- **Action :** Créer le compte Resend, vérifier le domaine d'envoi (SPF, DKIM, DMARC), générer une clé restreinte en écriture d'emails, puis positionner sur Vercel : SIDIAN_EMAIL_PROVIDER_ENABLED=true, SIDIAN_EMAIL_TRANSPORT_MODE=live, SIDIAN_EMAIL_API_KEY, SIDIAN_EMAIL_FROM_ADDRESS, SIDIAN_EMAIL_FROM_NAME, SIDIAN_EMAIL_REPLY_TO.

### Compte Meta WhatsApp Business (WABA), token, app secret et identifiants absents

- **Fichier :** `.env.example:71`
- **Constat :** .env.example:71-83 déclare `SIDIAN_WHATSAPP_PROVIDER_ENABLED=false` et laisse vides ACCESS_TOKEN, PHONE_NUMBER_ID, BUSINESS_ACCOUNT_ID, WEBHOOK_VERIFY_TOKEN, APP_SECRET, SIDIAN_SENDER_E164, GUIDE_RECIPIENT_TECHNICAL_ID. `.env.local` n'en contient aucune. Le code live est complet et fail-closed : `loadWhatsAppEnv` (env.ts:103-121) exige 5 champs, `createGraphWhatsAppTransport` (transport/graph-client.ts:39) cible `graph.facebook.com/{version}/{phone_number_id}/messages`, et `verifyWhatsAppSignature` (webhook/verify.ts:24) attend l'app secret.
- **Action :** Créer l'app Meta + WABA, obtenir un System User token permanent, le phone_number_id, l'app secret, définir un verify token ≥ 8 caractères, enregistrer l'URL webhook `/api/whatsapp/webhook` (champs `messages`), et renseigner les 7 variables. Prévoir la rotation du token (les tokens temporaires expirent en 24 h).


## Configuration, environment variables, validation, scripts, observability

### Live provider secrets are absent from every environment — email, WhatsApp and LLM are all disabled by default

- **Fichier :** `.env.example:36`
- **Constat :** SIDIAN_LLM_PROVIDER_ENABLED=false / SIDIAN_LLM_TRANSPORT_MODE=disabled (.env.example:36-38), SIDIAN_EMAIL_PROVIDER_ENABLED=false / SIDIAN_EMAIL_TRANSPORT_MODE=disabled (l.55-58), SIDIAN_WHATSAPP_PROVIDER_ENABLED=false / SIDIAN_WHATSAPP_TRANSPORT_MODE=disabled (l.71-77), with every API key line empty. .env.local contains only NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED and SIDIAN_PAYMENT_AUTHORIZATION_TOKEN_SECRET — no CRON_SECRET, no SIDIAN_ENVIRONMENT, no provider vars. The loaders are correct and fail-closed (loadEmailEnv throws when mode=live lacks API_KEY or FROM_ADDRESS, email/env.ts:91-100; loadWhatsAppEnv lists 5 required fields, whatsapp/env.ts:103-121; loadLlmEnv requires API_KEY, llm/env.ts:96-100), so this is purely a provisioning gap, not a code gap.
- **Action :** Provision for production: SIDIAN_EMAIL_API_KEY + SIDIAN_EMAIL_FROM_ADDRESS (+ optional FROM_NAME/REPLY_TO), the five required SIDIAN_WHATSAPP_* fields (ACCESS_TOKEN, PHONE_NUMBER_ID, WEBHOOK_VERIFY_TOKEN, APP_SECRET, SIDIAN_SENDER_E164), SIDIAN_LLM_API_KEY, CRON_SECRET (>= 32 chars), SUPABASE_ENVIRONMENT_ATTESTATION_JWT, SUPABASE_STRIPE_BINDING_WRITER_JWT, SIDIAN_SUPABASE_PROJECT_REF, and set each *_TRANSPORT_MODE to live. Note that mode must be exactly 'live' in production: loadEmailEnv throws otherwise (email/env.ts:85-89).


## Stripe integration and Sidian subscription plans

### Compte Stripe de production, endpoint webhook et secrets Connect encore à créer

- **Fichier :** `docs/operations/PRE_DEPLOYMENT_CHECKLIST.md:71`
- **Constat :** Le tableau §3 Stripe Connect liste « Compte plateforme Stripe (test) [ ] À faire », « Compte Connect test créé + controller props [ ] À faire », « Compte Connect charges_enabled=true [ ] À faire », et §4 Webhooks liste « Connect webhook POST /api/stripe/webhook | STRIPE_CONNECT_WEBHOOK_SECRET | [ ] À faire », « Déduplication event.id [ ] À faire », « Replay idempotent [ ] À faire ». Le code correspondant est complet et testé (32 fichiers / 266 tests verts sur src/lib/stripe, src/lib/runtime/payments, src/app/api/stripe, src/app/p, src/config).
- **Action :** Créer le compte plateforme, abonner l'endpoint aux 11 événements exacts de src/lib/stripe/webhooks/event-types.ts, renseigner STRIPE_SECRET_KEY / STRIPE_CONNECT_WEBHOOK_SECRET / NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY / STRIPE_MODE / NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED, générer SUPABASE_STRIPE_BINDING_WRITER_JWT (role=stripe_customer_binding_writer, sidian_environment correspondant, exp surveillé) et SIDIAN_PAYMENT_AUTHORIZATION_TOKEN_SECRET (≥ 32 c.), puis dérouler docs/operations/STRIPE_TEST_MODE_VALIDATION.md.

### `losses_collector` / `fees_collector` par compte connecté non vérifiés

- **Fichier :** `docs/operations/PRE_DEPLOYMENT_CHECKLIST.md:79`
- **Constat :** Ligne « losses_collector / fees_collector par compte connecté | Dashboard Stripe (par compte) | [ ] À vérifier | Ne jamais supposer, vérifier explicitement pour carte et SEPA séparément ». Le code ne définit aucune `controller.losses` / `controller.fees` à la création : src/lib/stripe/connect/ensure-connected-account.ts:225-245 ne passe que `type: "express"`, `country`, `email`, `capabilities`, `business_profile`, `metadata`, et la validation ligne 45-54 ne contrôle que `controller.type === "application"`, `requirement_collection === "stripe"` et `stripe_dashboard.type === "express"`.
- **Action :** Vérifier dans le Dashboard, pour un compte Express de test, qui supporte les pertes et les frais sur carte ET sur SEPA. Si le défaut ne convient pas au modèle Sidian (0 % de commission, prestataire merchant of record), fixer explicitement `controller.losses.payments` et `controller.fees.payer` à la création et étendre `validateProvisionedAccount` en conséquence.


## Workers, crons, outbox, jobs

### CRON_SECRET vide : sans valeur en production, les deux crons renvoient 503 en silence

- **Fichier :** `.env.example:66`
- **Constat :** `CRON_SECRET=` (vide). `getCronSecret` (src/lib/runtime/cron/auth.ts:36-44) retourne `null` si la valeur fait moins de 16 caractères, et `assertCronAuthorized` renvoie alors `{ok:false, status:503, error:'cron_not_configured'}` (ligne 59-61) — comportement fail-closed correct et testé (auth.test.ts:58-69). Mais côté exploitation, `handler.ts:35-43` se contente d'un `logServerEvent('warn', ...)` : rien n'alerte si le secret n'est jamais posé sur Vercel.
- **Action :** Générer un secret ≥ 32 caractères et le poser dans les variables d'environnement Vercel (Production + Preview). Vercel envoie automatiquement `Authorization: Bearer $CRON_SECRET` sur ses crons. Ajouter un contrôle de démarrage/health qui signale un `CRON_SECRET` absent.


---

# Dépend d’une décision produit humaine


## AI runtime, LLM providers and agent tools

### Choose whether disabled/degraded LLM mode may silently serve deterministic extraction in production

- **Fichier :** `src/lib/llm/resolve-conversational-provider.ts:36`
- **Constat :** `preferDeterministicStub: !env.enabled || env.mode === "disabled" || env.mode === "stub"` routes every assistant turn to `createStubLlmProvider({mode:"deterministic"})` (adapters/conversational-extract.ts:73) whenever no provider is configured. The `disabled` runtime is genuinely fail-closed for direct calls (`runtime.ts:111-115` returns `LLM_DISABLED` with zero network) — but the conversational path never reaches it, because the adapter short-circuits first. There is no product-level statement in docs/SIDIAN_02_PRD_V2.md defining whether the assistant should degrade silently, degrade with a notice, or refuse the turn. `fallback_used` is also true whenever a **live** provider times out or returns off-schema output (parse.ts:124-127), so the same question governs runtime incidents, not just missing config.
- **Action :** Decide (product + legal, given the French-language customer-facing copy) the required behaviour for each of: LLM disabled by config, LLM provider outage, LLM output off-schema. Then encode it — refuse with a French error, or degrade with an explicit notice — and make the UI honour `fallback_used` accordingly.


## Authenticated application pages

### Deux entrées de navigation (« Dossiers » et « Paiements ») affichent exactement la même requête avec trois vocabulaires différents

- **Fichier :** `src/components/app/app-nav-config.ts:24`
- **Constat :** APP_NAV id "protections" → label « Dossiers » → /app/paiements-a-recevoir, dont le H1 est title="Protections" (paiements-a-recevoir/page.tsx:73). APP_NAV id "paiements" → /app/paiements, H1 « Paiements ». Les deux pages appellent listActiveCreances(supabase) sur la même table creance (paiements/page.tsx:72-79 et paiements-a-recevoir/page.tsx:52-59). La sidebar ajoute un quatrième terme : « Créer un premier dossier » → /app/paiements-a-recevoir (app-sidebar.tsx:210-213). docs/design/SIDIAN_DESIGN_LOCK.md ligne 97-99 liste « Protections, Paiements, Clients, Activité ».
- **Action :** Décision produit requise : choisir un mot unique (Protections OU Dossiers) et fusionner ou différencier réellement les deux écrans (par ex. Dossiers = cycle de suivi, Paiements = encaissements réellement reçus). En l'état l'utilisateur voit deux fois la même liste sous deux noms.

### Le bandeau « plafond de prélèvement auto » est bloqué en dur et sans issue pour l'utilisateur

- **Fichier :** `src/lib/runtime/payments/constants.ts:22`
- **Constat :** `export const AUTO_DEBIT_REGLE_CEILING_PRODUCT_READY = false;`. probeAutoDebitCeiling (src/lib/ux/config-status.ts:176-195) renvoie donc toujours state:"blocked" avec le titre « Le plafond de prélèvement auto n'est pas encore validé » et — point clé — sans href ni actionLabel. Ce canal est rendu en permanence sur /app/parametres via ConfigStatusList (parametres/page.tsx:46) et sur /app/demarrage via MissingConfigBanner (demarrage/page.tsx:108-110), sans aucun bouton, donc irrésolvable.
- **Action :** Décision produit : définir la politique de plafond (valeur, saisie par le prestataire ou constante) puis soit livrer l'écran de configuration et pointer le href dessus, soit masquer ce canal tant que la fonctionnalité n'est pas au périmètre MVP.


## Communication channels — Email

### Le template Meta `guide_payment_confirmation` doit être soumis et approuvé — et le choix boutons/liste tranché (Meta plafonne à 3 quick-reply)

- **Fichier :** `src/lib/communication-channels/whatsapp/templates/registry.ts:63`
- **Constat :** registry.ts:63 : `buttonTitles: ['Oui','Non','Paiement partiel','Je vérifie']` — 4 choix, avec le commentaire explicite ligne 106 « Liste interactive (4 choix) — les boutons Meta sont limités à 3 ». Le mapping inverse `META_LIST_ROW_TO_ACTION` (inbound/actions.ts:23-30) code en dur `gpc_0..gpc_3`. Le texte du corps est également figé côté code : `As-tu reçu le règlement de ${amountLabel} de ${clientName} ?` (registry.ts:121). Aucun de ces éléments n'est un modèle enregistré chez Meta.
- **Action :** Trancher : soit 3 quick-reply (Oui / Non / Je vérifie) avec « Paiement partiel » traité en texte libre, soit un template + message de suivi liste dans la fenêtre 24 h. Puis soumettre le modèle FR à l'approbation Meta avec `{{1}}`=montant et `{{2}}`=client, et aligner `externalName`, `bodyParameters` et les payloads `gpc_*`.

### Cadence et copie des relances email non arrêtées : 8 templates existent, aucun rattachement aux scanners

- **Fichier :** `src/lib/email/types.ts:5`
- **Constat :** `EMAIL_TEMPLATE_KEYS` déclare 8 templates (types.ts:5-14) rendus en FR (templates/registry.ts:477-486). En face, `docs/SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md:582-587` décrit six scanners (prévention J-5, échéance, paiements auto, silence prolongé, clôture) et docs/SIDIAN_02_PRD_V2.md §8 exige des « relances graduées » — mais aucune table de correspondance scanner→template→cadence n'existe dans `src/lib/runtime/workflow-policy.ts` ni ailleurs, et les libellés (« Aucune action n'est demandée si tout est en ordre », templates/registry.ts:177) n'ont pas de validation produit tracée.
- **Action :** Arrêter la matrice scanner × template × délai × condition de non-répétition (et la formulation FR définitive, cohérente avec docs/design/PRODUCT_PRINCIPLES.md), l'encoder dans `workflow-policy.ts` avec une version, puis la câbler dans le consommateur `runtime_job` manquant.


## Configuration, environment variables, validation, scripts, observability

### The LLM budget ceilings shipped as defaults are placeholders with no stated cost basis

- **Fichier :** `.env.example:44`
- **Constat :** .env.example:44-46 sets SIDIAN_LLM_BUDGET_MAX_REQUESTS_PER_MINUTE=30, SIDIAN_LLM_BUDGET_MAX_TOKENS_PER_MINUTE=50000, SIDIAN_LLM_BUDGET_MAX_REQUESTS_PER_SCOPE_PER_HOUR=200, matching the zod defaults in src/lib/llm/env.ts:34-51. With SIDIAN_LLM_MODEL defaulting to gpt-4o-mini (env.ts:20) and SIDIAN_LLM_MAX_OUTPUT_TOKENS to 1024 (env.ts:28-33). 50000 tokens/minute sustained is roughly 72M tokens/day for a single process; combined with the process-local tracker (budget.ts:41) and the unused per-scope key, there is no derived monthly spend ceiling anywhere in the repo or in docs/.
- **Action :** A human must set the target monthly AI spend and the per-prestataire fair-use limit, then derive these three numbers from it and record the derivation in docs/operations/. Until that decision is made, the caps should be treated as arbitrary and the code-side fixes (per-tenant scope key, persistent counters, cost telemetry) are prerequisites for enforcing whatever number is chosen.


## Conversation / Assistant page — non-regression baseline

### The empty-state pill promises 'Analyser un document' while the assistant states document reading is unavailable

- **Fichier :** `src/components/assistant/conversational-workspace.tsx:173`
- **Constat :** WELCOME_SUGGESTIONS declares `label: "Analyser un document", action: "add_invoice"` (:172-177). Clicking it answers 'Importe ta facture avec le sélecteur de fichiers…' (:3380-3381), and once a file is attached the reply is 'La lecture automatique des documents sera bientôt disponible.' (src/components/assistant/document-attachments.ts:288 and :298). No OCR/extraction path exists — the attachment never leaves the browser.
- **Action :** Product call: either relabel the pill to match the capability (e.g. 'Joindre un document') until extraction ships, or keep the label and accept the expectation gap. Design lock forbids changing composition, not a label.

### The design lock still describes a KPI block that the implementation deliberately removed

- **Fichier :** `docs/design/SIDIAN_DESIGN_LOCK.md:21`
- **Constat :** The lock states the reading order '1. Bonjour 2. Copy 3. KPI 4. Composer 5. Actions rapides'. `WelcomeState` renders only eyebrow / greeting / situation headline + detail (welcome-state.tsx:61-97); `welcomeBriefCards` is consumed by `buildWelcomeSituationCopy` to compose a sentence, never as cards. The change is locked by assistant-redesign.test.tsx:153 ('premier usage : phrase contextuelle sans cartes KPI'). Document and code contradict each other, which makes the non-regression baseline ambiguous.
- **Action :** Product design updates SIDIAN_DESIGN_LOCK.md §Composition to the shipped composition (Bonjour → copie situationnelle → composer → intentions), or the KPI block is restored. Until then the test file is the authoritative baseline.


## Documents, attachments and file storage

### No retention policy, no orphan cleanup, no deletion-on-account-delete for documents

- **Fichier :** `docs/SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md:547`
- **Constat :** §6.5 'Rétention et RGPD' is marked '**`[VALIDATION RESTANTE]`** Durées par catégorie (preuves financières, autorisations, audit, conversations, comptes). … Suppression/export de compte : format, délai, isolement des preuves encore requises.' No duration is decided for documents. Correspondingly nothing exists in code: the runtime job catalogue (supabase/migrations/20260726220000_runtime_jobs.sql, 20260726200000_runtime_outbox_leases.sql) contains no document/storage job, and `deleteAssistantConversation` (src/components/assistant/conversation-client.ts:82-96) deletes the conversation row with no companion storage cleanup — `public.message` cascades on conversation delete (core_tables.sql:150) but no storage object would.
- **Action :** A human must decide the retention duration for uploaded documents (distinct from the commercial prescription period that applies to financial evidence). Then implement: soft-delete on `document.deleted_at`, a scheduled job that hard-deletes storage objects past retention, cascade of document deletion when a conversation or créance is deleted, and an orphan sweeper for storage objects with no matching `document` row (uploads whose signed URL was used but whose row was rolled back).


## Stripe integration and Sidian subscription plans

### La checklist de prélèvement refuse systématiquement : plafond auto-débit codé en dur à `null`

- **Fichier :** `src/lib/runtime/payments/constants.ts:22`
- **Constat :** `AUTO_DEBIT_REGLE_CEILING_PRODUCT_READY = false` et src/lib/runtime/payments/supabase-repository.ts:399 fournit `autoDebitCeilingCents: null`. La porte `regle_ceiling` (src/lib/runtime/payments/checklist.ts:191-205) échoue alors toujours avec `REGLE_AUTO_DEBIT_CEILING_UNDEFINED` — « auto-debit ceiling rule product incomplete — refusing money movement ». Aucun `regle_parametre` de plafond n'existe en base.
- **Action :** Décision produit requise : définir le paramètre `regle` de plafond auto-débit (montant max par prélèvement et/ou par période), le persister dans `regle`, puis brancher `loadChecklistSnapshot` dessus et passer le flag à true. Tant que la décision n'est pas prise, le comportement fail-closed actuel est correct — mais l'automatisation promise en 03 §7 est inopérante.

### Contradiction documentaire sur le verrouillage tarifaire Early Access

- **Fichier :** `docs/SIDIAN_02_PRD_V2.md:194`
- **Constat :** 02 §6 : « limité aux 20 premiers comptes ; prix maintenu 12 mois pour ces premiers utilisateurs ». 03 §1 (`prestataire`) : « early_access_price_locked_until (nullable — s'applique désormais à un verrouillage à vie pour les 30 premiers comptes, pas à une fenêtre de 12 mois) ». La colonne `early_access_price_locked_until` existe (supabase/migrations/20260715120100_core_tables.sql:12) mais n'est écrite par aucune migration ni aucun code (grep = 0 hors database.generated).
- **Action :** Trancher (nombre de comptes, durée du verrouillage), aligner 02 et 03, puis définir la règle de remplissage de `early_access_price_locked_until` au moment de la souscription — sans quoi la promesse commerciale n'a aucun support technique.


## Theming

### Public payment and auth routes render outside AppShell and would stay light

- **Fichier :** `src/app/p/public-payment-shell.tsx:14`
- **Constat :** `grep -rn AppShell src/app --include='*.tsx'` lists only `/app/*` routes (clients, activite, demarrage, connexion-stripe, paiements-a-recevoir, paiements, approbations, parametres, dev/workspace). `src/app/p/**` and `src/app/connexion|inscription|**` never mount it, and hardcode `bg-white`: `public-payment-shell.tsx:14`, `p/autorisation/annulation/page.tsx:7`, `p/autorisation/retour/page.tsx:15`, `p/retour/authorization-proposal.tsx:112`, `p/retour/recheck-button.tsx:26`, `auth-shell.tsx:25`, `src/app/page.tsx:10`.
- **Action :** Decide whether the debtor-facing `/p/*` payment pages follow the *prestataire's* theme (they should not — the debtor is a different person), the *debtor's* OS setting, or stay permanently light for brand/trust consistency. Same question for the pre-auth `/connexion` and `/inscription` screens, where no preference exists yet. Recommendation: pin `/p/*` to light and let auth screens follow `prefers-color-scheme`.

### Conflict between 'Dark mode par défaut' for the Agent IA and a per-account default of 'light'

- **Fichier :** `docs/design/SIDIAN_DESIGN_LOCK.md:40`
- **Constat :** `docs/design/SIDIAN_DESIGN_LOCK.md` (status LOCKED) lists under « Couleurs »: « Dark mode par défaut. » and forbids « changer la palette » without validation. The migration comment at `supabase/migrations/20260803120000_theme_preference.sql:3-5` states the opposite for the account default: « Le thème par défaut d'un nouveau compte est 'light' : c'est le thème de référence du produit. » Today `conversational-workspace.tsx:3994` forces `appearance="agent-dark"` unconditionally, so the assistant is dark even though every other `/app/*` page is light.
- **Action :** A human must choose: (a) the Agent IA workspace stays force-dark regardless of the user's preference (design lock wins, preference applies only to the business pages), or (b) the preference governs the whole app and the assistant gains a light variant — which requires the veil-token refactor of the 16 assistant CSS modules. Option (a) is far cheaper and matches the current LOCKED doc; get it written into the design lock either way.

### Persistence medium for the 'system' setting is unspecified — cookie vs localStorage changes SSR correctness

- **Fichier :** `supabase/migrations/20260803120000_theme_preference.sql:13`
- **Constat :** The enum includes `'system'`, and the migration comment (line 5) says « 'system' suit prefers-color-scheme côté client ». The DB stores the *intent*, not the resolved theme. The repo currently uses `localStorage` only at `src/components/app/app-sidebar.tsx:187,396` (onboarding flag) and `sessionStorage` in `src/app/p/[token]/pay-button.tsx:70`; no cookie is written by app code (`src/lib/supabase/server.ts:14` only reads Supabase session cookies).
- **Action :** Decide the client mirror. A cookie is required if you want the *resolved* theme available during SSR (avoids any flash for the 'system' case); localStorage alone forces a client-side resolution and therefore an inline no-flash script plus `suppressHydrationWarning`. Recommend a non-httpOnly `sidian-theme` cookie holding the resolved value, written alongside the RPC call, with the DB row as the cross-device source of truth.


## Workers, crons, outbox, jobs

### Le plafond auto-débit est câblé sur false : tout job de prélèvement automatique échoue terminal

- **Fichier :** `src/lib/runtime/payments/constants.ts:22`
- **Constat :** `export const AUTO_DEBIT_REGLE_CEILING_PRODUCT_READY = false;`. Ce flag est injecté tel quel dans le snapshot checklist (`src/lib/runtime/payments/supabase-repository.ts:400` — `productAutoDebitRulesReady: AUTO_DEBIT_REGLE_CEILING_PRODUCT_READY`) et `src/lib/runtime/payments/checklist.ts:191-205` fait `if (!input.productAutoDebitRulesReady || ...) return fail(..., code: 'REGLE_AUTO_DEBIT_CEILING_UNDEFINED')`. `service.ts:189-204` transforme cet échec en `complete({outcome: {kind:'failed_terminal'}})`. Aucun prélèvement automatique ne peut donc aboutir, quelle que soit la config Stripe.
- **Action :** Décision produit requise : définir le paramètre `regle` de plafond auto-débit (nom du paramètre dans l'enum `regle_parametre`, unité en centimes, portée prestataire et/ou client, valeur par défaut, qui le fixe et à quel moment du parcours). Puis ajouter la valeur dans `load_automatic_payment_checklist`, basculer le flag à true et couvrir par un test de bout en bout enqueue→drain→PI.

### La cadence */5 des drains impose un plan Vercel Pro ou supérieur

- **Fichier :** `vercel.json:9`
- **Constat :** `{"path": "/api/cron/drains", "schedule": "*/5 * * * *"}`. Le plan Hobby de Vercel limite les crons à un déclenchement quotidien et à 2 jobs. Le point est reconnu dans `docs/implementation/SID_GATE_P0_RUNTIME_AUTOMATION.md:101` (« Hobby Vercel : `*/5` drains incompatible → passer en quotidien ou monter Pro ») et listé comme gap résiduel n°2 (ligne 214). De plus `maxDuration = 60` déclaré dans les deux routes (`scanners/route.ts:19`, `drains/route.ts:20`) dépasse le plafond Hobby.
- **Action :** Confirmer le passage au plan Pro (nécessaire aussi pour maxDuration 60s). Si le plan reste Hobby, la livraison outbox tombe à une fois par jour : il faut alors décider si un délai de 24 h sur l'envoi d'un lien de paiement est acceptable produit, ou externaliser l'ordonnancement (pg_cron Supabase, QStash) — mais le doc interdit explicitement un second ordonnanceur (ligne 239).

