# SIDIAN — MISE EN SERVICE, PAS À PAS

Suis les étapes dans l'ordre. Chacune se termine par un **contrôle** : ne passe
à la suivante que si le contrôle passe.

Durée réelle de manipulation : environ 2 h. Mais l'**étape 1** et l'**étape 2**
déclenchent des délais d'attente externes (DNS, juriste, Meta) : commence par
elles, même si tu fais le reste plus tard.

---

## ÉTAPE 1 — Brevo : vérifier ton domaine

> À faire en premier : la propagation DNS peut prendre de quelques minutes à
> quelques heures.

**1.1** Crée ton compte sur brevo.com (ou connecte-toi).

**1.2** Va dans **Senders, Domains & Dedicated IPs**, onglet **Domains**, puis
*Add a domain*. Saisis ton domaine d'envoi (ex. `sidian.fr`).

**1.3** Brevo affiche des enregistrements DNS. Va chez ton registrar (celui où
tu as acheté le domaine) et ajoute-les :

- **DKIM** — un enregistrement TXT nommé `mail._domainkey`, valeur donnée par Brevo.
- **SPF** — TXT à la racine : `v=spf1 include:spf.brevo.com ~all`
  ⚠️ **Si tu as déjà un enregistrement SPF, ne le duplique pas : fusionne.**
  Deux SPF sur un même domaine les invalident tous les deux.
  Exemple de fusion : `v=spf1 include:spf.brevo.com include:_spf.google.com ~all`
- **DMARC** — TXT nommé `_dmarc`, valeur `v=DMARC1; p=none; rua=mailto:toi@ton-domaine`
  (`p=none` observe sans bloquer ; tu durciras plus tard).

**1.4** Retourne dans Brevo et attends que le domaine passe **Verified**.

**1.5** Crée un expéditeur avec une adresse de ce domaine
(ex. `relances@sidian.fr`).

**✅ Contrôle :** le domaine affiche **Verified** dans Brevo.

---

## ÉTAPE 2 — Lancer les deux délais externes

> Rien à installer. Deux emails à envoyer, aujourd'hui.

**2.1 — Juriste.** Fais rédiger les **CGU** et la **politique de
confidentialité**. C'est bloquant : le formulaire d'inscription les fait déjà
accepter et elles n'existent pas.

Demande-lui aussi de trancher : faut-il **horodater et conserver la preuve du
consentement** ? (recommandé) Et les emails de relance sont-ils
*transactionnels* ou *commerciaux* ? (la réponse détermine si un lien de
désabonnement est obligatoire).

**2.2 — Meta / WhatsApp.** Si tu veux le canal WhatsApp au lancement, crée le
compte WhatsApp Business et **soumets tes templates à approbation** dès
maintenant : Meta met de quelques heures à quelques jours.

**✅ Contrôle :** les deux demandes sont parties.

---

## ÉTAPE 3 — Brevo : récupérer tes deux clés

> ⚠️ **L'erreur la plus fréquente.** Brevo donne **deux** identifiants
> différents et il te faut **les deux**. Ils ne sont pas interchangeables.

**3.1** Va dans **SMTP & API**.

**3.2** Onglet **API Keys** → *Generate a new API key*.
Copie-la : elle commence par **`xkeysib-`**. → C'est la **clé API v3**, pour les
relances Sidian.

**3.3** Onglet **SMTP**. Note ton **login SMTP** et ta **clé SMTP**.
→ C'est pour les emails de connexion, via Supabase.

**✅ Contrôle :** tu as deux valeurs distinctes sous les yeux. Si tu n'en as
qu'une, tu n'as pas fini.

---

## ÉTAPE 4 — Supabase

> Sans cette étape, **personne ne peut créer de compte**.

**4.1 — SMTP.** Projet Supabase → **Authentication** → **SMTP Settings** :

| Champ | Valeur |
|---|---|
| Host | `smtp-relay.brevo.com` |
| Port | `587` |
| Username | ton **login SMTP** (étape 3.3) |
| Password | ta **clé SMTP** (étape 3.3, **pas** la clé `xkeysib-`) |
| Sender email | l'adresse créée en 1.5 |

**4.2 — URLs.** **Authentication** → **URL Configuration** :
- *Site URL* : ton URL réelle (ex. `https://app.sidian.fr`)
- *Redirect URLs* : ajoute `https://app.sidian.fr/auth/callback`

**4.3 — Migrations.** Applique les migrations de `supabase/migrations/` sur ton
projet **staging** d'abord. Ne va jamais directement en production.

**4.4 — Clés.** **Project Settings** → **API**, récupère :
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`.

**✅ Contrôle :** `select theme_preference from prestataire limit 1;` répond
sans erreur.

---

## ÉTAPE 5 — Vercel : les variables

**5.1** Projet Vercel → **Settings** → **Environment Variables**.

**5.2** Ajoute, pour l'environnement **Preview** (= ton staging) :

```
SIDIAN_ENVIRONMENT=staging
NEXT_PUBLIC_APP_URL=https://<ton-domaine-staging>

NEXT_PUBLIC_SUPABASE_URL=<étape 4.4>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<étape 4.4>
SUPABASE_SERVICE_ROLE_KEY=<étape 4.4>

CRON_SECRET=<32+ caractères aléatoires>
SIDIAN_PAYMENT_AUTHORIZATION_TOKEN_SECRET=<32+ caractères, DIFFÉRENT du précédent>

SIDIAN_EMAIL_PROVIDER_ENABLED=true
SIDIAN_EMAIL_TRANSPORT_MODE=live
SIDIAN_EMAIL_PROVIDER=brevo
SIDIAN_EMAIL_API_KEY=xkeysib-<étape 3.2>
SIDIAN_EMAIL_FROM_ADDRESS=relances@<ton-domaine>
SIDIAN_EMAIL_FROM_NAME=Sidian
```

Pour générer un secret : `openssl rand -base64 32`

⚠️ **`NEXT_PUBLIC_APP_URL` retombe silencieusement sur `localhost` si tu
l'oublies** — et cette valeur part dans les liens de paiement envoyés à tes
vrais clients.

**5.3 — Plan.** Les tâches planifiées tournent toutes les 5 minutes, ce qui
exige un plan **Pro**. En Hobby, tu es limité à un déclenchement par jour et la
réactivité des relances s'effondre.

**✅ Contrôle :** un déploiement staging réussit.

---

## ÉTAPE 6 — Vérifier

**6.1** En local, sur le dépôt :

```bash
pnpm doctor
```

Il liste ce qui est configuré et ce qui manque, **sans jamais afficher un
secret**. Corrige tout ce qu'il signale comme bloquant.

**6.2 — Inscription réelle.** Sur staging : crée un compte, reçois l'email,
clique le lien, arrive authentifié.

**6.3 — Le test qui compte le plus.** Crée **deux comptes réels distincts**.
Depuis chacun, vérifie qu'aucune donnée de l'autre n'est visible : dossiers,
clients, paiements, conversations, activité.

**✅ Contrôle :** les deux comptes sont parfaitement étanches.

---

## ÉTAPE 7 — Stripe

**7.1** Crée le compte, active **Connect**.

**7.2** **Developers** → **Webhooks** → *Add endpoint* :
`https://<ton-domaine>/api/stripe/webhook`

**7.3** Ajoute dans Vercel :

```
NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED=true
STRIPE_MODE=test
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...
```

Le build **refuse** une clé `sk_test_` en production et une `sk_live_` hors
production. C'est volontaire.

**7.4 — Abonnement Sidian.** Crée le produit et le prix, puis renseigne les
variables `STRIPE_BILLING_*` (voir `.env.example`).

**7.5** Vérifie qui supporte les pertes et les frais sur les comptes connectés
(`losses_collector` / `fees_collector`) — conséquences financières directes.

**✅ Contrôle :** un événement de test Stripe crée une ligne dans
`processed_webhook_event`.

---

## ÉTAPE 8 — Production

Rejoue les étapes 4, 5 et 7 sur l'environnement de production, avec :

- `SIDIAN_ENVIRONMENT=production`
- `STRIPE_MODE=live` et les clés `sk_live_` / `pk_live_`
- les migrations appliquées **après** validation sur staging

**✅ Contrôle final :** `pnpm doctor` ne signale aucun problème bloquant.

---

## Ce qui marchera à la fin

Inscription, connexion, gestion des clients et des dossiers, paiements clients
via Stripe Connect, abonnement Sidian, stockage des pièces jointes, thèmes
clair/sombre/auto, et **deux relances automatiques** : la prévention à J-5 et
la notification d'échec de paiement.

## Ce qui attendra encore une décision de ta part

**La relance à l'échéance et l'escalade après silence.** Ce n'est pas un
problème de clé : `payment_link` ne conserve que l'empreinte du jeton, donc un
automate ne peut pas reconstruire l'URL de paiement. Le code **refuse
d'envoyer** plutôt que d'expédier un email amputé de son lien.

Trois options dans `USER_ACTIONS_REQUIRED.md` §7.3 bis.
Recommandation : que l'email renvoie vers le lien déjà reçu sans le reproduire.
Une fois tranché, compte une demi-journée de développement.

**L'analyse de documents.** Les fichiers sont stockés mais jamais analysés :
il n'y a ni OCR, ni lecture de PDF, ni transcription. L'action « Analyser un
document » visible à l'accueil promet donc une capacité inexistante. À retirer,
ou à financer.
