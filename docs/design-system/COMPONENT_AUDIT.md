# Audit des composants existants

## Périmètre et méthode

Audit réalisé avant l’implémentation de la fondation sur les 53 fichiers React
de production présents dans `src/components` (tests exclus). Chaque fichier a
été relu selon quatre axes : responsabilité métier, structure sémantique,
langage visuel et duplication. Les décisions ci-dessous décrivent la cible de
migration ; aucune suppression ni migration d’écran n’est effectuée en Phase 1.

## Systèmes visuels concurrents identifiés

1. **App métier historique** : composants `app/*`, Tailwind et alias
   `--sidian-*`, géométries locales, formulaires et boutons spécifiques.
2. **Workspace assistant** : composants `assistant/*`, nombreuses valeurs
   Tailwind arbitraires, composer et cartes spécialisés, plusieurs SVG inline.
3. **Authentification** : composants `auth/*` avec son propre champ, bouton,
   bannière et shell.
4. **Feedback transversal** : composants `feedback/*` avec une deuxième famille
   de cartes, actions, skeletons, états et tons, y compris une variante sombre
   devenue incohérente avec le light mode.
5. **Fondation globale** : tokens partiels dans `globals.css`, utiles mais
   incomplets, mêlant valeurs historiques et variables de l’interface actuelle.

L’audit a relevé 191 fragments de classes Tailwind avec crochets dans les
composants de production, ainsi que 20 balises SVG inline réparties dans cinq
fichiers. Aucun Storybook n’était installé.

## Légende

- **Conserver** : responsabilité et structure déjà adaptées ; seulement des
  remplacements mécaniques mineurs seront admis.
- **Modifier** : conserver le comportement, migrer structure ou présentation
  vers le design system.
- **Supprimer** : compatibilité ou duplication sans valeur durable ; suppression
  après migration des imports.
- **Fusionner** : absorber la responsabilité visuelle dans une primitive
  officielle tout en conservant, ailleurs, la logique métier nécessaire.

## Inventaire exhaustif

| Composant | Décision | Motif et cible Phase 2 |
| --- | --- | --- |
| `app/app-navigation.tsx` | Modifier | Conserver la navigation et les routes ; utiliser Icon, Button et tokens de layout. |
| `app/app-shell.tsx` | Modifier | Reste l’unique AppShell ; remplacer SVG, mesures et styles locaux par les primitives officielles. |
| `app/app-sidebar.tsx` | Modifier | Conserver navigation et données utilisateur ; normaliser états, icônes, largeur et drawer. |
| `app/approval-decision.tsx` | Modifier | Conserver l’action métier ; composer Button et feedback officiels. |
| `app/cancel-receivable-button.tsx` | Modifier | Conserver confirmation et mutation ; employer Button destructive et état loading. |
| `app/client-forms.tsx` | Modifier | Conserver actions serveur et validation ; migrer champs, erreurs et boutons. |
| `app/creance-forms.tsx` | Modifier | Conserver règles et données ; migrer Input, DateInput, Select et feedback. |
| `app/dashboard-actions.tsx` | Modifier | Conserver le modèle d’actions ; présenter avec Card, Badge et Button. |
| `app/dashboard-deadlines.tsx` | Modifier | Conserver les échéances ; normaliser timeline, densité et empty state. |
| `app/dashboard-events.tsx` | Modifier | Conserver les événements ; utiliser TimelineCard et typographie officielle. |
| `app/dashboard-overview.tsx` | Modifier | Conserver l’orchestration ; remplacer la grille arbitraire par les constantes de layout. |
| `app/dashboard-portfolio.tsx` | Modifier | Conserver les calculs reçus ; migrer la surface vers SummaryCard. |
| `app/dashboard-summary.tsx` | Modifier | Conserver les totaux ; utiliser rôles H2/Label et cartes sans styles locaux. |
| `app/follow-up-controls.tsx` | Modifier | Conserver règles et actions ; migrer contrôles, disabled et erreurs. |
| `app/payment-reconciliation-button.tsx` | Modifier | Conserver réconciliation déterministe ; adopter Button et loading. |
| `app/prepare-link-button.tsx` | Modifier | Conserver préparation du lien ; adopter Button et feedback officiel. |
| `app/profile-form.tsx` | Modifier | Conserver persistance ; migrer champs et succès/erreur. |
| `app/receivable-payment-section.tsx` | Modifier | Conserver données et action ; composer PaymentCard et boutons. |
| `app/stripe-connect-panel.tsx` | Modifier | Conserver intégration intacte ; migrer uniquement présentation, états et contrôles. |
| `assistant/assistant-shell.tsx` | Fusionner | Alias de compatibilité vers AppShell ; migrer les imports puis absorber ce wrapper. |
| `assistant/assistant-sidebar.tsx` | Supprimer | Réexport déprécié sans comportement ; remplacer les imports par AppSidebar. |
| `assistant/composer-shortcuts.tsx` | Modifier | Conserver suggestions contextuelles ; migrer Badge/Button/Icon et tokens. |
| `assistant/composer.tsx` | Modifier | Conserver saisie, limite et envoi ; composer la primitive DS Composer et les boutons officiels. |
| `assistant/context-panel.tsx` | Supprimer | Alias pur de ProtectionPanel ; retirer après migration des imports et tests. |
| `assistant/conversational-workspace.tsx` | Modifier | Conserver orchestration/API ; découper l’assemblage visuel et adopter AppShell, cards et états DS. |
| `assistant/message-card.tsx` | Modifier | Conserver le mapping des objets métier ; rendre via variantes Card officielles. |
| `assistant/message-thread.tsx` | Modifier | Conserver ordre, annonces et conversation ; normaliser typographie, espacements et loading. |
| `assistant/protection-panel/protection-panel.tsx` | Modifier | Conserver progression et actions ; adopter cards, badges, boutons, sheet et tokens de panneau. |
| `assistant/suggestion-icons.tsx` | Supprimer | Bibliothèque SVG locale concurrente ; remplacer chaque pictogramme par Lucide. |
| `assistant/welcome-state.tsx` | Modifier | Conserver briefing et suggestions ; migrer hiérarchie, cards, empty/loading et espacements. |
| `auth/auth-banner.tsx` | Fusionner | Remplacer la bannière spécifique par ErrorCard, SuccessCard ou InfoCard selon le ton. |
| `auth/auth-field.tsx` | Fusionner | Remplacer les champs texte par Input ; traiter la checkbox comme extension officielle avant migration. |
| `auth/auth-page.tsx` | Conserver | Wrapper sémantique neutre déjà délégué à AuthShell. |
| `auth/auth-shell.tsx` | Modifier | Conserver composition et logo ; migrer layout, typographie et surfaces. |
| `auth/auth-submit-button.tsx` | Fusionner | Remplacer par Button primary avec état loading. |
| `auth/forgot-password-form.tsx` | Modifier | Conserver flux d’authentification ; migrer uniquement primitives et feedback. |
| `auth/reset-password-form.tsx` | Modifier | Conserver flux d’authentification ; migrer champs, bouton et erreurs. |
| `auth/sign-in-form.tsx` | Modifier | Conserver flux d’authentification ; migrer champs, bouton et bannière. |
| `auth/sign-out-button.tsx` | Modifier | Conserver l’action ; employer Button ghost ou menu action. |
| `auth/sign-up-form.tsx` | Modifier | Conserver flux d’authentification ; migrer champs, consentement et feedback. |
| `brand/brand-lockup.tsx` | Conserver | Centralise déjà `/public/brand/sidian-logo.png`, seule source de logo autorisée. |
| `feedback/confirm-irreversible.tsx` | Modifier | Conserver le pattern de confirmation ; migrer vers Button destructive, focus et tokens d’overlay. |
| `feedback/disabled-hint.tsx` | Fusionner | Absorber l’aide dans hint/aria-describedby des champs ou contrôles officiels. |
| `feedback/empty-state.tsx` | Fusionner | Remplacer par la primitive EmptyState officielle. |
| `feedback/error-state.tsx` | Fusionner | Remplacer la surface par ErrorCard et Button ; conserver le contrat d’action utile. |
| `feedback/in-progress-state.tsx` | Fusionner | Absorber dans Spinner, Progress ou une Card info selon le contexte. |
| `feedback/loading-state.tsx` | Fusionner | Remplacer Skeleton, PageSkeleton et indicateur par les primitives loading officielles. |
| `feedback/missing-config.tsx` | Modifier | Conserver la détection et le contenu ; migrer les surfaces vers Card/Badge/Button. |
| `feedback/offline-banner.tsx` | Modifier | Conserver le hook et l’annonce ; migrer la présentation vers InfoCard ou ErrorCard. |
| `feedback/permission-denied.tsx` | Fusionner | Recomposer avec EmptyState ou ErrorCard selon la possibilité de reprise. |
| `feedback/protection-notices.tsx` | Modifier | Conserver les avertissements métier ; adopter InfoCard/Badge sans ton décoratif. |
| `feedback/status-banner.tsx` | Fusionner | Supprimer la famille visuelle et la branche sombre ; utiliser Card, Badge, Button et ButtonLink. |
| `feedback/success-state.tsx` | Fusionner | Remplacer par SuccessCard, avec action officielle si nécessaire. |

## Suppressions prévues

Trois fichiers sont candidats à une suppression complète après migration des
imports : `assistant-sidebar.tsx`, `context-panel.tsx` et
`suggestion-icons.tsx`. Ils ne sont pas supprimés en Phase 1 afin de ne casser
aucun écran ni test.

## Éléments conservés

- Toute logique métier, action serveur et intégration.
- AppShell comme point d’entrée unique.
- Les contrats de données des composants métier.
- Le composant BrandLockup et son unique logo officiel.
- Les tests existants, qui devront rester verts pendant la migration.

## Ordre de migration recommandé

1. Remplacer les primitives feedback et auth sans changer leurs contrats.
2. Migrer AppShell, AppSidebar et la navigation.
3. Migrer composer, message cards et ProtectionPanel.
4. Migrer les composants dashboard et formulaires métier.
5. Supprimer les trois fichiers de compatibilité devenus sans usage.
6. Retirer progressivement les alias historiques de `globals.css` lorsque leur
   recherche globale ne retourne plus aucune consommation.
