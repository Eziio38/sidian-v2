# FINAL_UX_AUDIT.md — Revue adverse par persona

**Méthode :** parcourir le produit tel qu'il est écrit, du point de vue de huit profils
d'usage. Chaque constat est vérifié dans le code et porte une référence. Aucun constat
n'est déduit d'une intention supposée.
**Instantané :** `fa6dbf8` + arbre de travail au 3 août 2026, 21 h 03.
**Documents liés :** `UX_FLOWS.md` (parcours), `UI_STATES_MATRIX.md` (couverture d'états),
`FINAL_UI_AUDIT.md` (système visuel), `FINAL_TECHNICAL_AUDIT.md` (dette technique).


> **Volatilité des références.** Les numéros de ligne correspondent à l'instantané
> indiqué ; plusieurs fichiers de ce périmètre étaient modifiés en parallèle pendant la
> rédaction. Le chemin de fichier et le nom du symbole sont les ancres durables ;
> revérifier une ligne avant d'agir sur un constat isolé.

## Échelle de priorité

| Niveau | Définition retenue |
| --- | --- |
| **P0** | L'utilisateur ne peut pas accomplir la tâche, ou est induit en erreur sur un fait financier ou juridique |
| **P1** | L'utilisateur accomplit la tâche mais au prix d'un blocage, d'un doute ou d'un travail inutile significatif |
| **P2** | Friction, incohérence ou perte de qualité perçue |

---

## Persona 1 — LE NOUVEL UTILISATEUR

*Il vient de recevoir un lien, il n'a jamais vu Sidian.*

### P0-1 — La racine du domaine ne mène nulle part

`src/app/page.tsx` affiche « Socle technique / Sidian V2 / Version 0.1.0 / Environnement ».
Aucun lien vers `/connexion` ni `/inscription`. Le seul moyen d'entrer dans le produit est
de connaître l'URL exacte. Le lockup de marque des écrans d'auth
(`src/components/auth/auth-shell.tsx:22`) renvoie précisément vers cette page technique :
cliquer sur le logo depuis l'écran de connexion **fait sortir du produit**.

*Impact :* impasse absolue pour un visiteur non guidé.

### P0-2 — Le consentement porte sur des documents inexistants

`sign-up-form.tsx:82` et `:94` rendent « conditions générales d'utilisation » et
« politique de confidentialité » comme des `<span>`, pas des liens. Aucune route
correspondante n'existe. L'utilisateur est obligé de cocher deux cases pour un contenu
qu'il ne peut pas lire.

*Impact :* consentement non opposable, et un utilisateur attentif refusera de continuer.

### P1-1 — Une faute de frappe coûte six champs

Aucun `defaultValue` dans `sign-up-form.tsx` : à la moindre erreur de validation serveur,
nom, agence, email, mot de passe, confirmation et les deux cases sont vidés. Le formulaire
est `noValidate` (`:19`), donc toute la validation est serveur — l'aller-retour est
systématique.

### P1-2 — L'écran « Confirmez votre email » est un cul-de-sac

`src/app/inscription/verifier-email/page.tsx` : aucun bouton « renvoyer l'email », aucune
déconnexion. Son seul lien renvoie vers `/connexion`, qui (session ouverte)
`redirectIfAuthenticated` → `/app` → `/app/assistant` → `requireConfirmedUser` →
retour ici. Boucle fermée : sans vider ses cookies, l'utilisateur ne peut plus rien faire.

### P1-3 — Le premier écran promet une capacité qui n'existe pas

L'accueil de l'agent propose d'importer et d'analyser une facture. La réponse de l'agent
lui-même est « La lecture automatique des documents sera bientôt disponible »
(`src/components/assistant/document-attachments.ts:288`), et le tour contenant une pièce
jointe n'est jamais persisté : au rechargement, la question et la réponse ont disparu.

*Impact :* le premier essai d'un nouvel utilisateur échoue silencieusement.

### P1-4 — Deux onboardings contradictoires

Le bloc « Bien démarrer » de la sidebar propose **3** étapes (client, facture, dossier),
sans Stripe (`src/components/app/app-sidebar.tsx:194-218`). La page `/app/demarrage` en
propose **4**, dont Stripe (`src/lib/onboarding/progress.ts`). Un utilisateur qui atteint
3/3 dans la sidebar croit avoir terminé et ne peut encaisser aucun paiement. La page à
4 étapes est par ailleurs **injoignable** depuis la navigation (`APP_NAV` ne la contient
pas ; « Bien démarrer » est listé dans `LEGACY_NAV_LABELS`, `app-nav-config.ts:57`).

### P2-1 — L'agent tutoie et vouvoie sur le même écran

Sur `/app/assistant` :
- accueil, vouvoiement — « Votre attention est requise. »
  (`welcome-summary.ts:59`), « Sidian continue de surveiller **vos** échéances » (`:117`),
  eyebrow « **Votre** agent IA » (`welcome-state.tsx:68`) ;
- erreurs et raccourcis, tutoiement — « **Ta** session a expiré »
  (`conversational-workspace.tsx:551`), « **Ton** message est conservé » (`:540`),
  « Importe **ta** facture » (`:3382`).

Le fichier de microcopie déclare pourtant une règle explicite :
« tutoiement, ton humain » (`src/lib/ux/microcopy.ts:2`). Elle est respectée sur les pages
métier et violée sur la surface d'entrée du produit.

### P2-2 — L'onboarding de la sidebar est masquable définitivement, sans retour

`app-sidebar.tsx:394-401` écrit un drapeau `localStorage`. Aucun moyen de réafficher le
bloc depuis les paramètres.

---

## Persona 2 — L'UTILISATEUR RÉGULIER

*Il revient tous les jours, il connaît le produit.*

### P0-3 — Un brouillon de protection ne survit pas à un rechargement

Le contexte actif (`workspace.activeContext`) n'est que de l'état React. Après un
rechargement ou un changement de discussion, le `ProtectionPanel` et l'action
« Confirmer » disparaissent, alors que le brouillon existe toujours côté serveur. Le seul
recours est de tout redemander à l'agent.

*Impact :* le geste central du produit n'est pas reprenable. Pour un utilisateur qui
travaille en plusieurs fois, c'est bloquant.

### P1-5 — Il n'existe aucune vue « mes échéances »

`loadDashboard` calcule les échéances du jour, le portefeuille et les actions à traiter
(`src/lib/dashboard/dashboard-model.ts`, consommé par
`src/app/app/assistant/page.tsx:88-223`). Rien n'est rendu sous forme de liste : les cinq
composants de tableau de bord qui l'auraient permis n'étaient importés nulle part et
viennent d'être supprimés. L'information survit uniquement dans une phrase
(« 2 échéances nécessitent votre attention »), qui n'est **ni cliquable, ni assortie d'un
raccourci**.

*Impact :* la question quotidienne « lesquelles ? » n'a pas de réponse dans l'interface.

### P1-6 — Deux entrées de navigation pour la même donnée, trois vocabulaires

`APP_NAV` (`app-nav-config.ts:24-38`) expose « Dossiers » → `/app/paiements-a-recevoir` et
« Paiements » → `/app/paiements`. Les deux appellent `listActiveCreances`. Le titre de la
première page est « Protections » (`paiements-a-recevoir/page.tsx:73`), sa section
« Toutes les protections », l'entrée de nav « Dossiers ». Trois mots pour un objet.

Pire pour l'usage : **les lignes de « Dossiers » ne mènent pas à la page de détail** — elles
se déplient sur place (`RowDetails`), alors que celles de « Paiements » ouvrent
`/app/paiements-a-recevoir/<id>` (`paiements/page.tsx:209`). Le même objet a deux
comportements de clic selon la page où on le rencontre.

### P1-7 — L'historique des approbations est inaccessible dès qu'il est à jour

`/app/approbations` n'est atteignable que par le CTA de `/app/activite`, affiché
**uniquement si `pendingApprovals > 0`** (`activite/page.tsx:41-48`). Dès que toutes les
décisions sont prises, la page et son historique disparaissent de la navigation.

### P2-3 — « Gérer mon abonnement » ne mène à aucune gestion d'abonnement

`app-sidebar.tsx:880-895` : l'entrée pointe vers `/app/parametres`, qui ne contient aucune
section abonnement (`parametres/page.tsx` : profil, apparence, canaux, adresse du compte).

### P2-4 — Les retours de l'agent (👍/👎 + commentaire) sont collectés puis jetés

`MessageHoverActions` propose un panneau de retour complet ; aucun backend n'existe
(constat P1 de `FINAL_TECHNICAL_AUDIT.md`). L'utilisateur régulier investit du temps dans
un signal qui n'arrive nulle part.

### P2-5 — La page Activité tronque à 8 sans le dire

`dashboard-model.ts:585` : `events.slice(0, 8)`. Aucune pagination, aucun « voir plus »,
aucune mention. Un utilisateur régulier croit voir toute son activité.

---

## Persona 3 — L'UTILISATEUR PRESSÉ

*Il a trente secondes entre deux rendez-vous.*

### P1-8 — L'action principale des pages métier est repliée

Sur `/app/clients`, le formulaire de création est enfermé dans un `<details>`
(`clients/page.tsx:105`). Sur `/app/paiements-a-recevoir`, idem (`:172`). Un clic
supplémentaire, sans bénéfice, sur l'action que la page annonce dans son propre titre de
panneau (« Nouveau client », « Préparer manuellement »).

Cela contredit `PRODUCT_PRINCIPLES.md` §2 (« une action principale par écran ») et le
pattern « CTA principal dans le header, aligné top-right » de `SIDIAN_UI_PATTERNS.md`.

### P1-9 — Le toast disparaît en 5,2 s, sans pause ni rappel

`workspace-toast.tsx:22-28` : `setTimeout` fixe, aucune suspension au survol ou au focus,
aucun historique. Un utilisateur qui détourne le regard perd l'information définitivement
(limite de fichiers atteinte, échec d'organisation de conversation…). WCAG 2.2.1.

### P1-10 — Aucune page métier ne dit qu'on est hors ligne

`OfflineBanner` n'est monté que dans le workspace (`conversational-workspace.tsx:3925`).
Sur `/app/clients`, `/app/paiements-a-recevoir`, `/app/approbations`, `/app/parametres`,
`/app/connexion-stripe`, un utilisateur pressé dans un train soumet un formulaire qui
échouera sans avertissement préalable.

### P1-11 — « Réessaie dans quelques secondes » sans bouton pour réessayer

Six occurrences d'`ErrorState` sur les pages métier
(`clients:57`, `activite:50`, `paiements:172`, `paiements-a-recevoir:90`,
`dev/workspace:148`), **aucune** ne passe `onRetry` ni `action`. Le composant sait pourtant
le faire (`error-state.tsx:29-36`). Le seul recours est de recharger la page à la main.

### P2-6 — Le squelette de chargement du workspace est clair alors que le workspace est sombre

`src/app/app/loading.tsx:4` rend `PageSkeleton` (surfaces claires) avant
`/app/assistant`, qui est verrouillé en sombre. Flash clair systématique à chaque
navigation vers la home produit.

### P2-7 — `/app/connexion-stripe` perd la navigation pendant son chargement

`connexion-stripe/loading.tsx` rend son propre `<main>` hors `AppShell` : la sidebar
disparaît puis réapparaît. Seul squelette de l'application à ne pas utiliser `PageSkeleton`.

---

## Persona 4 — L'UTILISATEUR NON TECHNIQUE

*Freelance ou petite agence. Il ne sait pas ce qu'est un webhook.*

Le vocabulaire produit est globalement bien tenu : `microcopy.ts:3-4` interdit
explicitement « créance, débiteur, RPC, webhook, provider, outbox, idempotence, tenant,
reconciliation, status code », et cette règle est respectée dans les libellés d'interface.
Les états d'enum sont traduits (`paiements/page.tsx:49-57` :
`PARTIELLEMENT_REGLEE` → « Partiellement réglé »).

### P1-12 — « Vérification Stripe » et « réconciliation » percent quand même

`paiements-a-recevoir/[id]/page.tsx:218-222` : titre « Vérification Stripe » suivi de
« Sidian relit les objets Stripe dans votre compte connecté. Un écart ambigu reste sans
effet et demande un examen humain. » Deux notions techniques (« objets Stripe », « écart
ambigu ») et aucune indication de ce que l'utilisateur doit en faire.

### P1-13 — « Ta session a expiré » sans chemin de sortie

`conversational-workspace.tsx:551-553` affiche le diagnostic mais aucun lien vers
`/connexion`, et ne force pas la reconnexion. Un utilisateur non technique ne sait pas
qu'il doit recharger ou naviguer à la main.

### P1-14 — Le module de paiement désactivé se présente comme un lien invalide

`src/app/p/[token]/page.tsx:25-27` : si `isStripePaymentsEnabled()` est faux, `notFound()`
— donc « Lien de paiement indisponible / Ce lien est incorrect, a été révoqué ou n'est plus
valable » (`p/not-found.tsx`). Le client payeur reçoit un diagnostic **faux** : la cause est
une configuration côté Sidian. Il appellera le prestataire, qui n'aura aucun moyen de
comprendre.

### P2-8 — « Dossiers », « Protections », « Paiements à recevoir », « Créance »

Quatre mots circulent pour un même objet selon l'écran (nav, titre de page, section,
libellé d'archivage). Aucun glossaire dans l'interface.

### P2-9 — Le choix d'apparence n'explique pas pourquoi l'accueil reste sombre

`/app/parametres` propose Clair / Sombre / Automatique et annonce « Le thème clair est la
référence de Sidian » (`parametres/page.tsx:49`). Un utilisateur qui choisit « Clair »
voit tout le produit en clair **sauf** sa page d'accueil, qui force `agent-dark`
(`conversational-workspace.tsx:4007`). Rien ne le prévient.

### P2-10 — L'archivage est irréversible sans confirmation

`ArchiveButton` (`client-forms.tsx:126-159`) déclenche l'action au premier clic.
`ConfirmIrreversible` existe et est utilisé ailleurs (`cancel-receivable-button.tsx:27`).

---

## Persona 5 — L'UTILISATEUR MOBILE

*iPhone, une main, dans le métro.*

Beaucoup de choses sont faites correctement : tiroir de navigation avec `inert`,
verrouillage du scroll et restitution du focus (`app-shell.tsx:128-149`), piège de focus et
`Escape` dans la sidebar (`app-sidebar.tsx:294-327`), panneau protection en `sheet` avec
`role="dialog"` + `aria-modal` (`protection-panel.tsx:144-146`), décalage clavier via
`--assistant-keyboard-offset` (`conversational-workspace.tsx:4227`), helpers
`sidian-safe-pb` / `sidian-safe-pt` (`globals.css:465-471`), et
`enterKeyHint="send"` sur le composer (`composer.tsx:554`).

### P1-15 — Cibles tactiles à 28 px sur les actions de message

`message-hover-actions.module.css:79-83` et `:149-153` : 28 × 28 px pour copier, noter,
réessayer, fermer. Ce sont des actions *hover* portées sur un appareil sans survol. La
classe `.sidian-touch-target` (44 px, `globals.css:459-462`) existe et n'est pas appliquée.
Autres cas : `app-sidebar.module.css:562` (30 px), `:757` (34 px),
`composer-shortcuts.module.css:63` (32 px).

### P1-16 — Le composer reste focusable sous la feuille mobile

`conversational-workspace.tsx:4224` pose `aria-hidden` sur le dock quand la feuille de
protection est ouverte, mais le CSS ne fait que `pointer-events: none`
(`conversational-workspace.module.css:193-195`). Au clavier logiciel ou avec VoiceOver, le
textarea et les boutons du composer restent atteignables **dans un sous-arbre déclaré
caché**. Le shell résout exactement ce cas deux niveaux plus haut avec `inert`
(`app-shell.tsx:131-132`).

### P2-11 — Les listes métier ne sont pas repensées pour le mobile

`WorkspaceSplit` (`workspace-blocks.module.css:6-11`) est une grille
`minmax(0,1fr) var(--ds-layout-rail-width)` **sans media query** : le panneau
« Nouveau client » reste une colonne de 280 px sur tous les écrans. Le rail droit devait
« passer sous le contenu ou disparaître » sur mobile
(`SIDIAN_UI_PATTERNS.md` §Responsive).

### P2-12 — Le tableau de bord de la sidebar occupe la hauteur utile

Sur mobile, le tiroir contient nav + projets + jusqu'à 48 discussions + onboarding +
profil, sans regroupement replié par défaut ni recherche.

---

## Persona 6 — L'UTILISATEUR AU CLAVIER UNIQUEMENT

### P0-4 — Le lien d'évitement est placé après ce qu'il permet d'éviter

`app-shell.tsx` rend `<AppSidebar>` (ligne 171) **avant** le conteneur qui porte le lien
d'évitement (ligne 198, lien ligne 204). Sur desktop la sidebar n'est jamais `inert`
(`app-sidebar.tsx:157` : `mobileDrawerClosed = !isLg && !mobileOpen`, donc faux sur
desktop). Le premier `Tab` d'une page entre donc dans la navigation, pas dans le lien
d'évitement.

Coût mesuré sur `/app/assistant` avec 20 discussions : 5 liens de nav + « Demander à
Sidian » + « Nouveau projet » + 2 arrêts par discussion (sélection + suppression) + les
étapes d'onboarding + le déclencheur de profil ≈ **plus de cinquante tabulations** avant
d'atteindre le lien censé permettre de les sauter.

*Impact :* le seul dispositif d'évitement du produit est inopérant. P0 d'accessibilité.

### P1-17 — L'anneau de focus n'atteint pas 3:1

`--ds-color-focus-ring` composité donne **1,89:1** en clair et **2,77:1** en sombre
(calcul détaillé dans `FINAL_UI_AUDIT.md` §2). WCAG 1.4.11 / 2.4.11 exigent 3:1. Cela
touche tous les contrôles : `button.module.css:24-27`, `field.module.css:61-65`,
`workspace-blocks.module.css:67`.

### P1-18 — Aucune restitution de focus après une action serveur sur les pages métier

Les formulaires (`client-forms.tsx`, `creance-forms.tsx`) affichent un `role="status"` mais
ne repositionnent pas le focus. Sur `/app/clients`, la soumission remonte la page
(`key={formEpoch}` remonte le formulaire, `client-forms.tsx:61`) et le focus retombe sur
`<body>`.

### P2-13 — `Escape` ne ferme rien sur les pages métier

Le `<details>` de `RowDetails` reste ouvert ; `ConfirmIrreversible` gère désormais
`Escape` (corrigé pendant cet audit) mais rien d'autre.

### P2-14 — Le fil de conversation est un `role="log"` non borné

`message-thread.tsx:63-65` déclare `role="log" aria-live="polite"` sur le conteneur de
**tous** les messages, sans virtualisation ni bornage.

### P2-15 — Les messages n'ont pas d'auteur accessible

`message-thread.tsx:93-104` ne distingue utilisateur et agent que par `data-role` et par le
style. Aucun libellé, même `sr-only`. `SIDIAN_CONVERSATIONAL_UX.md` §9 prévoyait des
« noms message 12 px / 600 » ; ils ont disparu de l'implémentation.

### Corrigés pendant cet audit

- `<main>` sur la route workspace (`app-shell.tsx:229`) ;
- `SuggestionDatePicker` : `role="grid"`, tabindex itinérant, navigation aux flèches ;
- `ConfirmIrreversible` : entrée/restitution de focus, `Escape`, piège de focus ;
- `<h1 class="sr-only">` sur `src/app/app/error.tsx:27`.

---

## Persona 7 — L'UTILISATEUR AVEC BEAUCOUP D'ENREGISTREMENTS

*300 clients, 800 paiements, deux ans d'historique.*

### P0-5 — L'agent ne connaît que 50 clients

`src/app/app/assistant/page.tsx:288-303` charge `client_payeur` avec
`.order("created_at", { ascending: false }).limit(50)` et passe le résultat à
`initialKnownClients`. Au-delà, l'agent **ne reconnaîtra pas** un client existant et
proposera d'en créer un doublon. Aucun avertissement, aucune recherche de repli.

*Impact :* création silencieuse de doublons sur les comptes les plus fournis — ceux qui ont
le plus de valeur.

### P0-6 — Les listes métier sont non bornées et non paginées

`listActiveClientPayeurs` (`src/lib/clients/client-payeur-core.ts:19-23`) et
`listActiveCreances` n'ont **aucun `limit`**. `/app/clients`, `/app/paiements` et
`/app/paiements-a-recevoir` rendent la totalité de la table, sans pagination, sans
recherche, sans tri, sans filtre (sauf les quatre filtres d'état de `/app/paiements`).
`/app/paiements-a-recevoir` monte en plus un formulaire complet par ligne
(`page.tsx:126-160`).

*Impact :* poids de page et temps de rendu croissant linéairement, et impossibilité
pratique de retrouver une ligne.

### P1-19 — L'historique de discussions est plafonné à 48, silencieusement

`src/lib/assistant-conversations/service.ts:16` (`MAX_HISTORY_ITEMS = 48`), `:43`. Aucune
pagination, aucun « charger plus », aucune recherche. La 49ᵉ discussion la plus ancienne
devient inaccessible.

### P1-20 — Un fil est plafonné à 600 messages, silencieusement

`service.ts:17` (`MAX_HISTORY_MESSAGES = 600`), `:72`. Au-delà, le début de la conversation
disparaît sans mention.

### P1-21 — L'activité est plafonnée à 8

`dashboard-model.ts:585`. Voir P2-5.

### P2-16 — Aucune recherche nulle part

Ni sur les clients, ni sur les paiements, ni sur les dossiers, ni sur l'historique de
discussions. `SIDIAN_UI_PATTERNS.md` prévoit pourtant une toolbar de recherche fixe
(« Searchbox width : 260-320px ») et le token `--ds-layout-search-width` existe — il est
l'un des deux seuls tokens `--ds-*` totalement morts du système.

---

## Persona 8 — L'UTILISATEUR QUI RENCONTRE UNE ERREUR

### P0-7 — Quatre écrans n'ont aucune protection contre une panne de lecture

- `/app/parametres` : `getCurrentPrestataireProfile` et `getWorkspaceConfigStatus`
  (`parametres/page.tsx:21-24`), aucun `try/catch` ;
- `/app/demarrage` : cinq lectures parallèles (`demarrage/page.tsx:28-34`), aucune garde ;
- `/app/paiements-a-recevoir/[id]` : `loadPaymentReceivableDetail` (`:75`), aucune garde ;
- `/app/paiements-a-recevoir` : `getPrestataireStripeReadiness` est appelé **hors** du
  `try/catch` qui protège le reste (`page.tsx:64`).

Toute panne éjecte sur `src/app/app/error.tsx`, qui est rendu **hors `AppShell`** : plus de
sidebar, plus de navigation. Le seul chemin restant est « Réessayer », qui rejoue la même
requête.

### P0-8 — Aucune frontière d'erreur ne couvre les écrans d'authentification

Inventaire complet des frontières : `app/app/{error,loading,not-found}.tsx`,
`app/app/connexion-stripe/loading.tsx`, `app/p/{error,loading,not-found}.tsx`. **Rien**
pour `/`, `/connexion`, `/inscription`, `/mot-de-passe-oublie`,
`/reinitialiser-mot-de-passe`, et aucun `global-error.tsx`. Une exception sur l'écran de
connexion produit l'écran d'erreur par défaut de Next, en anglais, hors marque.

### P1-22 — L'erreur `/app` perd toute la navigation et n'enregistre rien

`src/app/app/error.tsx` reçoit `error.digest` (`:15`) et le jette. Aucun report, aucun
identifiant affiché à l'utilisateur pour le support. Le `<h1 class="sr-only">` a été ajouté
pendant cet audit, mais la page reste hors coquille.

### P1-23 — Une erreur d'approbation est rendue en rouge Tailwind brut

`approbations/page.tsx:51` : `<p role="alert" class="border-red-200 bg-red-50 text-red-700">`.
Ne bascule pas en sombre (texte rouge sur fond rouge clair sur un fond d'application
sombre), contourne `ErrorState`, n'offre aucune action.

### P1-24 — Un avertissement s'affiche avec la surface d'une information

`StatusBanner` mappe `tone: "warning"` sur `CardVariant: "info"`
(`status-banner.tsx:33`), faute de variante `.warning` dans `card.module.css`. Hors ligne,
permission refusée et plafond de prélèvement non validé s'affichent donc sur une **surface
bleue d'information** avec un badge orange.

De plus, `status-banner.tsx:47` fait `void surface;` : la prop `surface="dark"` que le
workspace passe à `OfflineBanner` et `PermissionDenied`
(`conversational-workspace.tsx:3925-3926`) **n'a aucun effet**. Les bannières d'erreur du
workspace sombre sont rendues avec les surfaces claires.

### P1-25 — « Paiement non confirmé » sans moyen de reprendre

`p/retour/page.tsx:92-104` dit « Vous pouvez réessayer depuis votre lien de paiement » sans
fournir le lien, alors que `/p/annule` sait le reconstruire depuis `sessionStorage`
(`resume-payment-link.tsx:17-25`). Le payeur doit retrouver l'email d'origine.

### P2-17 — Le changement de thème échoue en silence

`theme-provider.tsx:145` : `void onPersist?.(next)`. Si l'écriture sur le compte échoue, le
thème est appliqué localement et l'utilisateur retrouvera l'ancien sur un autre appareil,
sans jamais avoir été prévenu. Le compromis est assumé dans le code
(`appearance-control.tsx:21`) mais l'échec devrait au moins être annonçable.

### P2-18 — La 404 authentifiée ne distingue pas volontairement supprimé et interdit

`src/app/app/not-found.tsx:10-12` documente ce choix (ne pas révéler l'existence d'une
ressource d'un autre prestataire). C'est correct sur le plan sécurité, mais l'utilisateur
qui vient de supprimer un dossier et celui qui suit un mauvais lien reçoivent le même
message. Aucune action requise ; simplement à assumer.

---

## Divergences avec `SIDIAN_DESIGN_LOCK.md`

Le document verrouillé décrit deux choses que l'implémentation ne fait pas. Aucune des deux
n'est un bug : ce sont des décisions produit qui n'ont pas été répercutées dans le document.

### D-1 — « Dark mode par défaut »

`SIDIAN_DESIGN_LOCK.md` §Couleurs : « Dark mode par défaut ».
L'implémentation retient **le clair comme défaut et comme référence** :
`DEFAULT_THEME_PREFERENCE = "light"` (`src/lib/theme/theme.ts:23`), thème clair déclaré
sans condition sur `:root` (`tokens.css:20-21`), et le texte de l'écran de paramètres dit
« Le thème clair est la référence de Sidian » (`parametres/page.tsx:49`).

Le workspace Agent, lui, reste sombre dans les deux thèmes
(`conversational-workspace.tsx:4007`), ce qui préserve la direction artistique verrouillée
sur la seule surface qu'elle concerne.

**Le document et le code se contredisent frontalement.** Je ne tranche ni pour l'un ni pour
l'autre : cela demande une décision explicite du propriétaire du design lock. En l'état, un
lecteur du document conclura que le produit ne respecte pas sa propre direction artistique.

### D-2 — Le bloc KPI

`SIDIAN_DESIGN_LOCK.md` §Composition fixe l'ordre de lecture : « 1. Bonjour 2. Copy 3. KPI
4. Composer 5. Actions rapides ».

L'implémentation (`welcome-state.tsx:61-96`) rend : eyebrow « Votre agent IA » → `<h1>` de
salutation → paragraphe de situation → composer → raccourcis. **Aucun bloc KPI.**

Les données existent pourtant : `welcomeBriefCards` (trois cartes « Cette semaine », « À
traiter », « Prochain ») est calculé côté serveur
(`src/app/app/assistant/page.tsx:122-161`), transmis au composant, et utilisé uniquement
pour dériver **une phrase de texte** (`welcome-summary.ts:125-189`). La suppression du bloc
visuel est donc délibérée, cohérente avec `PRODUCT_PRINCIPLES.md` §5 et §7 (« pas de
dashboard rempli de KPI inutiles »), mais l'ordre verrouillé n'a jamais été mis à jour.

**Conséquence collatérale :** `--text-kpi` et `--text-kpi--line-height` restent déclarés
dans `globals.css` sans aucun utilisateur, et le rôle « Chiffre KPI » de
`SIDIAN_DESIGN_SYSTEM.md` §3 n'est plus utilisé nulle part.

---

## Synthèse priorisée

### P0 — bloquant

| # | Constat | Référence |
| --- | --- | --- |
| P0-1 | `/` ne mène nulle part ; le logo d'auth y renvoie | `src/app/page.tsx`, `auth-shell.tsx:22` |
| P0-2 | CGU / confidentialité non liables, consentement exigé | `sign-up-form.tsx:82`, `:94` |
| P0-3 | Un brouillon de protection ne survit pas au rechargement | `conversational-workspace.tsx` (état React) |
| P0-4 | Lien d'évitement placé après la sidebar : inopérant | `app-shell.tsx:171` vs `:204` |
| P0-5 | L'agent ne connaît que 50 clients → doublons silencieux | `assistant/page.tsx:297` |
| P0-6 | Listes non bornées, sans pagination ni recherche | `client-payeur-core.ts:19-23` |
| P0-7 | Quatre écrans sans `try/catch` → éjection hors coquille | `parametres`, `demarrage`, `[id]`, `paiements-a-recevoir:64` |
| P0-8 | Aucune frontière d'erreur sur les écrans d'auth | inventaire `src/app/**` |

### P1 — indispensable

Boucle « email non confirmé » sans issue (P1-2) · promesse d'analyse de document
inexistante (P1-3) · deux onboardings contradictoires (P1-4) · pas de vue « mes
échéances » (P1-5) · deux navigations pour la même donnée, comportement de clic divergent
(P1-6) · historique d'approbations inaccessible (P1-7) · action principale repliée (P1-8) ·
toast non pausable (P1-9) · hors-ligne absent des pages métier (P1-10) · `ErrorState` sans
réessai (P1-11) · jargon Stripe (P1-12) · session expirée sans lien (P1-13) · paiement
désactivé présenté comme lien invalide (P1-14) · cibles 28 px (P1-15) · composer focusable
sous `aria-hidden` (P1-16) · anneau de focus < 3:1 (P1-17) · pas de restitution de focus
(P1-18) · historique plafonné à 48 (P1-19) et fil à 600 (P1-20) · activité à 8 (P1-21) ·
erreur `/app` hors coquille et digest jeté (P1-22) · erreur d'approbation en Tailwind brut
(P1-23) · avertissement rendu comme information + `surface` ignorée (P1-24) · « paiement non
confirmé » sans lien de reprise (P1-25) · CTA `bg-sidian-blue` à 4,44:1 sur le bouton du
payeur (`FINAL_UI_AUDIT.md` C-1).

### P2 — qualité perçue

Registre mixte tu/vous sur le même écran (P2-1) · onboarding non rappelable (P2-2) ·
« Gérer mon abonnement » sans destination (P2-3) · retours agent jetés (P2-4) · troncatures
muettes (P2-5) · squelette clair sur workspace sombre (P2-6) · perte de navigation au
chargement Stripe (P2-7) · quatre mots pour un objet (P2-8) · accueil sombre non expliqué
(P2-9) · archivage sans confirmation (P2-10) · rail non responsive (P2-11) · sidebar mobile
saturée (P2-12) · `Escape` inopérant sur les pages métier (P2-13) · `role="log"` non borné
(P2-14) · messages sans auteur accessible (P2-15) · aucune recherche (P2-16) · échec de
persistance du thème muet (P2-17) · 404 indistincte assumée (P2-18).

### Décisions humaines requises (à ne pas trancher dans le code)

1. **Quel onboarding fait foi** — 3 étapes (sidebar) ou 4 avec Stripe (`/app/demarrage`) ?
2. **`SIDIAN_DESIGN_LOCK.md` : « Dark mode par défaut » ou clair par défaut ?**
   Le document et le code disent l'inverse.
3. **Le bloc KPI de l'ordre de lecture verrouillé** est-il abandonné, ou à réintroduire ?
4. **Y a-t-il une vue liste des échéances**, ou tout passe-t-il par la conversation ?
5. **« Dossiers » et « Paiements » doivent-ils rester deux entrées** ? Si oui, quelle
   différence produit, et quel vocabulaire unique ?
6. **Registre : tutoiement ou vouvoiement** ? `microcopy.ts:2` dit tutoiement ; toute la
   surface agent vouvoie.
