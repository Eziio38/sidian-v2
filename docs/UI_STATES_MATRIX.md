# UI_STATES_MATRIX.md — Couverture réelle des états d'interface

**Statut :** table de preuves. Chaque cellule « implémenté » porte une référence
`fichier:ligne`. Une cellule sans référence n'est pas implémentée.
**Instantané :** `fa6dbf8` + arbre de travail au 3 août 2026, 21 h 03.


> **Volatilité des références.** Les numéros de ligne correspondent à l'instantané
> indiqué ; plusieurs fichiers de ce périmètre étaient modifiés en parallèle pendant la
> rédaction. Le chemin de fichier et le nom du symbole sont les ancres durables ;
> revérifier une ligne avant d'agir sur un constat isolé.

## Légende

| Marque | Signification |
| --- | --- |
| ✅ | Implémenté, référence fournie |
| ❌ | Absent alors que l'état est atteignable sur cet écran |
| — | Sans objet (l'état ne peut pas se produire sur cet écran) |
| ⚠️ | Implémenté mais dégradé — la note explique |

## Frontières Next.js disponibles (inventaire complet)

| Fichier | Portée |
| --- | --- |
| `src/app/app/loading.tsx` | Tout `/app/**` sauf `/app/connexion-stripe` |
| `src/app/app/connexion-stripe/loading.tsx` | `/app/connexion-stripe` uniquement |
| `src/app/app/error.tsx` | Tout `/app/**` |
| `src/app/app/not-found.tsx` | Tout `/app/**` |
| `src/app/p/loading.tsx` | Tout `/p/**` |
| `src/app/p/error.tsx` | Tout `/p/**` |
| `src/app/p/not-found.tsx` | Tout `/p/**` |

**Aucune** `error.tsx`, `loading.tsx`, `not-found.tsx` ni `global-error.tsx` ne couvre
`/`, `/connexion`, `/inscription`, `/mot-de-passe-oublie`, `/reinitialiser-mot-de-passe`.
Une exception rendue sur un écran d'authentification produit l'écran d'erreur par défaut de
Next, en anglais, hors coquille produit.

---

## 1. Espace authentifié — pages métier

### `/app/assistant` — workspace conversationnel (home produit)

| État | Statut | Preuve |
| --- | --- | --- |
| Chargement (route) | ✅ | `src/app/app/loading.tsx:4` → `PageSkeleton` |
| Squelette (contenu) | ⚠️ | `PageSkeleton` est plein écran et clair, alors que le workspace est sombre — rupture visuelle à chaque navigation vers l'accueil |
| Vide (accueil) | ✅ | `src/components/assistant/welcome-state.tsx:61-96`, condition `showWelcome` |
| Erreur (chargement serveur) | ✅ | `src/app/app/assistant/page.tsx:183-222` : `catch` → `dataState: "load_error"` + brief cards « À préciser » |
| Erreur (tour de conversation) | ✅ | `conversational-workspace.tsx:530-565` (`operationFailureCopy`) + `message-thread.tsx:155-159` |
| Succès | ✅ | Carte de message `MessageCard` + raccourcis post-création (`shortcuts.ts`) |
| Accès refusé | ✅ | `conversational-workspace.tsx:3926` → `PermissionDenied` |
| Aucun résultat | — | Pas de liste filtrable |
| Désactivé | ✅ | Composer : `disabled={isBlocked}` (`composer.tsx:551`) ; envoi : `disabled={!canSend}` (`composer.tsx:624`) |
| En traitement | ✅ | `GeneratingIndicator` (`conversational-workspace.tsx:4199`) ; `aria-busy` sur le message en streaming (`message-thread.tsx:98`) ; bouton Stop (`composer.tsx:605`) |
| Ressource supprimée | ⚠️ | Suppression d'une discussion : `WorkspaceConfirmDialog` (`conversational-workspace.tsx:4300`). Une conversation supprimée côté serveur mais dont le DELETE renvoie 404 laisse une ligne fantôme (constat P2 de `FINAL_TECHNICAL_AUDIT.md`) |
| Hors ligne | ✅ | `conversational-workspace.tsx:3925` → `OfflineBanner` |
| Session expirée | ⚠️ | Message texte `conversational-workspace.tsx:551-553` — **sans lien vers `/connexion`** et sans reconnexion forcée |

### `/app/clients`

| État | Statut | Preuve |
| --- | --- | --- |
| Chargement | ✅ | `src/app/app/loading.tsx:4` |
| Squelette | ✅ | `PageSkeleton` → `PageLoading` (`src/design-system/components/loading.tsx`) |
| Vide | ✅ | `clients/page.tsx:64-69` → `EmptyState` (`UX_COPY.emptyClients`) |
| Erreur | ⚠️ | `clients/page.tsx:57-63` → `ErrorState compact` **sans `onRetry` ni `action`** : cul-de-sac visuel |
| Succès | ✅ | `client-forms.tsx:106-111`, `role="status"` + `.sidian-live-region`, texte « Enregistré. » |
| Accès refusé | — | RLS : une donnée d'un autre compte n'est jamais listée |
| Aucun résultat | — | Aucun filtre, aucune recherche |
| Désactivé | ❌ | Aucun état désactivé sur cette page |
| En traitement | ✅ | `AuthSubmitButton` (`auth-submit-button.tsx:19`, `useFormStatus`) ; `ArchiveButton` `loading={pending}` (`client-forms.tsx:144`) |
| Ressource supprimée | ❌ | L'archivage est immédiat, **sans confirmation** (`client-forms.tsx:126-159` n'utilise pas `ConfirmIrreversible`) |
| Hors ligne | ❌ | `OfflineBanner` n'est monté que dans le workspace |
| Session expirée | ⚠️ | `requireConfirmedUser()` redirige vers `/connexion` sans message expliquant pourquoi |

### `/app/paiements`

| État | Statut | Preuve |
| --- | --- | --- |
| Chargement / squelette | ✅ | `src/app/app/loading.tsx:4` |
| Vide (aucune donnée) | ✅ | `paiements/page.tsx:188-197` → `EmptyState` + action « Créer un paiement » |
| Aucun résultat (filtre) | ✅ | `paiements/page.tsx:180-186` — distinction explicite `isNoResults` vs `!hasAnyCreance` (`:140-141`), avec retour « Voir tous les paiements ». **C'est la seule page qui distingue correctement ces deux états.** |
| Erreur | ⚠️ | `paiements/page.tsx:172-178` → `ErrorState compact` sans action |
| Succès | — | Page en lecture seule |
| Accès refusé | — | RLS |
| Désactivé | ❌ | — |
| En traitement | — | Aucune action mutante |
| Ressource supprimée | ✅ | Ligne → `/app/paiements-a-recevoir/<id>` → `notFound()` → `src/app/app/not-found.tsx` |
| Hors ligne | ❌ | — |
| Session expirée | ⚠️ | Redirection silencieuse |

### `/app/paiements-a-recevoir` (« Dossiers » / « Protections »)

| État | Statut | Preuve |
| --- | --- | --- |
| Chargement / squelette | ✅ | `src/app/app/loading.tsx:4` |
| Vide | ✅ | `paiements-a-recevoir/page.tsx:97-102` → `EmptyState` **sans action** (contrairement à `/app/paiements`) |
| Erreur | ⚠️ | `:90-96` → `ErrorState compact` sans action. De plus `getPrestataireStripeReadiness` (`:64`) est appelé **hors du `try/catch`** : son échec fait tomber toute la page sur la frontière d'erreur |
| Succès | ✅ | `creance-forms.tsx:199-203`, `role="status"` |
| Aucun résultat | — | Aucun filtre |
| Désactivé | ✅ | `canArchiveReceivable(creance.etat)` masque le bouton d'archivage (`:153`) — masquage, pas désactivation explicite |
| En traitement | ✅ | `ReceivablePaymentSection`, `PrepareLinkButton` (`pending`) |
| Ressource supprimée | — | Pas de navigation vers un détail depuis cette page |
| Hors ligne | ❌ | — |
| Session expirée | ⚠️ | Redirection silencieuse |

### `/app/paiements-a-recevoir/[id]` — détail

| État | Statut | Preuve |
| --- | --- | --- |
| Chargement / squelette | ✅ | `src/app/app/loading.tsx:4` |
| Vide (chronologie) | ✅ | `[id]/page.tsx:140-143` — paragraphe « Aucun événement de paiement n'est encore enregistré » (pas `EmptyState`, style local) |
| Erreur | ⚠️ | **Aucun `try/catch`** : `loadPaymentReceivableDetail` (`:75`) qui échoue tombe sur `src/app/app/error.tsx`, qui rend **hors `AppShell`** et perd toute la navigation |
| Succès | ✅ | `FollowUpControls` (`follow-up-controls.tsx:34`), `PaymentReconciliationButton`, `CancelReceivableButton` |
| Accès refusé | ✅ | `:80-82` → `notFound()`. Le message de `not-found.tsx:18` ne distingue pas « supprimé » de « appartient à un autre compte » — choix délibéré et documenté (`not-found.tsx:10-12`) |
| Ressource supprimée | ✅ | Même chemin |
| Désactivé | ✅ | Sections conditionnées à l'état (`:216`, `:230`, `:243`) — masquage plutôt que désactivation |
| En traitement | ✅ | `pending` sur les trois actions |
| Archivé | ✅ | `:209-214` — encart explicatif dédié |
| Hors ligne | ❌ | — |
| Session expirée | ⚠️ | Redirection silencieuse |

### `/app/activite`

| État | Statut | Preuve |
| --- | --- | --- |
| Chargement / squelette | ✅ | `src/app/app/loading.tsx:4` |
| Vide | ✅ | `activite/page.tsx:56-60` → `EmptyState` |
| Erreur | ⚠️ | `:50-55` → `ErrorState compact` sans action |
| Succès | — | Lecture seule |
| Aucun résultat | — | Aucun filtre |
| Débordement | ❌ | `dashboard-model.ts:585` : `events.slice(0, 8)`. **Aucune pagination, aucun « voir plus », aucune mention de la troncature** — l'utilisateur croit voir toute son activité |
| Hors ligne / session expirée | ❌ / ⚠️ | — |

**Branche morte :** `DashboardEvents` porte sa propre branche vide
(`dashboard-events.tsx:25-30`) qui ne peut jamais s'afficher, la page rendant déjà
`EmptyState` quand `events.length === 0` (`activite/page.tsx:56`). Deux textes vides
concurrents pour le même état, dont un inatteignable.

### `/app/approbations`

| État | Statut | Preuve |
| --- | --- | --- |
| Chargement / squelette | ✅ | `src/app/app/loading.tsx:4` |
| Vide | ✅ | `approbations/page.tsx:56-64` — bloc local, **n'utilise pas `EmptyState`** |
| Erreur | ⚠️ | `:50-54` — `<p role="alert">` avec `border-red-200 bg-red-50 text-red-700` en Tailwind brut : ne bascule pas en sombre, contourne `ErrorState`, aucune action |
| Succès / erreur d'action | ✅ | `approval-decision.tsx:46` — texte `text-emerald-700` / `text-red-600` (Tailwind brut) |
| En traitement | ✅ | `approval-decision.tsx` (`pending`) |
| Aucun résultat | — | Aucun filtre |
| Historique vide | ⚠️ | `:105` — la section « Historique » disparaît totalement si vide, sans le dire |
| Hors ligne / session expirée | ❌ / ⚠️ | — |

### `/app/parametres`

| État | Statut | Preuve |
| --- | --- | --- |
| Chargement / squelette | ✅ | `src/app/app/loading.tsx:4` |
| Vide | — | Toujours du contenu |
| Erreur | ❌ | **Aucun `try/catch`** autour de `getCurrentPrestataireProfile` / `getWorkspaceConfigStatus` (`parametres/page.tsx:21-24`) → frontière d'erreur, perte de navigation |
| Succès | ✅ | `ProfileForm` (`role="status"`) ; thème : `appearance-control.tsx:56` (`aria-live="polite"`) |
| État des canaux | ✅ | `ConfigStatusList` (`missing-config.tsx:54-106`), cinq états `ConfigProbeState` |
| En traitement | ✅ | `AuthSubmitButton` |
| Thème — échec de persistance | ❌ | `theme-provider.tsx:145` : `void onPersist?.(next)`, échec totalement muet |
| Hors ligne / session expirée | ❌ / ⚠️ | — |

### `/app/connexion-stripe`

| État | Statut | Preuve |
| --- | --- | --- |
| Chargement | ⚠️ | `connexion-stripe/loading.tsx` — **rend son propre `<main>` hors `AppShell`** : la navigation disparaît puis réapparaît. Seul squelette de l'app à ne pas utiliser `PageSkeleton` |
| Erreur (lecture Stripe) | ✅ | Deux `try/catch` séparés (`page.tsx:36-49`, `:55-67`) : `view = null` → le panneau rend son propre état dégradé |
| Vide / non activable | ✅ | `activationContext === "missing_receivable"` (`:41`) |
| Succès | ✅ | `stripe-connect-panel.tsx:96` (badge « prêt ») |
| Contexte de retour | ✅ | `readReturnContext` (`:20-26`) → `returned` / `expired` |
| En traitement | ✅ | `beginStripeConnectAction` / `refreshStripeConnectAction` (`pending`) |
| Hors ligne / session expirée | ❌ / ⚠️ | — |

### `/app/demarrage`

| État | Statut | Preuve |
| --- | --- | --- |
| Chargement / squelette | ✅ | `src/app/app/loading.tsx:4` |
| Progression | ✅ | `demarrage/page.tsx:80-92` — `role="progressbar"` avec `aria-valuenow` |
| Configuration manquante | ✅ | `:95-110` — `MissingConfigBanner` Stripe et plafond auto-débit |
| Succès | ✅ | `:99-106` — `StatusBanner tone="success"` |
| Désactivé | ✅ | `:139` — `DisabledHint` sur les étapes verrouillées |
| Erreur | ❌ | **Aucun `try/catch`** sur les cinq lectures parallèles (`:28-34`) |
| Hors ligne / session expirée | ❌ / ⚠️ | — |

### Frontières globales `/app/**`

| État | Statut | Preuve |
| --- | --- | --- |
| Erreur de segment | ⚠️ | `src/app/app/error.tsx` — `ErrorState` + `unstable_retry`, `<h1 class="sr-only">` (`:22`). **Rendu hors `AppShell`** : perte totale de la navigation ; `error.digest` est reçu puis jeté (`:15`), aucun report |
| 404 | ✅ | `src/app/app/not-found.tsx` — `EmptyState` + retour vers `/app/assistant`, dans un `<main>` (`:17`) |
| Chargement | ✅ | `src/app/app/loading.tsx:4` |

---

## 2. Espace public de paiement `/p/**`

### `/p/[token]`

| État | Statut | Preuve |
| --- | --- | --- |
| Chargement | ✅ | `src/app/p/loading.tsx` — squelette pulsé, `aria-busy`, texte `sr-only` (`:19`) |
| Payable | ✅ | `p/[token]/page.tsx:111-134` — moyens disponibles + `PayButton` |
| Non payable | ✅ | `:135-142` — `role="status"`, titre + description d'état |
| Rate-limité | ✅ | `:42-53` — écran dédié « Merci de patienter » |
| Lien invalide | ✅ | `notFound()` (`:38`) → `src/app/p/not-found.tsx` |
| Module paiement désactivé | ⚠️ | `:25-27` — `notFound()`, donc « lien indisponible » : diagnostic **faux** pour le payeur, la cause étant une configuration côté Sidian |
| En traitement | ✅ | `pay-button.tsx:76-81` — `disabled`, `aria-disabled`, `aria-busy`, libellé « Redirection… » |
| Erreur d'action | ✅ | `pay-button.tsx:83-87` — `role="alert"`, messages typés par `reason` (`:16-29`) |
| Erreur serveur | ✅ | `src/app/p/error.tsx` — `unstable_retry` |
| Devise non EUR | ✅ | `:86` — les montants sont masqués plutôt que mal formatés |
| Hors ligne | ❌ | Aucun `OfflineBanner` sur le parcours public |
| Session expirée | — | Pas de session |

### `/p/retour`, `/p/annule`

| État | Statut | Preuve |
| --- | --- | --- |
| Confirmé | ✅ | `p/retour/page.tsx:77-90` |
| Non confirmé | ⚠️ | `:92-104` — dit « depuis votre lien de paiement » **sans fournir le lien**, alors que `/p/annule` sait le reconstruire |
| En cours de vérification | ✅ | `:106-121` — `checkoutReturnPresentation` + `RecheckButton` |
| Abandon | ✅ | `p/annule/page.tsx` + `ResumePaymentLink` (`resume-payment-link.tsx:34-41` couvre l'absence de chemin de reprise) |
| Proposition de mandat | ✅ | `p/retour/authorization-proposal.tsx` |

### `/p/autorisation/retour`, `/p/autorisation/annulation`

| État | Statut | Preuve |
| --- | --- | --- |
| Paramètres manquants | ✅ | `p/autorisation/retour/page.tsx:36-47` |
| Active | ✅ | `:68-81` |
| Refusée / expirée / révoquée | ✅ | `:83-97` |
| En cours de configuration | ✅ | `:99-113` + `RecheckAuthorizationButton` |
| Vérification impossible | ✅ | `:115-126` |
| Cohérence de coquille | ❌ | Ces deux routes redéfinissent un `Shell` local (`:12-20`) au lieu de `PublicPaymentShell` : **pas de lockup Sidian, pas de mention de sécurité Stripe** |

---

## 3. Écrans d'authentification

| Écran | Chargement | Vide | Erreur | Succès | En traitement | Session expirée |
| --- | --- | --- | --- | --- | --- | --- |
| `/connexion` | ❌ | — | ⚠️ `connexion/page.tsx:46` via `?erreur=` → `AuthBanner` | ✅ `?message=mot-de-passe-mis-a-jour` (`:47`) | ✅ `AuthSubmitButton` | ✅ `?erreur=session` → `AUTH_MESSAGES.sessionExpired` |
| `/inscription` | ❌ | — | ✅ `AuthBanner` + `fieldErrors` (`sign-up-form.tsx:20`) | ✅ redirection vers `/inscription/verifier-email` | ✅ `pendingLabel="Création du compte…"` | — |
| `/inscription/verifier-email` | — | — | — | — | — | **impasse** : ni déconnexion ni renvoi d'email |
| `/mot-de-passe-oublie` | ❌ | — | ✅ `AuthBanner` | ⚠️ annonce « email envoyé » même quand rien n'est parti (constat P1 de `FINAL_TECHNICAL_AUDIT.md`) | ✅ | — |
| `/reinitialiser-mot-de-passe` | ❌ | — | ✅ `AuthBanner` | ✅ redirection `/connexion?message=…` | ✅ | ✅ `auth.ts:216` |

**Trous transverses aux écrans d'auth :** aucune `error.tsx`, aucune `loading.tsx`, aucun
`OfflineBanner`, et **aucune persistance des saisies** en cas d'erreur de validation
(aucun `defaultValue` dans `sign-up-form.tsx` / `sign-in-form.tsx`).

---

## 4. Écran racine `/`

| État | Statut | Preuve |
| --- | --- | --- |
| Contenu | ⚠️ | `src/app/page.tsx` — carte « Socle technique », version et environnement. Aucun lien vers le produit |
| Tous les autres états | — | Page statique |

---

## 5. Primitives d'état disponibles vs réellement utilisées

`src/components/feedback/index.ts` exporte 15 primitives. Usage vérifié sur tout `src` :

| Primitive | Utilisations hors `feedback/` | Note |
| --- | --- | --- |
| `EmptyState` | 6 (clients, activite, paiements ×2, paiements-a-recevoir, not-found, dev/workspace) | — |
| `ErrorState` | 6 | Toujours **sans** action de réessai sauf `app/error.tsx` |
| `PageSkeleton` | 1 (`app/loading.tsx`) | — |
| `GeneratingIndicator` | 1 (workspace) | — |
| `OfflineBanner` | 1 (workspace) | **Aucune page métier ne gère le hors-ligne** |
| `PermissionDenied` | 1 (workspace) | Idem |
| `StatusBanner` | 1 (`demarrage`) | Aussi via `MissingConfigBanner`, `SuccessState`, `InProgressState`, `PermissionDenied`, `OfflineBanner` |
| `MissingConfigBanner` | 2 (`demarrage`) | — |
| `ConfigStatusList` | 1 (`parametres`) | — |
| `DisabledHint` | 1 (`demarrage`) | — |
| `ConfirmIrreversible` | 1 (`cancel-receivable-button.tsx:27`) | **Pas utilisé pour l'archivage client ni créance** |
| `LoadingState` | 0 | Uniquement via `InProgressState compact` |
| `Skeleton` | 0 | — |
| `SuccessState` | 0 | — |
| `InProgressState` | 0 | — |
| `protection-notices` (`AutoDebitCeilingNotice`, `IncompleteProtectionNotice`) | 0 | — |

**Six primitives sur quinze ne sont utilisées nulle part.** Le système d'états existe et
est cohérent ; il n'est simplement pas branché.

---

## 6. Défauts systémiques révélés par la matrice

1. **`ErrorState` est systématiquement un cul-de-sac.** Six occurrences, aucune ne passe
   `onRetry` ni `action` (sauf `app/error.tsx`). L'utilisateur voit « Réessaie dans
   quelques secondes » sans bouton pour réessayer.
2. **Le hors-ligne n'existe que dans le workspace.** Huit pages métier mutantes (clients,
   dossiers, détail, approbations, paramètres, Stripe) laissent partir des soumissions qui
   échoueront sans avertissement.
3. **Quatre pages n'ont aucun `try/catch`** (`parametres`, `demarrage`,
   `paiements-a-recevoir/[id]`, plus `getPrestataireStripeReadiness` hors garde sur
   `paiements-a-recevoir`) : toute panne de lecture éjecte l'utilisateur hors de la
   coquille produit.
4. **La session expirée est toujours une redirection muette.** Aucune page n'explique
   pourquoi l'utilisateur se retrouve sur `/connexion` ; le seul message existe sur
   `/connexion?erreur=session` et n'est pas déclenché par les gardes de page.
5. **« Vide » et « aucun résultat » ne sont distingués que sur `/app/paiements`.**
6. **Le workspace hérite d'un squelette clair** alors qu'il est sombre : rupture visible à
   chaque navigation vers l'accueil.
