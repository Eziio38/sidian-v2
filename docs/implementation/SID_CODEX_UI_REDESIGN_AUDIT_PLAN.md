# Refonte UI authentifiée — audit initial et plan de migration

**Date :** 27 juillet 2026  
**Périmètre :** UI/UX authentifiée uniquement. Aucun changement backend, Stripe,
WhatsApp, Email, Supabase, migration ou règle métier.

## Audit initial

### Cartographie

- `AppShell` et `AppSidebar` forment déjà un premier socle partagé.
- `/app/assistant` porte l’entrée « Aujourd’hui » et le workspace conversationnel.
- `/app/paiements-a-recevoir`, `/app/paiements`, `/app/clients`,
  `/app/activite` et `/app/parametres` utilisent le même composant `AppShell`,
  mais conservent des compositions de page et des densités différentes.
- Les routes secondaires (`/app/demarrage`, `/app/approbations`,
  `/app/connexion-stripe`, détail d’un paiement) utilisent aussi `AppShell`.
- Le preview local `/dev/assistant` couvre les états conversationnels A–E.
- Le preview local `/dev/workspace` couvre les pages métier et les états
  erreur/vide sans contourner l’authentification des vraies routes.

### Systèmes visuels concurrents

1. **Workspace IA clair** — sidebar blanche, fond froid, conversation, composer
   docké et panneau Protection.
2. **Pages métier héritées** — listes en cartes, formulaires toujours ouverts,
   grilles de type administration et nombreuses bordures.
3. **Feedback historique** — tokens sémantiques partiels mélangés à des classes
   Tailwind `red/amber/emerald`, spinners et références d’erreur optionnelles.
4. **Surfaces auth/publiques** — hors refonte authentifiée mais déjà branchées
   au même `BrandLockup`.
5. **Compatibilité assistant historique** — alias `AssistantShell` et
   `AssistantSidebar`, utiles aux tests mais sans rôle visuel autonome.

### Score technique avant refonte

| Dimension | Score | Constat principal |
| --- | ---: | --- |
| Accessibilité | 3/4 | Focus et landmarks présents, mais double `h1`, sheet sans focus trap et quelques cibles secondaires trop petites. |
| Performance | 3/4 | Server Components conservés ; peu de dépendances, mais le workspace mesure plusieurs offsets client et anime chaque champ du panneau. |
| Responsive | 2/4 | Drawer et safe areas existent ; le composer reste un footer absolu et le panneau mobile est un plein écran, pas une vraie sheet. |
| Theming | 2/4 | Tokens centraux solides, mais couleurs sémantiques et surfaces historiques encore codées localement. |
| Anti-patterns | 2/4 | Light mode cohérent, mais répétition de cartes, labels uppercase, doubles headers et formulaires “admin”. |
| **Total** | **12/20** | **Acceptable — refonte importante nécessaire.** |

### Problèmes prioritaires

- **P1 — Hiérarchie Aujourd’hui :** deux en-têtes et deux `h1`; le briefing ne
  donne pas un montant attendu réellement prioritaire.
- **P1 — Composer :** faible hauteur utile et traitement de footer isolé par une
  bordure pleine largeur.
- **P1 — Mobile Protection :** sheet plein écran, sans poignée ni géométrie de
  bottom sheet et sans gestion de focus complète.
- **P1 — Pages métier :** langage visuel non unifié; Protections et Clients
  exposent directement des formulaires longs et imbriqués.
- **P1 — Erreurs :** le transport peut relayer `result.message`; `ErrorState`
  peut afficher un `digest`, ce qui contredit l’interdiction d’exposer les
  détails techniques.
- **P2 — Densité et composants :** cartes à bordure + ombre répétées,
  uppercase décoratif et largeurs de contenu différentes.
- **P2 — États :** loading global encore conçu comme un dashboard quatre KPI,
  non aligné sur le shell et le briefing financier.

### Points positifs à conserver

- Routage, données, actions serveur et limites d’autorité existantes.
- `AppShell`, `AppSidebar`, `APP_NAV` et le drawer accessible comme base.
- `BrandLockup` branché uniquement sur `/public/brand/sidian-logo.png`.
- Architecture Server/Client actuelle : pages et chargements métier restent
  côté serveur, interactivité isolée dans les composants clients.
- Composer auto-resize, placeholder demandé, absence du hint clavier.
- Cartes métier optionnelles, panneau Protection progressif et mocks A–E.
- Tokens Sidian, Outfit, tabular figures, reduced motion et safe areas.
- Tests UI existants et previews locales dédiées à la QA.

## Supprimer, conserver, refactorer

### Supprimer

- Le second en-tête interne du workspace Aujourd’hui.
- La bordure de dock qui transforme le composer en footer isolé.
- L’affichage des digests et des messages backend bruts dans l’UI.
- Les formulaires d’édition complets affichés en permanence dans les listes.
- Les labels décoratifs uppercase sans fonction de lecture.
- Les variantes sombres résiduelles des composants de feedback utilisées par
  l’ancienne expérience assistant.

### Conserver

- Toutes les actions serveur et tous les appels existants.
- Les routes et URL produit.
- Les composants métier déterministes (`CreanceForm`, `ClientForm`,
  `ProfileForm`, `ReceivablePaymentSection`) en les remaquettant.
- La structure de données du briefing, des messages et du panneau Protection.
- Les alias de compatibilité requis par les tests, sans recréer de shell visuel.

### Refactorer

- `AppShell` en cadre unique avec en-tête de page cohérent, largeur de travail
  stable, fond gris très clair et variante workspace sans double chrome.
- `AppSidebar` en navigation plus compacte et calme, avec logo PNG unique,
  espace utile et profil discret.
- `WelcomeState` en briefing financier : montant attendu, actions nécessaires,
  prochain paiement, un CTA principal et deux secondaires maximum.
- `Composer` en surface centrale plus haute, confortable et proche du contenu.
- `MessageThread` et `MessageCard` en objets métier scannables, sans sur-cartes.
- `ProtectionPanel` en panneau desktop intégré, overlay tablette et vraie bottom
  sheet mobile avec safe areas.
- Pages métier en primitives partagées : toolbar, liste structurée, statut,
  montant, métadonnées et empty/error/loading cohérents.
- Feedback en vocabulaire sûr, sans détails techniques.

## Plan de migration

1. Consolider tokens et primitives partagées (boutons, badges, rows, page
   surfaces, états).
2. Finaliser le cadre `AppShell` / `AppSidebar` et la navigation responsive.
3. Recomposer Aujourd’hui autour du briefing, puis rapprocher le composer.
4. Recomposer conversation, cartes métier et panneau Protection.
5. Harmoniser Protections, Paiements, Clients, Activité et Paramètres.
6. Refaire les états vide, chargement, erreur et succès.
7. Finaliser mobile : drawer, safe areas, bottom sheet Protection.
8. Étendre les tests UI, exécuter toutes les validations demandées.
9. Capturer les treize vues obligatoires dans
   `docs/implementation/screenshots/codex-ui-redesign/`.

## Captures avant modification

- `audit-before/aujourdhui-desktop.png`
- `audit-before/conversation-protection.png`
- `audit-before/aujourdhui-mobile.png`

