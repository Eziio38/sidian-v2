# Audit sécurité & fondations — 5 août 2026

> **Statut :** carte de référence active. Remplace `FINAL_TECHNICAL_AUDIT.md` (3 août)
> comme source de vérité sur l'état sécurité/fondations.
>
> **Méthode :** six dimensions auditées en parallèle, **chaque constat repassé par un
> vérificateur adverse** qui rouvre les fichiers pour confirmer, dégrader ou réfuter.
> 34 constats retenus : 12 confirmés, 20 dégradés, 2 réfutés. 26 angles morts
> supplémentaires signalés par les vérificateurs eux-mêmes.
>
> **Périmètre :** lecture de code, migrations, docs et avis publics uniquement.
> Aucun appel réseau vers Supabase, Vercel, Stripe ou Brevo. Aucun secret manipulé.

---

## 0. Avertissement sur la documentation existante

`docs/FINAL_TECHNICAL_AUDIT.md` est un travail sérieux — 270 constats, presque tous
sourcés — mais **il a été livré dans le commit `71ab3f2`, celui-là même qui invalide
une partie de ses conclusions.** Il déclare absents la facturation, l'adaptateur
Anthropic et le streaming : les trois existent.

Plus grave : **neuf migrations postérieures ne sont couvertes par aucun document** —
`billing`, `account_lifecycle`, `notification_preferences`, `llm_budget_counters`.

Les trois fichiers de `docs/operations/` datent du 14 juillet et décrivent un schéma
à 17 tables / 11 migrations. Le dépôt en compte **61**. `PAYMENTS_RUNBOOK.md:202`
admet lui-même que ses commandes sont héritées du projet abandonné et non vérifiées.

**À faire :** marquer `FINAL_TECHNICAL_AUDIT.md` et `docs/operations/*` comme
historiques, ou les reprendre. Ne pas piloter dessus en l'état.

---

## P0 — Bloquants avant toute ouverture au public

### P0-1 · Aucune sauvegarde, aucune restauration, aucun rollback
`CRITIQUE` · confirmé · heures

61 migrations, **pas de répertoire `down/`**. Quatre occurrences seulement de
« backup / restore / PITR / pg_dump » dans toute la documentation, aucune
opérationnelle. `docs/operations/PRE_DEPLOYMENT_CHECKLIST.md:264-273` réduit le
rollback base à « stratégie à définir ».

Le plan Supabase est en **Free** : pas de PITR. Une migration ratée ou une corruption
n'a aujourd'hui **aucun chemin de retour**.

**Correctif :** confirmer le plan Supabase ; passer en Pro avant la première mise en
production réelle, ou s'engager sur un `supabase db dump` planifié et réellement
exécuté. Prendre un dump manuel avant chaque `db push`. **Répéter une restauration
au moins une fois** sur un projet jetable — une sauvegarde jamais restaurée n'est pas
une sauvegarde.

### P0-2 · Next.js 16.2.10 — 9 avis de sécurité non corrigés
`HAUTE` · confirmé · minutes

`package.json:89` épingle `16.2.10`, et c'est bien la version installée. `pnpm audit`
remonte 9 avis, dont un **déni de service non authentifié sur les Server Actions**.

**Correctif :** passer `next` et `eslint-config-next` en `16.2.11`, `pnpm install`,
`pnpm build`, suite de tests. Bump de patch, même mineure.

### P0-3 · L'outbox email perd définitivement des messages
`HAUTE` · confirmé · heures

`src/lib/email/outbox/supabase-repository.ts:213-236` — `claimForProcessing` passe la
ligne en `processing` **sans poser de lease**, alors que la migration
`20260726200000_runtime_outbox_leases.sql:319-322` a créé `lease_token` et
`lease_expires_at` exprès. Un crash entre la réclamation et l'envoi laisse le message
bloqué pour toujours. Le runbook prescrit une reprise que le code n'implémente pas.

Le drain WhatsApp fait ça correctement (`alreadyClaimed`) : **le modèle est déjà dans
le dépôt.**

**Correctif :** basculer `createEmailOutboxDrain` sur `claimEmailOutboxBatchSql`.
Au passage, sortir `markSent` du `try/catch` du provider.

### P0-4 · Un email confirmé suffit pour ouvrir un Stripe Connect et émettre des liens de paiement
`HAUTE` · dégradé mais bloquant · heures

Inscription libre (`supabase/config.toml:182`, captcha commenté à `:219-223`), aucune
allowlist dans `src/`, et **aucune vérification d'abonnement sur le chemin produit**.
`beginStripeConnectAction` ne demande qu'un email confirmé.

N'importe qui peut créer un compte et émettre des demandes de paiement sous ta marque.

⚠️ **Piège signalé par le vérificateur :** `requireSubscriptionCapability`
(`src/lib/subscription/server.ts:110+`) n'est importé que par
`src/app/actions/billing.ts` — il garde la *souscription*, pas le produit. Ne pas
compter dessus comme correctif.

**Correctif :** un helper `requireEarlyAccess()` piloté par une variable
d'environnement, appelé depuis `beginStripeConnectAction`,
`openPaymentReceivableAction` et `POST /api/agent/tools`.

### P0-5 · Le changement de mot de passe n'exige aucune réauthentification
`HAUTE` · angle mort · heures

`src/app/reinitialiser-mot-de-passe/page.tsx:8-12` admet **n'importe quelle session**,
pas seulement une session de récupération. Une session volée devient une prise de
contrôle définitive du compte.

**Correctif :** exiger soit une session de récupération, soit le mot de passe actuel.
Noter que `config.toml` porte `secure_password_change = false` et
`minimum_password_length = 6`, tous deux signalés comme régressions par l'audit du
3 août.

---

## P1 — À traiter avant de mettre du volume dessus

### P1-1 · Rien ne peut te dire que l'automatisation s'est arrêtée
`HAUTE` · confirmé · heures

`/api/health` calcule son statut **uniquement** depuis la connectivité base
(`route.ts:64-67`). Le corps authentifié ne porte aucune profondeur de file, aucun
horodatage de dernier passage. Les files peuvent être gelées, l'endpoint répond `ok`.

**Correctif :** ajouter au corps authentifié le nombre de `runtime_job` en attente,
`email_outbox` en `queued`+`processing`, les dead letters, les
`payment_execution_job` non terminaux, et le `completed_at` le plus récent.

### P1-2 · Aucun rate limiting sur les routes API, sauf le webhook Stripe
`HAUTE` · angle mort · heures

`consumePublicRateLimit` n'apparaît que dans `src/app/api/stripe/webhook/route.ts:81`.
`POST /api/agent/tools` — le point d'entrée du LLM, donc du coût — n'a **aucun quota**.
`src/lib/agent/server/limits.ts` ne borne que la taille du corps et les délais.

### P1-3 · Une seule variable d'environnement mal réglée fait tomber tout le cron de drains, paiements compris
`HAUTE` · angle mort · heures

`src/lib/runtime/cron/run-drains.ts:55-63` construit les drains dans un
`Promise.all`. Un `createEmailOutboxDrainFromEnv()` qui jette emporte le drain
WhatsApp **et** les paiements avec lui.

### P1-4 · `payment_execution_job` : pas de plafond de tentatives, pas de backoff, blocage de tête de file
`HAUTE` · angle mort · heures

`20260726210000_sid_p0_payment_execution_jobs.sql:32-49` déclare `attempt_count` mais
aucun `available_at`. Un job empoisonné bloque indéfiniment ceux qui le suivent.
C'est la file **des paiements**.

### P1-5 · L'assertion « RLS partout » de la CI a 17 tables de retard
`HAUTE` · angle mort · minutes

`scripts/test-schema-rls.mjs:121-134` vérifie une **liste en dur**. Le schéma a
doublé depuis. Une nouvelle table sans RLS passe la CI sans un bruit — en
contradiction directe avec la règle non négociable d'`AGENTS.md`.

### P1-6 · `ensure_prestataire_for_current_user` peut annuler une anonymisation RGPD
`HAUTE` · angle mort · heures

`20260717220000_sid_sec_001_prestataire_update_hardening.sql:96-104` réécrit
`prestataire.email` à la connexion. Si l'appel admin de clôture a échoué, une simple
reconnexion **restaure les données que la clôture prétend avoir effacées**.

### P1-7 · Quotas d'authentification consommés avant vérification du mot de passe
`MOYENNE` · confirmé · heures

`src/app/actions/auth.ts:141` consomme le quota `sign_in` **avant**
`signInWithPassword` (`:147`), inconditionnellement. N'importe qui peut verrouiller un
utilisateur nommé, connexion **et** réinitialisation.

**Correctif :** inverser — l'IP en pré-contrôle, le bucket email consommé seulement
sur échec.

### P1-8 · CSP : `script-src 'unsafe-inline'` en production
`MOYENNE` · angle mort · heures

`next.config.ts:263`, sans nonce ni hash. Le reste de l'en-tête est solide
(`object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`) — ce point-là ne
l'est pas.

### P1-9 · Aucun signal de vulnérabilité des dépendances
`MOYENNE` · confirmé · minutes

`.github/` ne contient qu'un fichier. Pas de Dependabot, pas de Renovate, pas d'étape
`pnpm audit` en CI. C'est ce qui a laissé passer P0-2.

### P1-10 · Actions GitHub épinglées par tag mutable
`MOYENNE` · angle mort · minutes

`actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/setup-node@v4`. Un repoint de
tag exécute du code arbitraire dans une CI qui détient tes secrets.

---

## P2 — Dette réelle, non bloquante

| # | Constat | Verdict | Effort |
|---|---|---|---|
| P2-1 | Aucune limite de rétention ni chemin d'effacement pour les données des débiteurs | confirmé | heures |
| P2-2 | L'escalade automatique vers un humain meurt après cinq essais silencieux | confirmé | heures |
| P2-3 | La CI ne lance pas les harnais SQL billing / account-lifecycle / notification-preferences / runtime-relances | confirmé | minutes |
| P2-4 | Quota Stripe partagé consommable par un appelant non authentifié (`accounts.retrieve` avant le rate limit) | dégradé | minutes |
| P2-5 | Garde anti-double-débit inatteignable (code mort) | dégradé | minutes |
| P2-6 | Rejets financiers terminaux acquittés en HTTP 200 sans garde-fou durable | dégradé | heures |
| P2-7 | La clôture de compte ne révoque rien : `account_status` n'est jamais lu par le code applicatif | dégradé | heures |
| P2-8 | Budget LLM durable implémenté mais non câblé | angle mort | heures |
| P2-9 | Aucun balayage des sessions Checkout périmées | angle mort | heures |
| P2-10 | Deux des trois fonctions de purge n'ont aucun appelant | angle mort | minutes |

---

## P3 — Hygiène

| # | Constat | Verdict | Effort |
|---|---|---|---|
| P3-1 | `/api/health` public divulgue encore la joignabilité de la base — ce que son propre commentaire dit avoir corrigé | confirmé | minutes |
| P3-2 | `packageManager` non épinglé : la politique de refus des scripts d'install tient par convention | confirmé | minutes |
| P3-3 | `POST /api/agent/tools` résout le locataire deux fois depuis deux credentials → mélange de transcripts | confirmé | heures |
| P3-4 | Six routes API parsent le corps avant d'authentifier, sans borne de taille | dégradé | heures |
| P3-5 | Le navigateur peut écrire des messages attribués à `sidian_agent` | dégradé | heures |
| P3-6 | Aucun quota par locataire sur l'enregistrement de documents | dégradé | heures |
| P3-7 | Jetons de lien de paiement sans expiration | dégradé | heures |
| P3-8 | `payouts_enabled` calculé, stocké, affiché — puis ignoré par la barrière de payabilité | dégradé | heures |
| P3-9 | Un refus explicite d'autorisation de prélèvement peut être renversé | dégradé | heures |
| P3-10 | Objets Storage orphelins survivant à la clôture de compte | dégradé | heures |
| P3-11 | `enqueue_runtime_job` : seule écriture scopée sans trigger de cohérence | dégradé | minutes |
| P3-12 | Toute ligne d'outbox estampillée `provider_kind='resend'` alors que Brevo envoie | dégradé | minutes |
| P3-13 | Le CRON_SECRET de production est confié à un tiers gratuit et sert aussi de credential de diagnostic | dégradé | minutes |
| P3-14 | Le seul outil capable de forger tes JWT opérationnels est un fichier non versionné sur une machine | dégradé | minutes |
| P3-15 | PKCE lie la confirmation au navigateur d'origine : ouvrir l'email ailleurs est une impasse | dégradé | heures |
| P3-16 | L'inscription révèle l'existence d'un compte (choix assumé le 4 août, à réévaluer) | dégradé | minutes |
| P3-17 | Chaque sujet de rate limit est HMAC'é avec `SUPABASE_SERVICE_ROLE_KEY` : une rotation orpheline tous les quotas | angle mort | minutes |
| P3-18 | `pdfjs-dist` rend les PDF utilisateur sans `isEvalSupported: false` | angle mort | minutes |
| P3-19 | Sidian ne prélève aucune commission : `application_fee_amount` codé à 0 | angle mort | décision produit |

---

## Réfutés — ne pas y passer de temps

- **« Les garde-fous SQL sur l'argent lèvent des `approval_request` que rien ne
  remonte »** — faux. `src/lib/dashboard/load-dashboard.ts:42-46` les sélectionne et
  les affiche.
- **« Aucune barrière d'authentification en profondeur sur `/app` »** — faux.
  `src/proxy.ts:10-12` et `:38-42` couvrent bien toutes les routes non statiques.
  *(Résidu réel : `src/lib/supabase/proxy.ts:68-74` ne vérifie que l'existence d'un
  utilisateur, pas `email_confirmed_at`.)*

---

## Contradictions de documentation à trancher

- `AGENTS.md` impose la RLS sur toute table scopée ; le détecteur de dérive n'en
  couvre que 19 sur 34.
- `SIDIAN_03` §6.1 présente `search_path = public` comme un **invariant** ; l'audit du
  3 août le classe comme **faiblesse** (absence de `pg_temp`).
- `SIDIAN_03` §6.2 exige le rate limiting sur l'IA et les webhooks : non implémenté.
- `PRE_DEPLOYMENT_CHECKLIST.md:153` marque « SECURITY DEFINER — search_path » à faire,
  `SIDIAN_IMPLEMENTATION_STATUS.md:79` le marque fait.
- `OPERATIONS.md` §0 et §5 décrivent un cron de drains « depuis vercel.json » supprimé
  au commit `ff7b88c`. Le drain tourne aujourd'hui via un tiers externe documenté
  seulement dans `USER_ACTIONS_REQUIRED.md` §2bis.

---

## Ce qui est solide

À ne pas remettre en question sans raison :

- Attestation d'environnement signée, vérifiée **au build et en base**.
- Rate limiting d'authentification qui **échoue fermé**.
- Posture anti-énumération sur la réinitialisation, assumée et commentée.
- Parcours RGPD d'`account_lifecycle`, avec justification légale L123-22 / art. 17.3.b.
- En-têtes de sécurité : `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`.
- Jetons de paiement : la crainte du « token dans l'URL » **ne tient pas** — vérifié
  sur `/p/[token]` et `/p/retour`.
- Aucune donnée de carte ou d'IBAN brute stockée : conforme à `AGENTS.md`.

---

## Ce qui exige une action humaine

Ces points ne peuvent pas être réglés depuis le dépôt :

1. **Plan Supabase et sauvegardes** (P0-1) — décision de plan, puis restauration répétée.
2. **Allowlist d'accès anticipé** (P0-4) — décision produit : quelles adresses.
3. **Variables Vercel** — cinq variables limitées à la branche `develop`, et
   `SUPABASE_ENVIRONMENT_ATTESTATION_JWT` absente du scope Preview : aucun aperçu ne
   peut se construire sur une branche de feature. Nécessite de forger un JWT staging
   avec `scripts/sign-attestation-jwt.mjs` — donc le secret JWT du projet.
4. **`SUPABASE_SERVICE_ROLE_KEY` présente dans le scope Preview** — clé qui contourne
   toute la RLS, distribuée à tout déploiement d'aperçu. À retirer ou à isoler.
5. **Séparation staging / production** — à confirmer : la production semble pointer
   sur le projet Supabase nommé `sidian-staging`.
6. **Templates d'email Supabase en anglais** — dashboard uniquement.

---

*Audit produit le 5 août 2026. Chaque constat porte sa source fichier:ligne dans le
journal d'exécution. Les verdicts « dégradé » signalent un constat réel dont la
gravité initiale a été revue à la baisse après relecture du code.*
