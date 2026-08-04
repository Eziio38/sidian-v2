# UX_FLOWS.md — Parcours réels tels qu'implémentés

**Statut :** audit d'implémentation, pas de spécification.
**Instantané :** `fa6dbf8` + arbre de travail au 3 août 2026, 21 h 03 (249 fichiers modifiés non commités).
**Méthode :** chaque étape est vérifiée dans le code. Aucune étape n'est décrite parce qu'elle « devrait » exister.

> **Avertissement de fraîcheur.** Plusieurs fichiers de ce périmètre ont été modifiés
> pendant la rédaction (`src/app/globals.css` est passé de 553 à 582 lignes, `<main>` a été
> ajouté au workspace, `SuggestionDatePicker` et `ConfirmIrreversible` ont reçu leur gestion
> de focus). Les constats marqués **[corrigé pendant l'audit]** l'étaient encore au début de
> la lecture. Revérifier avant d'agir sur un constat isolé.

---

## Table des parcours

| # | Parcours | Point d'entrée | État |
| --- | --- | --- | --- |
| 1 | Inscription → confirmation → premier usage | `/inscription` | Fonctionnel, deux impasses |
| 2 | Onboarding | Aucun point d'entrée en navigation | Éclaté en deux modèles concurrents |
| 3 | Création d'un client | `/app/clients` | Fonctionnel, retour de conversation muet |
| 4 | Création d'une protection depuis la conversation | `/app/assistant` | Fonctionnel, non rejouable après rechargement |
| 5 | Parcours de paiement du client payeur | `/p/<token>` | Fonctionnel, coquille visuelle incohérente |
| 6 | Connexion Stripe (Connect Express) | `/app/parametres` → canal Stripe | Fonctionnel |
| 7 | Changement d'apparence (thème) | `/app/parametres` | Fonctionnel |
| 8 | Racine du domaine | `/` | **Impasse complète** |

---

## 0. Racine du domaine — impasse

`src/app/page.tsx` rend une carte « Socle technique / Sidian V2 / Version 0.1.0 /
Environnement <env> ». Aucun lien vers `/connexion` ni `/inscription`, aucun contenu produit.

Un visiteur qui tape le domaine n'a **aucun chemin** vers l'application. Le seul point
d'entrée réel est une URL connue à l'avance. Le lockup de marque des écrans d'auth
(`src/components/auth/auth-shell.tsx:22`, `href="/"`) renvoie d'ailleurs vers cette page
technique.

**Sortie :** aucune. Impasse P0 pour un nouvel utilisateur.

---

## 1. Inscription → confirmation email → premier usage

### Entrée

`/inscription` (`src/app/inscription/page.tsx`). `redirectIfAuthenticated()` renvoie vers
`/app` si une session existe déjà.

### Étapes

1. **Formulaire** — `src/components/auth/sign-up-form.tsx`. Six champs : nom d'affichage,
   nom d'agence, email, mot de passe, confirmation, plus deux cases à cocher (CGU,
   confidentialité). `noValidate` : toute la validation est serveur.
2. **Soumission** — `signUpAction` (`src/app/actions/auth.ts`). En cas d'erreur, l'état
   revient via `useActionState` avec `fieldErrors`, mais **aucune valeur n'est réinjectée
   dans les champs** : le formulaire est vidé (aucun `defaultValue` dans
   `sign-up-form.tsx`). Six champs à ressaisir pour une faute de frappe sur l'email.
3. **Succès** — `redirect("/inscription/verifier-email")` (`auth.ts:117`).
4. **Écran d'attente** — `src/app/inscription/verifier-email/page.tsx`. Texte statique,
   un seul lien : « Se connecter » vers `/connexion`.
5. **Clic sur le lien email** — `src/app/auth/callback/route.ts`, échange PKCE puis
   redirection applicative.
6. **Première page produit** — `/app` (`src/app/app/page.tsx`) fait un
   `redirect("/app/assistant")`.

### Points de décision

- `requireConfirmedUser()` (`src/lib/auth/session.ts:33`) renvoie vers
  `/inscription/verifier-email` tant que `email_confirmed_at` est nul.
- `redirectIfAuthenticated()` (`session.ts:43`) renvoie vers `/app` dès qu'une session
  existe, **confirmée ou non**.

### Impasses vérifiées

**I-1 — Boucle authentifié-non-confirmé.** Session ouverte mais email non confirmé :
`/connexion` → `redirectIfAuthenticated` → `/app` → `/app/assistant` →
`requireConfirmedUser` → `/inscription/verifier-email`. Cette page n'offre **ni
déconnexion, ni renvoi d'email de confirmation** — son seul lien ramène à `/connexion`,
qui relance la boucle. L'utilisateur ne peut plus rien faire dans le navigateur sans vider
ses cookies.

**I-2 — Consentement non liable.** `sign-up-form.tsx:82` et `:94` rendent
« conditions générales d'utilisation » et « politique de confidentialité » comme des
`<span className="font-medium text-nuit">`, pas des liens. Aucune route CGU/RGPD n'existe
dans `src/app`. L'utilisateur coche un consentement sur un document qu'il ne peut pas lire.

### Sorties

- Succès : `/app/assistant` en état d'accueil.
- Échec de validation : retour sur `/inscription`, champs vides.
- Non-confirmé : `/inscription/verifier-email`, sans issue.

---

## 2. Onboarding — deux modèles concurrents, aucun point d'entrée principal

Il existe **deux** représentations de la progression de démarrage, avec des étapes
différentes, et la plus complète des deux n'est atteignable par aucun lien de navigation.

### Modèle A — page `/app/demarrage`

`src/app/app/demarrage/page.tsx`, quatre étapes issues de
`buildOnboardingSteps` (`src/lib/onboarding/progress.ts`) : profil, client, premier
paiement à recevoir, Stripe. Barre de progression `role="progressbar"` avec pourcentage,
bannières `MissingConfigBanner` / `StatusBanner`, `DisabledHint` sur les étapes verrouillées.

Cette route **n'apparaît pas dans `APP_NAV`** (`src/components/app/app-nav-config.ts:14-51`) ;
« Bien démarrer » figure explicitement dans `LEGACY_NAV_LABELS` (`app-nav-config.ts:57`),
c'est-à-dire dans la liste des libellés qui *ne doivent plus* apparaître. Elle n'est
atteignable que par le lien d'action d'un canal `email` ou `whatsapp` non prêt
(`src/lib/ux/config-status.ts:36` et `:87`), affiché dans `ConfigStatusList` sur
`/app/parametres`. Un compte dont l'email et WhatsApp sont configurés ne verra jamais
cette page.

### Modèle B — bloc « Bien démarrer » de la sidebar

`src/components/app/app-sidebar.tsx:194-218`, **trois** étapes : ajouter un client,
importer une facture, créer un dossier. Pas d'étape Stripe. Affiché uniquement en
apparence `agent-dark` (donc uniquement sur `/app/assistant`), masquable définitivement
via `localStorage` (`app-sidebar.tsx:394`), sans moyen de le rappeler.

Les faits sont calculés dans `src/app/app/assistant/page.tsx:44-86` (comptages
`client_payeur`, `creance` d'origine `facture_externe`, `dossier_suivi`).

### Divergence

Un utilisateur qui suit le modèle B jusqu'au bout (3/3) n'a **pas** connecté Stripe et ne
peut donc encaisser aucun paiement — alors que le modèle A traite Stripe comme la
quatrième étape indispensable. Les deux modèles peuvent afficher des états contradictoires
sur le même compte.

**Décision humaine requise :** lequel des deux fait foi. Ne pas trancher dans le code.

---

## 3. Création d'un client

### Entrée

`/app/clients` (`src/app/app/clients/page.tsx`), item « Clients » de la sidebar
(`app-nav-config.ts:39`). Également atteignable depuis la conversation via
`?conversation=<id>` (`clients/page.tsx:25`).

### Étapes

1. Chargement `listActiveClientPayeurs` dans un `try/catch` ; échec → `ErrorState` compact
   sans action de réessai (`clients/page.tsx:57-63`).
2. Liste : `BusinessList` / `BusinessRow` avec `RowAvatar`, chaque ligne dépliable via
   `RowDetails` (`<details>` natif) contenant le formulaire d'édition et un bouton
   « Archiver ».
3. Panneau « Nouveau client » (`WorkspacePanel`) à droite, lui aussi replié dans un
   `RowDetails label="Ajouter un client"`.
4. Soumission → `createClientPayeurAction` (`src/app/actions/clients-creances.ts`).

### Points de décision

`conversationId` est transmis au formulaire (`clients/page.tsx:109`) — c'est le seul lien
entre la conversation d'origine et cette page.

### Frictions vérifiées

- **Le formulaire de création est masqué par défaut.** L'action principale de la page
  (« ajouter un client ») demande un clic sur un `<details>` avant d'être visible
  (`clients/page.tsx:105`). Contredit le principe produit n° 2 (« une action principale
  par écran ») et le pattern « CTA principal dans le header » de `SIDIAN_UI_PATTERNS.md`.
- **Aucun contexte de retour vers la conversation.** L'arrivée avec `?conversation=<id>`
  n'affiche ni bandeau, ni bouton « revenir à la discussion ». Le paramètre n'est utilisé
  que par l'action serveur.
- **Archivage sans confirmation.** `ArchiveButton` (`src/components/app/client-forms.tsx`)
  n'enveloppe pas l'action dans `ConfirmIrreversible`, alors que ce composant existe
  (`src/components/feedback/confirm-irreversible.tsx`) et est utilisé ailleurs
  (`cancel-receivable-button.tsx:27`).
- **Pas de recherche, pas de pagination.** Voir §« utilisateur avec beaucoup de dossiers »
  dans `FINAL_UX_AUDIT.md`.

### Sorties

Rechargement de la page avec la ligne créée. Aucun état de succès explicite au niveau de
la page ; le retour vient du formulaire.

---

## 4. Création d'une protection depuis la conversation

C'est le parcours central du produit (`docs/design/PRODUCT_PRINCIPLES.md` §1 et §8).

### Entrée

`/app/assistant` (`src/app/app/assistant/page.tsx`), qui est aussi la home produit
(`/app` redirige, `src/app/app/page.tsx:5`).

Trois amorces :
- saisie libre dans le composer ;
- pastille d'accueil « Créer une protection » (`ComposerShortcuts`, mode `welcome`) ;
- `?action=create_protection` (`assistant/page.tsx:229`), utilisé par le CTA de
  `/app/paiements` (`paiements/page.tsx:151`) et par l'entrée sidebar `onCreateProtection`
  (`conversational-workspace.tsx:4034`).

### Étapes

1. **État d'accueil** — `WelcomeState` (`src/components/assistant/welcome-state.tsx`) :
   eyebrow « Votre agent IA », `<h1>` de salutation, un paragraphe de situation, puis le
   composer et les raccourcis. Condition d'affichage `showWelcome`
   (`conversational-workspace.tsx`), conforme à `SIDIAN_CONVERSATIONAL_UX.md` §2.
2. **Envoi** — `handleSend` (`conversational-workspace.tsx` ~3050-3305). Deux chemins :
   `liveAgent` → `runConverse` (appel `/api/agent/tools`) ; sinon réponses déterministes
   locales (`buildDemoReplyFromParsedIntent`, `buildDemoProtectionReply`).
3. **Extraction progressive** — l'agent réclame les champs manquants tour par tour
   (client, montant, échéance). `parse-protection-intent.ts` pré-extrait côté client.
4. **Ouverture du panneau** — `shouldAutoOpenProtectionPanel`
   (`conversational-workspace.tsx:249`) ouvre `ProtectionPanel` quand le brouillon est
   complet. Modes `inline` (desktop), `overlay`, `sheet` (mobile) —
   `protection-panel.tsx:144-146`, avec `role="dialog"`, `aria-modal`, piège de focus et
   `Escape` pour les deux derniers modes.
5. **Confirmation** — action `confirm_protection` du dernier message
   (`message-thread.tsx:241`) ou CTA du panneau. Passe par
   `protection.draft.confirm` côté serveur.
6. **Après création** — raccourcis de phase « post-création » (`shortcuts.ts`), carte de
   message ouvrant `/app/paiements-a-recevoir/<id>` (`conversational-workspace.tsx:3455`).

### Points de décision

- `usesServerConversationPersistence` (`conversational-workspace.tsx:793`) : gouverne la
  persistance et désactive l'édition de message en production
  (`conversational-workspace.tsx:4174`).
- `permissionNotice` → rend `PermissionDenied` au-dessus du composer
  (`conversational-workspace.tsx:3926`).
- `canRetryConversationFailure` (`:578`) : décide si l'action « Réessayer » est proposée
  sur un message en erreur.

### Impasses vérifiées

**I-3 — Le brouillon confirmable ne survit pas à un rechargement.** Le contexte actif
(`workspace.activeContext`) est de l'état React ; en revenant sur la discussion, le
panneau de protection et l'action « Confirmer » ont disparu, alors que le brouillon existe
toujours côté serveur. Le seul chemin restant est de tout redemander à l'agent.

**I-4 — Session expirée : message sans issue.** `operationFailureCopy`
(`conversational-workspace.tsx:551`) affiche « Ta session a expiré. / Reconnecte-toi, puis
réessaie. » — sans lien vers `/connexion`, et sans forcer la reconnexion. L'utilisateur
doit deviner l'URL ou recharger.

**I-5 — Les pièces jointes ne persistent pas.** Un tour contenant une pièce jointe n'est
jamais persisté (constat P0 de `FINAL_TECHNICAL_AUDIT.md`, §Documents) : le message
utilisateur ET la réponse disparaissent au rechargement, laissant un trou dans une
transcription par ailleurs persistée.

**I-6 — L'accueil promet une capacité inexistante.** Les raccourcis d'accueil incluent
l'import/analyse de document alors que la réponse de l'agent elle-même annonce
« La lecture automatique des documents sera bientôt disponible »
(`src/components/assistant/document-attachments.ts:288`). Le parcours annoncé n'existe pas.

### Sorties

- Succès : créance créée, carte + raccourcis post-création, lien vers le dossier.
- Échec réseau : message d'erreur inline + bouton « Réessayer », brouillon conservé en
  mémoire, saisie restaurée dans le composer (`conversational-workspace.tsx:3270`).
- Refus de permission : bandeau `PermissionDenied`, conversation intacte.

---

## 5. Parcours du client payeur (`/p/*`)

Le seul parcours vu par un tiers non authentifié. Layout épinglé en clair :
`<div data-theme="light" className="contents">` (`src/app/p/layout.tsx:17`), métadonnées
`noindex, nofollow, nocache, referrer: no-referrer` (`p/layout.tsx:3-11`).

### Étapes

1. **`/p/<token>`** (`src/app/p/[token]/page.tsx`). Garde `isStripePaymentsEnabled()` →
   sinon `notFound()`. `resolvePaymentLinkForDisplay` renvoie `not_found`,
   `rate_limited`, ou les données. Affiche émetteur, libellé, référence, statut, montant
   total / déjà réglé / reste à régler, échéance, moyens disponibles, puis `PayButton`.
2. **`PayButton`** (`p/[token]/pay-button.tsx`) : `useActionState`, écrit le chemin de
   reprise en `sessionStorage`, redirige vers Stripe Checkout. États : `pending`
   (« Redirection… », `aria-busy`), messages d'échec typés par `reason`
   (`pay-button.tsx:16-29`).
3. **Retour** — `/p/retour` (`src/app/p/retour/page.tsx`). Le statut est **revérifié
   serveur** ; les query params Stripe ne sont jamais crus. Trois issues : `confirmed`,
   `not_confirmed`, autres états → `checkoutReturnPresentation` + `RecheckButton`.
4. **Abandon** — `/p/annule` (`src/app/p/annule/page.tsx`). Ne déduit aucun état
   financier ; `ResumePaymentLink` relit `sessionStorage` et propose « Reprendre le
   paiement », sinon un texte d'orientation.
5. **Autorisation (mandat)** — proposée après un règlement confirmé
   (`p/retour/authorization-proposal.tsx`), retour sur `/p/autorisation/retour`,
   annulation sur `/p/autorisation/annulation`.

### Frictions et incohérences vérifiées

**F-1 — Deux coquilles visuelles différentes dans le même parcours.**
`/p/<token>`, `/p/retour`, `/p/annule`, `/p/error`, `/p/not-found`, `/p/loading` utilisent
`PublicPaymentShell` (`src/app/p/public-payment-shell.tsx`) : lockup Sidian, carte
`rounded-2xl`, mention Stripe en pied. `/p/autorisation/retour` et
`/p/autorisation/annulation` redéfinissent une coquille locale
(`p/autorisation/retour/page.tsx:12-20`, `p/autorisation/annulation/page.tsx:5-9`) :
**pas de lockup, pas de mention de sécurité Stripe, `min-h-screen` au lieu de `min-h-dvh`,
padding différent**. Le client payeur change visuellement de site au milieu du parcours le
plus sensible.

**F-2 — Le CTA de paiement est sous le seuil AA.** `bg-sidian-blue text-white` =
**4,44:1** (seuil 4,5:1) — `pay-button.tsx:82`, `p/error.tsx:25`,
`p/annule/resume-payment-link.tsx:52`. Le bouton du design system utilise
`--ds-color-accent` (#315fd9, 5,57:1) et passerait. Détail dans `FINAL_UI_AUDIT.md`.

**F-3 — `/p/error` propose « Réessayer » sans jamais expliquer ce qui est réessayé** et
n'offre aucun moyen de contacter l'émetteur.

**F-4 — Aucun lien de retour** vers le lien de paiement depuis `/p/retour` en cas de
`not_confirmed` : le texte dit « depuis votre lien de paiement » sans le fournir, alors
que `/p/annule` sait le reconstruire depuis `sessionStorage`.

### Sorties

`confirmed` (avec proposition de mandat), `not_confirmed`, `processing` (revérifiable),
lien invalide (`/p/not-found`), rate-limit (écran « Merci de patienter »).

---

## 6. Connexion Stripe (Connect Express)

### Entrée

Aucune entrée de navigation directe. Trois chemins :
- `ConfigStatusList` sur `/app/parametres` → canal `stripe`
  (`src/lib/ux/config-status.ts:149`, `:162`, `:173`) ;
- `MissingConfigBanner` sur `/app/demarrage` (`demarrage/page.tsx:96`) — elle-même
  orpheline ;
- l'étape « stripe » de `buildOnboardingSteps` (`src/lib/onboarding/progress.ts:59`).

### Étapes

1. `/app/connexion-stripe` (`src/app/app/connexion-stripe/page.tsx`). Deux lectures dans
   des `try/catch` distincts : `getStripeConnectProductContext` (→ `activationContext`) et
   `getCurrentPrestataireStripeConnectView` (→ `view`, `null` en cas d'échec).
2. `StripeConnectPanel` (`src/components/app/stripe-connect-panel.tsx`) affiche l'état
   réel du compte, puis un bouton qui déclenche `beginStripeConnectAction`.
3. Redirection vers l'onboarding hébergé Stripe.
4. Retour : `/app/connexion-stripe/retour` → `redirect("/app/connexion-stripe?source=retour")`.
   Lien expiré : `/app/connexion-stripe/reprise` → `?source=reprise`
   (`create-account-link.ts:23-24`).
5. `readReturnContext` (`connexion-stripe/page.tsx:20`) traduit `source` en
   `returned` / `expired` pour le panneau.

### Points de décision

`activationContext` vaut `missing_receivable` tant qu'aucun compte connecté ni aucune
créance n'existe : le produit refuse d'activer Stripe « à vide ». C'est une décision
délibérée et cohérente avec `SIDIAN_02_PRD_V2.md` (Stripe au moment utile).

### Frictions vérifiées

- `loading.tsx` (`connexion-stripe/loading.tsx`) rend son propre `<main>` **hors de
  `AppShell`** : pendant le chargement, la navigation disparaît complètement, puis
  réapparaît. Rupture visuelle et perte de repère.
- Ce squelette est le seul de l'application authentifiée à ne pas utiliser `PageSkeleton`
  (`src/components/feedback/loading-state.tsx:68`).
- Le panneau utilise 11 utilitaires Tailwind bruts de statut (`bg-amber-50`,
  `text-emerald-700`…, `stripe-connect-panel.tsx:35-303`) qui ne basculent pas en sombre.

### Sorties

Compte prêt (`paiements_actives` + `sepa_debit` actif), partiellement configuré, ou en
échec — dans les trois cas l'utilisateur reste sur `/app/connexion-stripe`.

---

## 7. Changement d'apparence (thème)

### Entrée

`/app/parametres` → panneau « Apparence » (`src/app/app/parametres/page.tsx:47-52`).
Aucun raccourci ailleurs (pas d'interrupteur dans la sidebar ni dans le menu profil).

### Étapes

1. `AppearanceControl` (`src/components/theme/appearance-control.tsx`) : `<fieldset>` avec
   trois radios natifs — Clair / Sombre / Automatique. Le rôle `radiogroup` et la
   navigation aux flèches viennent du HTML natif, pas d'ARIA manuelle.
2. `setPreference` (`src/components/theme/theme-provider.tsx:137`) fait trois choses dans
   l'ordre : applique `data-theme` au document, écrit le cookie `sidian-theme`, appelle
   `onPersist` (server action) **sans attendre**.
3. Retour utilisateur : un `<p aria-live="polite">` annonce l'apparence appliquée
   (`appearance-control.tsx:56-62`).

### Résolution au premier rendu

- Serveur : `readThemePreferenceCookie()` → `resolveTheme(preference, false)` →
  `data-theme` sur `<html>` (`src/app/layout.tsx:32-35`).
- Avant peinture : `THEME_INIT_SCRIPT` (`src/lib/theme/theme-script.ts:29`) relit le
  cookie lui-même — seule façon de résoudre `system`, que le serveur ne connaît pas.
- Sans préférence : `light`, **sauf** sur `/connexion`, `/inscription`,
  `/mot-de-passe-oublie`, `/reinitialiser-mot-de-passe`, où le réglage OS est suivi
  (`theme.ts:53-63`).
- `/p/*` reste épinglé en clair quel que soit le thème racine (`p/layout.tsx:17` +
  bloc `[data-theme="light"]` de `src/design-system/tokens.css:20-21`).

### Points de décision

`preference === "system"` : `useSyncExternalStore` sur `matchMedia`
(`theme-provider.tsx:111`) suit le réglage OS en direct.

### Frictions vérifiées

- **La persistance compte est silencieuse.** `void onPersist?.(next)`
  (`theme-provider.tsx:145`) : si l'écriture en base échoue, l'utilisateur n'en saura rien
  et retrouvera l'ancien thème sur un autre appareil. Choix assumé (« un choix d'affichage
  ne doit jamais faire attendre », commentaire `appearance-control.tsx:21`), mais l'échec
  est totalement muet.
- **Le workspace Agent ne change pas.** `/app/assistant` force `appearance="agent-dark"`
  (`conversational-workspace.tsx:4007`). Un utilisateur qui choisit « Clair » voit un
  produit clair *sauf* sa page d'accueil. Aucune explication dans l'UI.
  Décision documentée dans `DESIGN_DECISIONS.md` §3.

### Sorties

Thème appliqué immédiatement au document, cookie écrit, compte mis à jour en arrière-plan.

---

## 8. Routes existantes sans point d'entrée en navigation

| Route | Atteignable depuis | Conséquence |
| --- | --- | --- |
| `/app/demarrage` | `ConfigStatusList` sur `/app/parametres`, uniquement si un canal email/WhatsApp n'est pas prêt | Invisible sur un compte correctement configuré |
| `/app/approbations` | `/app/activite`, **uniquement si `pendingApprovals > 0`** (`activite/page.tsx:41-48`) | L'historique des décisions est inaccessible dès qu'aucune décision n'est en attente |
| `/app/connexion-stripe` | Canal `stripe` de `ConfigStatusList`, `/app/demarrage` | Chaîne indirecte |
| `/app/parametres` | Menu profil de la sidebar + raccourci `⌘,` (`app-sidebar.tsx:371-392`) | OK |
| `/app/paiements-a-recevoir/<id>` | Lignes de `/app/paiements` uniquement (`paiements/page.tsx:209`) | Les lignes de `/app/paiements-a-recevoir` — la page « Dossiers » — **ne mènent pas** à la page de détail ; elles se déplient sur place |

**Divergence de navigation.** `APP_NAV` expose « Dossiers » → `/app/paiements-a-recevoir`
et « Paiements » → `/app/paiements` (`app-nav-config.ts:24-38`). Les deux pages lisent la
même donnée (`listActiveCreances`) avec trois vocabulaires : nav « Dossiers », titre de
page « Protections » (`paiements-a-recevoir/page.tsx:73`), titre de section « Toutes les
protections ». La distinction entre les deux entrées n'est jamais expliquée à
l'utilisateur.

---

## 9. Il n'existe aucune vue « mes échéances »

Cinq composants de tableau de bord (`dashboard-overview`, `dashboard-summary`,
`dashboard-actions`, `dashboard-deadlines`, `dashboard-portfolio`) n'étaient importés nulle
part ; ils ont été supprimés de l'arbre de travail pendant la rédaction de cet audit. Seul
`DashboardEvents` subsiste, utilisé par `/app/activite`.

Le constat de parcours demeure inchangé : les échéances du jour, le portefeuille et la
liste des actions à traiter sont **calculés** (`src/lib/dashboard/dashboard-model.ts`,
consommés par `src/app/app/assistant/page.tsx:88-223`) mais **jamais rendus sous forme de
liste actionnable**. Ils ne survivent que sous forme d'une phrase de synthèse dans
l'accueil de l'agent (« 2 échéances nécessitent votre attention »).

Un utilisateur ne peut donc pas répondre à la question « lesquelles ? » autrement qu'en
la posant à l'agent. C'est peut-être exactement l'intention produit
(`PRODUCT_PRINCIPLES.md` §1 et §7), mais ce n'est écrit nulle part et rien dans l'interface
ne l'indique : la phrase de synthèse n'est ni cliquable, ni accompagnée d'un raccourci.

**Décision humaine requise :** assumer explicitement « pas de vue liste, tout passe par la
conversation », ou rendre la synthèse actionnable. Ne pas trancher dans le code.
