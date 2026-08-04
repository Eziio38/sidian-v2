# SID Gate — UI/UX Completion

Gate de finalisation UI/UX MVP (assistant conversation-first, desktop + mobile).  
**Intégrateur final :** SOUS-AGENT H (Responsive, a11y, tests, docs)  
**Date :** 2026-07-26  
**Workspace :** `/Users/jonathan/sidian-v2`  
**Aucun commit automatique.**

**Decision (gate) :** `PASS` — bloqueurs H restants traités (brand interim, nav Assistant, UI canaux lecture seule). Polish hors bêta : voir § Limitations.

---

## Clôture bloqueurs post-H (2026-07-26)

| Bloqueur H | Traitement | Statut |
| --- | --- | --- |
| Brand `/public/brand/` | SVG interim blue/white + `BrandLockup` partagé (sidebar + auth) ; `public/brand/README.md` | **OK** (interim) |
| Nav Assistant / Historique→démarrage | `AppNavigation` : **Assistant** → `/app/assistant` ; libellé unifié « Paiements à recevoir » ; plus d’« Historique » dans la nav | **OK** |
| UI Paramètres WA/email | `ConfigStatusList` + `getWorkspaceConfigStatus` ; lecture seule + CTA « Continuer le démarrage » (pas d’onboarding Meta / admin email inventé) | **OK** |
| Playwright e2e | Non installé — N/A ; couverture `pnpm test:ui` | **N/A documenté** |

---

## Audit initial

### Synthèse exécutive
> **Mise à jour intégrateur (post-H, clôture bloqueurs)** : assets brand interim livrés ; pont nav AppShell↔Assistant ; Paramètres canaux en lecture seule. Double shell dark/light **conservé** (hors scope unifier les shells). Welcome summary peut encore retomber sur fallback. Playwright absent.

> *Note historique (H soir) :* câblage `callAgentTool` → `POST /api/agent/tools` présent en mode live hors demos ; findings P0 drawer/a11y/touch traités.

L’UI Sidian V2 reste **bifurquée** tonalement (Assistant dark vs App Shell light) avec **navigation croisée** : `AppNavigation` expose Assistant ; la sidebar assistant pointe vers les écrans métier avec libellés cohérents (« Paiements à recevoir », pas « Historique »). Transport conversationnel live en place hors demos. Brand : SVG interim dans `public/brand/` (PNG DS à venir). Config WhatsApp / email : **statut réel + CTA démarrage**, sans fausse UI d’admin canaux.

### Matrice d’audit

| Écran | État actuel | Problèmes | Priorité | Action | Backend déjà disponible | Composant à réutiliser | Composant à créer |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Assistant** `/app/assistant` | Shell dark + welcome + fil + composer + demos A–E | Réponses stub (pas de `callAgentTool`) ; résumé welcome hardcodé ; pas de lien depuis `AppNavigation` ; dualité dark/light avec le reste de l’app | **P0** | Brancher `agent-client` → `POST /api/agent/tools` ; alimenter le résumé depuis `loadDashboard` ; unifier l’entrée nav produit | Oui — `POST /api/agent/tools`, runtime conversationnel, `loadDashboard` | `ConversationalWorkspace`, `AssistantShell`, `agent-client` | `useAgentConversation` (hook d’état live) |
| **Composer** | Complet UI (autosize, loading, erreur, limite 4k, clavier mobile) | `isLoading`/`error` branchés localement mais `handleSend` ignore l’API ; pas d’abort de requête | **P0** | Remplacer le stub par transport agent + mapping erreurs | Oui — route agent + codes erreur | `Composer` | — (câblage seulement) |
| **Protection panel** (`ContextPanel`) | Inline / overlay / sheet ; champs Client/Montant/Échéance/Prochaine étape + CTA | Champ `subject` typé mais **non rendu** ; largeur 20rem vs 360–420 px spec ; CTA primaire sans effet métier ; panneau alimenté par demos / raccourci local | **P0** | Afficher objet ; aligner largeur ; brancher CTA sur tools protection.draft.* | Oui — tools `protection.draft.*` | `ContextPanel` | Édition inline des champs (hover/clic, spec UX §3) |
| **Sidebar / drawer assistant** | Desktop fixe ; mobile drawer + focus trap + Escape + inert main | Nav sémantique incorrecte (« Historique » → `/app/demarrage`) ; lockup non conforme DS ; **logo/mark mobile** : `overflow-visible` + bouton collapse `translate-x-[40%]` hors tiroir → risque chrome brand derrière backdrop / fuite hors écran ; mark SVG stub, pas PNG DS ; Outfit 800 non chargé | **P0** | Corriger stacking/clip drawer ; lockup DS ; corriger items nav ; charger weight 800 | N/A (UI) | `AssistantSidebar` | `BrandLockup` partagé (mark + texte Outfit ExtraBold) |
| **Onboarding** `/app/demarrage` | 4 étapes + barre de progression, data réelle | Embarqué dans `AppShell` light ; mal nommé « Historique » depuis l’assistant ; pas de rail ; scroll page entière | **P1** | Renommer / repositionner dans la nav unifiée ; conserver checklist | Oui — `buildOnboardingSteps`, Stripe readiness, clients, créances | Page `demarrage` | — |
| **Dashboard** `/app` | Overview + rail portefeuille partiel | Pas de lien Assistant ; CTA « Nouveau paiement » ≠ « Sécuriser un contrat » ; scroll page entière (header non fixe) ; tokens `blue-50`/`blue-700` hors palette stricte | **P1** | Aligner App Shell patterns (header/toolbar fixes, liste scroll) ; CTA produit ; entrée Assistant | Oui — `loadDashboard` | `DashboardOverview`, `AppShell` | — |
| **Clients** `/app/clients` | Liste + formulaire inline édition + création rail | Édition inline lourde (chaque row = formulaire) ; pas de recherche/filtre/tri ; rail = formulaire pas KPI ; hors pattern Contrats | **P1** | Liste rows + drawer/sheet édition ; toolbar fixe | Oui — actions clients-creances | `ClientForm`, `ArchiveButton` | `ClientRow` + drawer édition |
| **Paiements / Protections** `/app/paiements-a-recevoir` | Liste créances + formulaires + section paiement | Libellé « Protections » (assistant) vs « Paiements à recevoir » (AppShell) ; cards répétées ; pas de toolbar ; scroll page | **P1** | Unifier naming produit ; liste scrollable + toolbar | Oui — créances, Stripe readiness, workflows | `CreanceForm`, `ReceivablePaymentSection` | `ProtectionRow` alignée assistant |
| **Paramètres** `/app/parametres` | Profil activité + email lecture seule | Aucune section canaux (WA/email) ; pas de Stripe ; pas de thème ; profil bas assistant non cliquable | **P0** (canaux) / **P1** (reste) | Étendre paramètres : Stripe deep-link + placeholders canaux | Profil oui ; Stripe oui ; WA/email UI non (backend canaux partiel) | `ProfileForm`, `StripeConnectPanel` | `ChannelsSettingsPanel` |
| **Config Stripe** `/app/connexion-stripe` | Panel Connect mature (états, reprise, activation) | Hors nav assistant ; light shell ; pas de deep-link depuis paramètres | **P1** | Exposer depuis Paramètres + nav unifiée | Oui — Connect view/actions | `StripeConnectPanel` | — |
| **Config WhatsApp** | **Absent UI** | Aucune page / section config canal | **P0** | Créer UI lecture/état canal + deep-link ops | Partiel — `communication-channels`, webhook WA, `ensure_whatsapp_sidian_channel` ; pas d’API settings prestataire exposée UI | — | `WhatsAppChannelCard` |
| **Config email** | **Absent UI** | Aucune page ; backend email noté ABSENT (P0 backend) | **P0** (UI gate) / bloqué backend | Placeholder « bientôt » + cacher actions tant que provider absent | Non — email notices/outbox ABSENT (`SID_GATE_BACKEND_COMPLETION`) | — | `EmailChannelCard` (disabled + copy) |
| **Approbations** `/app/approbations` | Liste décisions | Hors nav assistant ; light shell | **P2** | Inclure dans nav unifiée si parcours agent l’exige | Oui — `approvals` actions | `ApprovalDecision` | — |
| **Auth** connexion / inscription / reset | `AuthShell` card centrée | Mark = pastille « S » non DS ; pas d’assets brand ; weight logo | **P1** | `BrandLockup` officiel | Auth actions oui | `AuthShell`, forms | `BrandLockup` |
| **Landing** `/` | Stub technique « Socle » | Pas de marketing produit ; hors scope MVP assistant mais branding faible | **P2** | Différer ou page d’entrée minimale vers `/connexion` | N/A | — | — |
| **Mobile logo-behind-drawer** | Bug de composition drawer | Mark + wordmark dans header drawer ; `aside.overflow-visible` ; collapse hors panneau ; backdrop `z-20` / drawer `z-30` — le chrome brand peut peindre **derrière** le backdrop ou fuir à gauche quand fermé ; assets PNG absents (`public/` inexistant) | **P0** | Clipper le drawer (`overflow-hidden`) sauf hit-area collapse documentée ; élever lockup au-dessus du backdrop ; livrer marks dans `public/brand/` | N/A | `AssistantSidebar` | `BrandLockup` + CSS drawer |

### Écarts transverses (patterns / design system)

| Règle | Attendu | Constat |
| --- | --- | --- |
| App Shell 3 colonnes | Sidebar + main (header fixe / liste scroll) + rail sticky | `AppShell` : main scroll entier ; rail ad hoc par page ; mobile = nav horizontale scroll, pas drawer |
| Nav produit | Une seule IA informationnelle | Deux trees : `AppNavigation` (7 items, **sans Assistant**) vs `ASSISTANT_NAV` (5 items, libellés différents) |
| Brand lockup | Mark PNG + « Sidian » Outfit ExtraBold 800 | SVG stub / pastille « S » ; weight 800 **chargé** (B, `layout.tsx`) ; `public/brand/` **absent** |
| Assistant dark | Spec `SIDIAN_CONVERSATIONAL_UX` | Surface assistant OK tonalement ; pages métier light → rupture à chaque navigation |
| Composer shortcuts | Max 3 desktop | `DRAFT_SHORTCUTS` = 4 ; `slice(0, 4)` — écart vs G1-O / UX §5 |
| CTA principal | Un CTA bleu header | Dashboard OK partiellement ; Clients/Protections multiplient actions dans rows |

### Top 10 — problèmes UI P0

1. **Double shell / double navigation** — Assistant dark vs AppShell light ; impossible d’atteindre `/app/assistant` depuis la nav métier ; libellés contradictoires (Protections vs Paiements ; Historique = démarrage).
2. **Conversation non branchée au backend** — `handleSend` stub `setTimeout` alors que `agent-client.ts` + `POST /api/agent/tools` existent.
3. **Mobile logo-behind-drawer** — stacking/`overflow-visible` + collapse hors panneau ; mark brand peut passer derrière le backdrop ou fuir ; assets DS absents.
4. **Brand system partiel** — pas de `public/brand/` ; lockups non conformes (auth + sidebar) ; ExtraBold 800 chargé (agent B).
5. **Panneau Protection incomplet** — `subject` non affiché ; CTA sans exécution tools ; largeur sous-spec.
6. **Paramètres sans canaux** — zéro UI WhatsApp / email alors que le produit repose sur la communication client.
7. **Config WhatsApp absente** — backend canaux/webhook présent, aucune surface prestataire.
8. **Config email absente** — UI manquante ; backend email encore ABSENT (bloquant produit + UI).
9. **Welcome résumé factice** — `DEFAULT_SUMMARY` hardcodé au lieu des données dashboard.
10. **Nav assistant « Historique » → `/app/demarrage`** — mauvaise sémantique ; casse le modèle mental onboarding vs historique conversationnel.

### Réutilisations prioritaires (pas de réécriture inutile)

- Garder : `Composer`, `ComposerShortcuts`, `MessageThread`, `WelcomeState`, `ContextPanel` (étendre), `AssistantShell` / `AssistantSidebar` (corriger), `StripeConnectPanel`, `DashboardOverview`, forms clients/créances.
- Créer en priorité : `BrandLockup`, hook conversation live, `ChannelsSettingsPanel` (+ cartes WA/email), unifier nav (un seul `ProductNavigation`).

### Hors scope de cet audit

- Implémentation des correctifs.
- Changements backend / migrations.
- Commits.

### Prochaine étape recommandée (sous-agents suivants)

1. Unifier navigation + shell d’entrée (Assistant-first ou AppShell avec pont).  
2. Câbler composer → agent tools + panneau protection.  
3. Fix drawer mobile / brand assets.  
4. Écran Paramètres canaux (WA ready, email placeholder jusqu’au backend).


---

## Direction design

Références produit : ChatGPT (simplicité), Claude (sobriété), Apple (clarté), Linear (précision).  
Surface conversation = dark premium (`--assistant-*`) ; reste de l’app = light tokens Sidian.  
Tokens et règles : `docs/SIDIAN_DESIGN_SYSTEM.md` + `docs/SIDIAN_UI_PATTERNS.md`.

---

## Design system

**Agent :** SOUS-AGENT B  
**Statut :** consolidé (light, non gigantesque)  
**Source code :** [`src/app/globals.css`](../../src/app/globals.css)  
**Source normative produit :** [`docs/SIDIAN_DESIGN_SYSTEM.md`](../SIDIAN_DESIGN_SYSTEM.md)

### Principes

- Tokens CSS centralisés (`:root`) + mapping Tailwind v4 (`@theme inline`).
- Marque existante **préservée** (Sidian Blue, Nuit, Ardoise, Ciel, gris froids, surfaces assistant).
- Ajouts ciblés : Brume, sémantiques succès/alerte/danger, états d’interaction, rayons, ombres, typo, tailles de contrôle / icônes, scrollbars.
- Pas de purple-on-white, cream+terracotta, ni look broadsheet — hors scope ; la marque Sidian (bleu `#3B6DF8`) est conservée.
- Pas de redesign produit : consolidation tokens + alignement léger des primitives auth / nav.

### Fichiers touchés (B)

| Fichier | Rôle |
|---|---|
| `src/app/globals.css` | Tokens + `@theme` + utilitaires scrollbar / empty / loading |
| `src/app/layout.tsx` | Outfit 400–800 (800 = lockup logo) |
| `src/components/auth/auth-banner.tsx` | Tons success/error → tokens sémantiques |
| `src/components/auth/auth-field.tsx` | Danger / disabled / placeholder tertiaire |
| `src/components/auth/auth-submit-button.tsx` | Hover / active / disabled tokenisés |
| `src/components/app/app-navigation.tsx` | Actif = Brume ; hover = state-hover |
| `src/components/app/profile-form.tsx` | Checked = Brume |
| `src/components/app/approval-decision.tsx` | Hover/active CTA |
| `src/components/app/follow-up-controls.tsx` | Hover/active CTA |
| `src/app/app/error.tsx` | Hover/active CTA |

Pas de dossier `src/components/ui/**` existant — pas de lib de primitives créée.

### Couleurs — marque (préservées)

| Token CSS | Hex | Tailwind | Usage |
|---|---|---|---|
| `--sidian-blue` | `#3B6DF8` | `sidian-blue` | CTA, liens, focus, actif |
| `--sidian-blue-hover` | `#315FD9` | `sidian-blue-hover` | Hover CTA (déjà utilisé en dur → token) |
| `--sidian-blue-active` | `#2A52C4` | `sidian-blue-active` | Active press |
| `--sidian-ciel` | `#6B96FA` | `ciel` | Accent fond sombre |
| `--sidian-brume` | `#EDF2FF` | `brume` | Fonds brand clairs, nav active |
| `--sidian-nuit` | `#0D1117` | `nuit` | Texte fort |
| `--sidian-ardoise` | `#1D2535` | `ardoise` | Surface sombre secondaire |
| `--sidian-gris-50` … `600` | cf. DS | `gris-*` | Surfaces, borders, texte secondaire |

### Couleurs — sémantiques

| Rôle | Texte | Fond | Border | Tailwind |
|---|---|---|---|---|
| Succès | `--sidian-success` `#059669` | `--sidian-success-bg` `#ECFDF3` | `--sidian-success-border` | `success` / `success-bg` / `success-border` |
| Alerte | `--sidian-warning` `#D97706` | `--sidian-warning-bg` `#FFFAEB` | `--sidian-warning-border` | `warning` / `warning-bg` / `warning-border` |
| Danger | `--sidian-danger` `#DC2626` | `--sidian-danger-bg` `#FEF3F2` | `--sidian-danger-border` | `danger` / `danger-bg` / `danger-border` |

Réservés aux statuts métier (validé / attention / erreur). Interdit en décoration.

### Surfaces & texte (light)

| Token | Valeur / rôle |
|---|---|
| `--background` / `--surface` | Blanc app |
| `--surface-muted` / `--surface-sidebar` | `gris-50` |
| `--surface-empty` | Fond empty state |
| `--surface-loading` | Skeleton (`gris-100`) |
| `--text-primary` | Nuit |
| `--text-secondary` | `gris-500` |
| `--text-tertiary` / `--text-disabled` | `gris-400` |
| `--text-link` | Sidian Blue |
| `--border-default` | `gris-200` |
| `--border-divider` | `gris-100` |
| `--border-strong` | `gris-300` |

### États d’interaction

| État | Token | Usage recommandé |
|---|---|---|
| Hover (surface) | `--state-hover-bg` → `bg-state-hover` | Rows, nav inactive |
| Active / selected | `--state-active-bg` (= Brume) → `bg-state-active` / `bg-brume` | Nav courante, radio checked |
| Disabled | `--state-disabled-bg` + `--state-disabled-fg` ; `--state-disabled-opacity` | Inputs / boutons |
| Focus | `--state-focus-ring` (blue 40 %) ; outline `sidian-blue` côté composants | `focus-visible:outline-sidian-blue` |
| Loading | `--surface-loading` + `.sidian-loading-pulse` | Skeletons |
| Empty | `.sidian-empty` | Zones vides dashed |
| Success / warning / error | tokens sémantiques ci-dessus | Bannières, badges, alertes |

### Typographie

- Police : **Outfit** (`--font-outfit`), weights **400 / 500 / 600 / 700 / 800**.
- Échelle tokens : `--text-display-size` 32px · `--text-kpi-size` 26px · `--text-section-size` 16px · `--text-body-size` 14px · `--text-body-sm-size` 13px · `--text-caption-size` 12px · `--text-eyebrow-size` 11px.
- Utilitaires Tailwind mappés : `text-display`, `text-kpi`, `text-section`, `text-body`, `text-body-sm`, `text-caption`, `text-eyebrow`.
- Montants : `tabular-nums` obligatoire (règle DS, inchangée).

### Spacing (grille 4px)

Tokens layout : `--space-1`…`8`, `--space-page-x` (24) / `--space-page-x-lg` (32), `--space-rail-gap` (24), `--space-card` / `--space-card-lg`, `--space-field-gap`, `--space-section`.  
Contrôles : `--control-height` 40 · `--input-height` 40 · `--badge-height` 24 · `--row-min-height` 56 · `--sidebar-width` 220 · `--drawer-width` 480 · `--rail-width` 280.

### Rayons & ombres

| Token | Valeur | Tailwind |
|---|---|---|
| `--sidian-radius-sm` | 8px | `rounded-sm` (theme) |
| `--sidian-radius-md` | 10px | `rounded-md` |
| `--sidian-radius-lg` | 12px | `rounded-lg` |
| `--sidian-radius-xl` | 16px | `rounded-xl` |
| `--sidian-radius-full` | pill | (CSS direct) |
| `--sidian-shadow-sm` | discrète | `shadow-sm` |
| `--sidian-shadow-card` | cards | `shadow-card` |
| `--sidian-shadow-float` | `0 8px 24px rgba(13,17,23,.08)` | `shadow-float` |

### Icônes

| Token | Taille |
|---|---|
| `--icon-xs` | 14px (meta table) |
| `--icon-sm` | 16px (boutons) |
| `--icon-md` | 20px (sidebar / défaut) |
| `--icon-lg` | 24px |
| `--icon-stroke` | 1.75 (Lucide) |

### Scrollbars

Classe unique : `.dashboard-card-scroll`  
Tokens : `--scrollbar-thumb`, `--scrollbar-thumb-hover`, `--scrollbar-track`, `--scrollbar-size` (6px).

### Surfaces assistant (préservées)

Variables `--assistant-*` inchangées (shell conversation sombre premium). Accent = `--sidian-blue`.

### Migration progressive (hors B)

Encore présents dans l’app métier (à remplacer par d’autres sous-agents UI) :

- `bg-red-50` / `text-red-700` / `bg-amber-*` / `text-emerald-*` → `danger-*` / `warning-*` / `success-*`
- `#315fd9` résiduels hors fichiers B → `sidian-blue-hover`
- `bg-blue-50` → `bg-brume`

### Checklist consommation tokens

Avant nouvelle UI :

1. Couleur issue de `globals.css` / `@theme`, pas de hex libre.
2. Bleu = action / focus / actif uniquement.
3. Vert / orange / rouge = statut uniquement.
4. Empty / loading / error / success utilisent les tokens d’état.
5. `prefers-reduced-motion` respecté pour `.sidian-loading-pulse` et animations assistant.

---

---

## Composants créés

| Composant | Agent | Rôle |
|---|---|---|
| `src/components/feedback/**` | G | États UX (loading, empty, error, offline, success, permission, missing-config, irreversible) |
| `src/components/assistant/protection-panel/**` | E | Panneau Protection progressif + microcopy + mapping API |
| `src/components/assistant/agent-client.ts` | C | Transport HTTP → `POST /api/agent/tools` |
| `src/components/assistant/converse-adapter.ts` | C | Mapping converse/confirm → messages + contexte |
| `src/components/assistant/welcome-summary.ts` | C | Résumé welcome (fallback) |
| `BrandLockup` (sidebar) | F | Lockup mark + texte (inline) |
| `src/components/brand/brand-lockup.tsx` | post-H | Lockup partagé (SVG interim `/public/brand/`) |
| `public/brand/sidian-mark-*.svg` | post-H | Marks interim Sidian Blue / white |

## Composants refactorés

| Composant | Changements |
|---|---|
| `composer.tsx` | Autosize, loading, erreur, limite, focus, **touch 44px**, contraste |
| `assistant-shell.tsx` | Drawer mobile, skip-link, safe-area hamburger, inert main |
| `assistant-sidebar.tsx` | Dialog + focus trap + Escape + overlay + safe-area profil |
| `conversational-workspace.tsx` | Live agent, keyboard offset, sheet mobile, reduced-motion scroll |
| `message-thread.tsx` | aria-live, retry, actions confirm, touch suggestions |
| `welcome-state.tsx` / `composer-shortcuts.tsx` | Touch targets ≥ 44px |
| `globals.css` | Tokens B + reduced-motion global + `.sidian-touch-target` / safe-area |
| Auth / nav light | Tokens sémantiques (agent B) |

## Parcours terminés (composants)

1. Ouvrir l’Assistant (welcome + composer) — **couvert**  
2. Poser une question (live transport injectable) — **couvert**  
3. Créer une protection (raccourci + panneau) — **couvert**  
4. Valider / confirmer (confirm tool) — **couvert** (composant)  
5. Drawer mobile open/close/trap — **couvert**  
6. Échec réseau + retry — **couvert**  
7. Sheet mobile panneau — **couvert**  

Parcours non couverts E2E navigateur (Playwright **absent** du repo) : auth réelle, Stripe Connect, WhatsApp/email settings.

## Responsive

| Breakpoint | Comportement |
|---|---|
| ≥ 1024px (desktop) | Sidebar fixe, panneau Protection inline |
| 768–1023 (tablet) | Panneau overlay |
| < 768 (mobile) | Drawer nav + sheet Protection |
| 320px | Padding `px-3`, dock `calc(100%-16px)`, safe-areas |
| Clavier mobile | `visualViewport` → `keyboardOffset` sur dock |
| Touch | Cibles principales ≥ 44×44 (`h-11` / `min-h-11`) |

## Accessibilité

- Skip-link « Aller à la discussion » (shell) + « Aller au contenu » (AppShell)  
- Focus-visible outline Sidian Blue  
- Drawer : `role=dialog`, `aria-modal`, focus trap, Escape, restore focus, `inert` main  
- Labels : composer `sr-only`, boutons aria-label, nav `aria-current`  
- `aria-live` fil de messages + indicateur « Sidian réfléchit… »  
- Erreurs `role=alert`  
- `prefers-reduced-motion` : animations assistant + utilitaires globaux + spinner  
- Contraste : opacités muted trop faibles remplacées sur labels/actions critiques  

## Tests

| Suite | Commande | Contenu |
|---|---|---|
| Assistant UI | `pnpm test:g1-o` / `pnpm test:ui` | workspace, composer, navigation/drawer, flows |
| Flows H | `assistant-flows.test.tsx` | open, ask, create, validate, network fail, drawer, sheet |
| Forms existants | `pnpm test:forms` | clients / créances / Connect (inchangés) |
| Playwright | — | **non présent** (`test:e2e` / `test:accessibility` absents) |

## Limitations

- Brand = **SVG interim** (pas encore PNG DS officiels 156 px)  
- Double shell (dark assistant vs light app) non unifié tonalement — volontaire pour la bêta conversation-first  
- Welcome summary peut encore utiliser un fallback (selon câblage page)  
- Pas de suite Playwright / captures automatisées gate (**N/A** — Playwright non installé)  
- Homogénéisation badges métier Tailwind colorés partielle  
- Pas d’admin self-serve WhatsApp/email prestataire (statut plateforme seulement) — correct produit actuel  

## Éléments restant avant bêta (hors gate / polish)

1. Remplacer SVG interim par PNG DS officiels  
2. E2E navigateur (Playwright) auth + parcours live — optionnel post-bêta  
3. Audit contraste systématique (outil) sur muted/opacity  
4. Polish pages métier light (dashboard/clients) hors conversation  
5. Unification visuelle shells (si produit le demande)  

## Captures / références visuelles

Références G1-O : `docs/implementation/evidence/g1-o-*.png`  
Design system : `docs/SIDIAN_DESIGN_SYSTEM.md`  
Preview locale : `/dev/assistant?demo=A|B|C|D|E`

## Validation commandes (SOUS-AGENT H + clôture post-H)

| Commande | Résultat |
|---|---|
| `pnpm test:ui` | **PASS** — 64 tests (15 fichiers : assistant + feedback + app) |
| `pnpm exec tsc --noEmit` | **PASS** |
| `pnpm build` | **PASS** |
| `pnpm test:e2e` | **N/A** (Playwright non installé — flows composants conservés) |
| `pnpm test:accessibility` | **N/A** (couverture via tests composants a11y) |

**Decision gate :** `PASS` — parcours principaux UI/UX bêta adressés ; brand interim documenté ; nav unifiée ; canaux lecture seule ; E2E navigateur N/A.
