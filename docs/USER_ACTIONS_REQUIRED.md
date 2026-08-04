# SIDIAN V2 — ACTIONS RESTANT AU PROPRIÉTAIRE

**Date :** 3 août 2026

Ce document ne liste **que** ce que le code ne peut pas faire à ta place :
créer des comptes, récupérer des secrets, obtenir des approbations externes,
et trancher des choix produit, légaux ou commerciaux.

Aucune clé réelle ne figure ici et aucune n'a été créée pendant le
développement. Toutes les variables ci-dessous sont vides dans le dépôt.

**Règle de lecture.** Une action marquée 🔴 empêche le lancement. 🟠 est
indispensable au MVP. 🟡 peut attendre l'après-lancement.

> ⚠️ **Ce que les secrets suffiront à débloquer, et ce qu'ils ne débloqueront
> pas.** Une fois Brevo configuré, la **relance de prévention (J-5)** et la
> **notification d'échec de paiement** partiront automatiquement. En revanche
> la **relance à l'échéance** et l'**escalade après silence** resteront
> bloquées : elles ont besoin d'une décision de ta part (§7.3 bis), pas d'une
> clé. Le prélèvement automatique reste bloqué par §7.3.

---

## 1. Supabase

### 🔴 1.1 — Configurer un SMTP de production

- **Service :** Supabase → Authentication → Email Templates / SMTP Settings
- **Pourquoi :** `supabase/config.toml` (§`[auth.email.smtp]`) n'a aucun SMTP.
  Sans lui, **aucun email de confirmation d'inscription ni de réinitialisation
  de mot de passe ne part**. Personne ne peut créer de compte.
- **À récupérer :** hôte, port, utilisateur, mot de passe, adresse d'expédition
  du fournisseur choisi. **Brevo expose un relais SMTP distinct de son API v3**
  — voir §4.2, c'est une erreur fréquente.
- **Où le renseigner :** tableau de bord Supabase du projet (staging, puis production).
- **Validation :** créer un compte de test, recevoir l'email, cliquer le lien,
  arriver authentifié sur `/app`.
- **Risque si oublié :** produit inutilisable — aucune inscription possible.

### 🔴 1.2 — Renseigner `site_url` et `additional_redirect_urls`

- **Service :** Supabase → Authentication → URL Configuration
- **Pourquoi :** `supabase/config.toml` ne contient que `localhost`. Les liens
  de confirmation et de réinitialisation pointeront vers localhost en production.
- **À renseigner :** l'URL publique réelle, et l'entrée de callback
  `https://<domaine>/auth/callback` (le code y ajoute `?next=…`).
- **Validation :** l'email reçu en staging ouvre bien le domaine de staging.
- **Risque si oublié :** parcours d'inscription et de mot de passe oublié cassés.

### 🔴 1.3 — Appliquer les migrations

- **Action :** appliquer les 52 migrations de `supabase/migrations/` sur
  staging, valider, puis sur production.
- **Inclut les trois migrations ajoutées dans cette session :**
  `20260803120000_theme_preference.sql` (apparence), `20260803130000_runtime_job_completion.sql` (consommateur runtime), `20260803140000_document_storage.sql` (stockage documentaire).
- **Validation :** `select theme_preference from prestataire limit 1;` répond,
  et la valeur par défaut est `light`.
- ✅ **Les 52 migrations ont été appliquées et validées sur une base locale**,
  policies `storage.objects` comprises, et les 26 harnais SQL passent. Le SQL
  n'est plus une inconnue. **Applique-les néanmoins sur staging avant
  production** : ta base contient des données réelles, pas une base vierge.
- ✅ `src/types/database.generated.ts` a été régénéré depuis la base. Il ne
  contient plus de retouche manuelle. `pnpm types:check` vérifie qu'il ne
  dérive pas ; relance-le après toute nouvelle migration.

### 🔴 1.4 — Récupérer les clés du projet

| Variable | Où la trouver | Secret |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API | non |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API | non |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API | **oui** |
| `SIDIAN_SUPABASE_PROJECT_REF` | sous-domaine avant `.supabase.co` | non |

### 🟠 1.5 — Générer les deux JWT opérationnels

Le code exige deux JWT signés par le projet ciblé. **Tous deux portent une
date d'expiration (`exp`) et font échouer l'application à l'expiration, sans
aucune alerte préalable.**

| Variable | Rôle | Requis quand |
|---|---|---|
| `SUPABASE_ENVIRONMENT_ATTESTATION_JWT` | `role=sidian_environment_attestor`, claims `sidian_environment` + `sidian_project_ref` | toujours sur Vercel |
| `SUPABASE_STRIPE_BINDING_WRITER_JWT` | `role=stripe_customer_binding_writer`, claim `sidian_environment` | seulement si Stripe activé |

- **Action complémentaire :** noter les deux dates d'expiration dans un
  calendrier et prévoir la rotation. Aucun monitoring d'expiration n'existe.
- **Risque si oublié :** à l'expiration, l'application tombe intégralement.

---

## 2. Vercel

### 🔴 2.1 — Définir `CRON_SECRET`

- **Pourquoi :** sans cette valeur, `/api/cron/scanners` et `/api/cron/drains`
  répondent **503 en silence**, indéfiniment. Aucune alerte. Cette variable
  n'est vérifiée ni au build ni au démarrage.
- **À faire :** générer une valeur aléatoire ≥ 32 caractères, la renseigner sur
  staging et production. Vercel enverra `Authorization: Bearer $CRON_SECRET`.
- **Validation :** appeler la route cron sans en-tête → 401 ; avec le bon
  secret → 200.

### 🔴 2.2 — Renseigner `SIDIAN_ENVIRONMENT` et `NEXT_PUBLIC_APP_URL`

- `SIDIAN_ENVIRONMENT` : `staging` ou `production`. Obligatoire sur Vercel.
- `NEXT_PUBLIC_APP_URL` : **retombe silencieusement sur `http://localhost:3000`**,
  et cette valeur est intégrée aux liens de paiement envoyés aux clients.
- **Risque si oublié :** liens de paiement pointant vers localhost — envoyés à
  de vrais clients.

### 🟠 2.3 — Choisir le plan Vercel

- **Décision :** `vercel.json` planifie les drains toutes les 5 minutes
  (`*/5 * * * *`). **Cette cadence exige un plan Pro ou supérieur** ; le plan
  Hobby est limité à un déclenchement quotidien.
- **Alternative :** rester en Hobby et accepter une cadence quotidienne, ce qui
  dégrade fortement la réactivité des relances.

### 🟠 2.4 — Renseigner `SIDIAN_PAYMENT_AUTHORIZATION_TOKEN_SECRET`

- Secret HMAC dédié aux tokens d'autorisation de paiement futur, ≥ 32 caractères.
- **Ne jamais réutiliser** `SUPABASE_SERVICE_ROLE_KEY`.
- ⚠️ Cette variable **n'est pas couverte par la validation au build** alors
  qu'elle est une dépendance dure à l'exécution.

---

## 3. Stripe

> Deux usages distincts, à ne pas confondre : (a) l'abonnement au produit
> Sidian, (b) les paiements protégés des clients via Connect. **Seul (b) est
> implémenté.** Voir §7.1.

### 🔴 3.1 — Créer le compte Stripe de production et activer Connect

| Variable | Où | Secret |
|---|---|---|
| `STRIPE_SECRET_KEY` | Developers → API keys | **oui** |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Developers → API keys | non |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Developers → Webhooks → endpoint | **oui** |
| `STRIPE_MODE` | `test` ou `live` | non |
| `NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED` | `true` / `false`, littéral | non |

- Le build **refuse** une clé `sk_test_` en production et une clé `sk_live_`
  hors production. C'est volontaire.

### 🔴 3.2 — Créer l'endpoint webhook

- **URL :** `https://<domaine>/api/stripe/webhook`
- **Validation :** envoyer un événement de test depuis Stripe, vérifier une
  ligne dans `processed_webhook_event`.
- **Risque si oublié :** aucun paiement n'est jamais réconcilié.

### 🟠 3.3 — Vérifier `losses_collector` / `fees_collector`

- Sur les comptes connectés, confirmer qui supporte les pertes et les frais.
  Ce réglage a des conséquences financières directes et n'est pas déductible
  du code.

---

## 4. Brevo (email)

> Le code supporte **Brevo** (défaut) et Resend. Le vendor se choisit par
> `SIDIAN_EMAIL_PROVIDER` — les deux contrats HTTP diffèrent, le choix est donc
> explicite et jamais déduit de la forme de la clé.

### 🟠 4.1 — Compte, domaine vérifié, clé API

**Étape par étape :**

1. **Crée le compte Brevo** (ou connecte-toi) sur brevo.com.
2. **Ajoute et vérifie ton domaine d'envoi** : Brevo → *Senders, Domains &
   Dedicated IPs* → *Domains* → *Add a domain*.
3. **Ajoute les DNS que Brevo t'affiche** chez ton registrar :
   - un enregistrement **DKIM** (`mail._domainkey`, valeur fournie par Brevo) ;
   - le **SPF** (`v=spf1 include:spf.brevo.com ~all` — si tu as déjà un SPF,
     **fusionne**, n'en crée pas un second : deux SPF invalident les deux) ;
   - un **DMARC** (`_dmarc`, commence par `v=DMARC1; p=none;` pour observer
     avant de durcir).
   Attends que le domaine passe **« Verified »** dans Brevo (propagation DNS :
   quelques minutes à quelques heures).
4. **Crée un expéditeur** avec une adresse de ce domaine.
5. **Génère la clé API** : Brevo → *SMTP & API* → onglet **API Keys** →
   *Generate a new API key*.
   ⚠️ **Prends bien la clé API v3 (préfixe `xkeysib-`), pas la clé SMTP.** Elles
   ne sont pas interchangeables : la clé SMTP ne fonctionne pas sur l'API et
   produirait un `401` à chaque envoi.

**Variables à renseigner :**

| Variable | Valeur |
|---|---|
| `SIDIAN_EMAIL_PROVIDER_ENABLED` | `true` |
| `SIDIAN_EMAIL_TRANSPORT_MODE` | `live` (le mode `stub` est refusé hors local) |
| `SIDIAN_EMAIL_PROVIDER` | `brevo` |
| `SIDIAN_EMAIL_API_KEY` | **secret** — la clé `xkeysib-…` |
| `SIDIAN_EMAIL_FROM_ADDRESS` | une adresse du domaine vérifié |
| `SIDIAN_EMAIL_FROM_NAME` / `_REPLY_TO` | optionnelles |

**Validation :** `pnpm doctor` affiche « Email (Brevo) · mode live », puis
déclenche un envoi de test et vérifie qu'il arrive **hors spam**.

**Risque si oublié :** sans domaine vérifié, la délivrabilité s'effondre et les
relances finissent en spam.

### 🟠 4.2 — SMTP Supabase : la même clé ne suffit pas

⚠️ **Attention, ce sont deux choses différentes.** Les emails d'authentification
(confirmation d'inscription, mot de passe oublié) partent par **Supabase**, pas
par le runtime Sidian. Supabase veut un **relais SMTP**, pas l'API v3.

Dans Brevo → *SMTP & API* → onglet **SMTP**, récupère :
- serveur `smtp-relay.brevo.com`, port `587`
- ton **login SMTP** et ta **clé SMTP** (≠ clé API v3)

et renseigne-les dans Supabase → *Authentication* → *SMTP Settings* (voir §1.1).

### 🟡 4.3 — Décider de la politique de désabonnement

Aucun mécanisme d'opt-out n'existe sur les emails sortants. Selon la
qualification juridique de ces messages (transactionnels vs relance
commerciale), un lien de désabonnement peut être obligatoire. **À valider avec
un juriste.**

## 5. Meta / WhatsApp Cloud API

### 🟠 5.1 — Créer le compte WhatsApp Business et récupérer les identifiants

| Variable | Secret |
|---|---|
| `SIDIAN_WHATSAPP_ACCESS_TOKEN` | **oui** |
| `SIDIAN_WHATSAPP_APP_SECRET` | **oui** |
| `SIDIAN_WHATSAPP_WEBHOOK_VERIFY_TOKEN` | **oui** (valeur que tu choisis) |
| `SIDIAN_WHATSAPP_PHONE_NUMBER_ID` | non |
| `SIDIAN_WHATSAPP_BUSINESS_ACCOUNT_ID` | non |
| `SIDIAN_WHATSAPP_GUIDE_RECIPIENT_TECHNICAL_ID` | non |

- ⚠️ `SIDIAN_WHATSAPP_GUIDE_RECIPIENT_TECHNICAL_ID` **n'est pas contrôlée par
  la validation live** alors que son absence fait échouer l'envoi.
- **Webhook :** `https://<domaine>/api/whatsapp/webhook`, avec le verify token
  ci-dessus. Le code vérifie la signature HMAC-SHA256.

### 🟠 5.2 — Faire approuver les templates par Meta

- **Décision + délai externe.** Le message « Guide » part aujourd'hui en
  message `interactive` (liste), pas en template approuvé : **hors de la
  fenêtre de 24 h, Meta le rejettera**.
- **À trancher :** boutons ou liste. Meta plafonne à **3 boutons de réponse
  rapide** — si le parcours en demande plus, il faut le redécouper.
- **Délai :** l'approbation Meta prend généralement de quelques heures à
  quelques jours. À lancer tôt.

---

## 6. Fournisseur d'IA (OpenAI / Anthropic)

### 🟠 6.1 — Créer le projet et récupérer la clé

| Variable | Valeur |
|---|---|
| `SIDIAN_LLM_PROVIDER_ENABLED` | `true` |
| `SIDIAN_LLM_TRANSPORT_MODE` | `live` |
| `SIDIAN_LLM_API_KEY` | **secret** |
| `SIDIAN_LLM_BASE_URL` | endpoint compatible OpenAI |
| `SIDIAN_LLM_MODEL` | le modèle choisi |

- ⚠️ **Le chemin « live » n'a jamais été exercé contre une vraie clé.** Prévoir
  un test de bout en bout en staging avant d'ouvrir au public.
- ⚠️ **L'adaptateur Anthropic n'existe pas.** Le runtime est aujourd'hui
  mono-fournisseur, au format OpenAI. Utiliser Anthropic demande un
  développement (voir l'audit technique).
- La variable `OPENAI_API_KEY` présente dans `.env.example` est **morte** :
  elle n'est lue par aucun code actif.

### 🟠 6.2 — Fixer les plafonds de coût

- **Décision.** Les plafonds livrés
  (`SIDIAN_LLM_BUDGET_MAX_REQUESTS_PER_MINUTE=30`, `…TOKENS_PER_MINUTE=50000`,
  `…REQUESTS_PER_SCOPE_PER_HOUR=200`) sont des valeurs de remplissage, sans
  base de coût. À arrêter en fonction du prix réel du modèle et du budget mensuel.
- ⚠️ Ces compteurs sont **en mémoire du processus** : ils ne tiennent pas entre
  instances serverless. Le plafond réel est donc supérieur à la valeur affichée.

### 🟠 6.3 — Trancher le comportement en mode dégradé

- **Décision produit + juridique.** Quand l'IA est désactivée, en panne, ou
  répond hors schéma, le produit sert aujourd'hui une extraction déterministe
  **sans le dire à l'utilisateur**. Les champs `extraction_source` et
  `fallback_used` sont calculés puis jetés par l'interface.
- **À décider :** refuser explicitement, ou dégrader avec une mention visible.

---

## 7. Décisions produit et commerciales

### 🔴 7.1 — L'abonnement Sidian n'est pas encaissable

- **Constat :** il n'existe **aucun** code Stripe Billing — ni produit, ni prix,
  ni portail, ni relance d'impayé. `prestataire.subscription_status` n'a
  **aucun chemin d'écriture** : il reste `trialing` indéfiniment, et le
  résolveur d'accès accorde tous les droits à cet état.
- **Conséquence :** l'offre à 49 € HT/mois décrite dans
  `docs/SIDIAN_02_PRD_V2.md` §6 ne peut être ni facturée, ni appliquée.
- **Ce que tu dois faire :** créer les produits et prix dans Stripe, puis
  reporter leurs identifiants. **Ce que le code doit faire :** tout le reste —
  c'est un chantier de développement complet, pas une action de configuration.

### 🔴 7.2 — CGU et politique de confidentialité

- **Constat :** le formulaire d'inscription **exige** l'acceptation des CGU et
  de la politique de confidentialité. Ces deux documents **n'existent pas** :
  ce ne sont même pas des liens, et **le consentement n'est jamais conservé**.
- **À faire :** faire rédiger les deux documents par un juriste, les publier,
  et décider si la preuve du consentement doit être horodatée et stockée
  (recommandé).
- **Risque si oublié :** exposition juridique directe, et consentement
  non opposable.

### 🟠 7.3 — Le prélèvement automatique est verrouillé

- **Constat :** le plafond d'auto-débit est codé en dur
  (`AUTO_DEBIT_REGLE_CEILING_PRODUCT_READY = false`,
  `src/lib/runtime/payments/constants.ts`). Toute tentative de prélèvement
  automatique échoue de façon terminale, et un bandeau sans issue est affiché
  à l'utilisateur.
- **À décider :** le plafond autorisé, les conditions de déclenchement, et
  l'encadrement juridique du mandat.

### 🔴 7.3 bis — Le lien de paiement ne peut pas être renvoyé par un automate

**C'est la décision la plus importante qu'il te reste à prendre.**

**Constat, vérifié en base :** la table `payment_link` ne stocke que
`token_hash`. Le token brut n'existe qu'une seule fois, en mémoire, au moment
où *toi* prépares le lien ; il est renvoyé une fois puis irrécupérable — même
pour toi (`shareUrl: null` si le lien est déjà préparé).

C'est une bonne propriété de sécurité. Mais elle a une conséquence directe :
**un worker ne peut pas construire l'URL de paiement**, donc la relance à
l'échéance — celle qui porte le lien — ne peut pas partir automatiquement.

Le code est câblé et honnête : le job échoue avec
`payment_link_url_unavailable` plutôt que d'envoyer un email amputé de son
lien. Rien n'est simulé. Mais rien ne part non plus.

**Trois options, à trancher :**

| Option | Ce que ça implique | Risque |
|---|---|---|
| **A.** Le worker crée un nouveau lien à l'envoi | Relance entièrement automatique | Un automate émet une URL de paiement sans action humaine ; plusieurs liens valides coexistent |
| **B.** L'email renvoie vers le lien déjà reçu, sans le reproduire | Aucun changement de sécurité | Demande un nouveau gabarit ; le client doit retrouver l'email initial |
| **C.** Conserver le token chiffré (et non haché) | Renvoi possible du même lien | Change la posture de sécurité : un secret redevient déchiffrable côté serveur |

**Ma recommandation : B**, puis A plus tard si l'usage le réclame. B ne
dégrade aucune garantie et couvre le cas courant — le client a reçu le lien,
il l'a laissé de côté.

**Tant que tu n'as pas tranché :** la prévention (J-5) et la notification
d'échec de paiement partent normalement. La relance à l'échéance et
l'escalade après silence sont câblées mais refusent d'envoyer.

### 🟠 7.4 — Contradiction sur le verrouillage tarifaire Early Access

`docs/SIDIAN_02_PRD_V2.md` §194 se contredit sur la durée du verrouillage du
tarif Early Access. À trancher avant toute communication commerciale.

### 🟠 7.5 — « Dossiers » et « Paiements » affichent la même chose

Les deux entrées de navigation exécutent **exactement la même requête** avec
trois vocabulaires différents (Dossiers / Paiements / Protections). À trancher :
fusionner, ou différencier réellement le contenu.

### 🟠 7.6 — « Analyser un document » promet une capacité inexistante

L'action rapide mise en avant sur l'écran d'accueil propose d'analyser un
document. **Aucune analyse n'existe** : ni OCR, ni lecture de PDF, ni
transcription. L'assistant répond lui-même que la capacité est indisponible.
De plus, **les fichiers ne sont stockés nulle part** : ils vivent en mémoire du
navigateur et disparaissent au rechargement.
- **À décider :** retirer la promesse, ou financer le chantier stockage +
  extraction.

### 🟡 7.7 — Conservation et suppression des documents

Aucune politique de rétention, de nettoyage des fichiers orphelins, ni de
suppression à la clôture d'un compte. À définir (RGPD).

### 🟡 7.8 — Suppression de compte

Aucun parcours de suppression n'existe, et la contrainte
`on delete restrict` sur `prestataire.user_id` l'interdit au niveau base.
Un droit à l'effacement exige un chantier dédié.

### 🟡 7.9 — Le design lock est en retard sur l'implémentation

`docs/design/SIDIAN_DESIGN_LOCK.md` décrit un bloc KPI que l'implémentation a
volontairement retiré, et indique « Dark mode par défaut » alors que la
décision retenue est **Clair par défaut**, l'espace Agent restant sombre.
À mettre à jour pour que le document reste la référence.

---

## 8. Ordre d'exécution conseillé

1. **Supabase** — migrations, SMTP, URLs de redirection, clés (§1). Sans cela, rien ne fonctionne.
2. **Vercel** — `CRON_SECRET`, `SIDIAN_ENVIRONMENT`, `NEXT_PUBLIC_APP_URL` (§2).
3. **Juridique** — lancer la rédaction des CGU et de la politique de confidentialité (§7.2) : c'est le délai externe le plus long avec Meta.
4. **Meta** — soumettre les templates à approbation (§5.2) : délai externe.
5. **Stripe** — compte, Connect, webhook (§3).
6. **Resend** — domaine et DNS (§4).
7. **IA** — clé et plafonds (§6).
8. **Décisions produit** (§7) — en parallèle.

---

## 9. Vérification finale

Une fois tout renseigné, sur **staging d'abord** :

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm test:forms
```

Puis, avec une base locale démarrée (`npx supabase@2.109.1 start` — Docker
requis), les suites SQL : `pnpm test:schema`, `pnpm test:auth`,
`pnpm test:user-data-isolation`, `pnpm test:security-*`, `pnpm test:stripe-*`.

Enfin, **le test qui compte le plus** : créer **deux comptes réels distincts**,
et vérifier depuis chacun qu'aucune donnée de l'autre n'est visible — dossiers,
clients, paiements, conversations, activité.
