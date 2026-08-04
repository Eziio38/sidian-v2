# Sidian — Rapport Phase 1 Design System Foundation

Date : 27 juillet 2026

## Résultat

La fondation officielle du design system Sidian est implémentée sans migration
d’écran, sans modification de page et sans intervention sur le backend, les
API, Stripe, WhatsApp, Email, Supabase, les workflows ou la sécurité.

Le socle fournit une source de tokens unique, des primitives React
accessibles, un catalogue interne non routé, une documentation d’usage, un
audit exhaustif et un contrôle automatique contre les valeurs arbitraires.

## Ce qui existait

Le repository possédait des tokens partiels dans `globals.css`, un AppShell
récent, des composants métier fonctionnels et des tests UI. Quatre langages
visuels continuaient toutefois de cohabiter :

1. l’app métier historique ;
2. le workspace assistant ;
3. l’authentification ;
4. les composants de feedback transversaux.

L’inventaire comprend 53 fichiers React de production. Il a relevé 191
fragments Tailwind avec valeurs entre crochets et 20 balises SVG inline dans
cinq fichiers. Storybook n’était pas installé.

## Ce qui a été normalisé

### Tokens

Une source officielle `tokens.css` couvre :

- couleurs de fond, surfaces, bordures, textes, marque, accent et statuts ;
- états hover, pressed, disabled, focus et overlay ;
- dix rôles typographiques ;
- grille d’espacement 4 à 96 px ;
- six rayons ;
- six niveaux d’ombre ;
- durées et courbes de mouvement ;
- géométrie des contrôles et icônes ;
- constantes de layout, breakpoints et couches.

`tokens.ts` fournit les références typées sans dupliquer les valeurs brutes.
Les alias historiques restent temporairement compatibles dans `globals.css`.

### Typographie

Les rôles Display, H1, H2, H3, Title, Body, Body Small, Caption, Label et Code
ont chacun taille, graisse, interligne et tracking. La primitive `Typography`
sépare rôle visuel et élément sémantique.

### Icônes

Lucide React est l’unique bibliothèque retenue. `Icon` normalise quatre tailles,
un trait de 1,75 et l’héritage de couleur. `IconButton` impose un libellé
accessible.

### Composants

- Boutons : Primary, Secondary, Ghost, Destructive, Link, Icon et Floating ;
- Champs : Input, Textarea, Search, Composer, Select, Combobox et Date ;
- Cartes : Info, Protection, Paiement, Client, Erreur, Success, Timeline,
  Résumé ;
- Badges : Neutral, Info, Success, Warning, Danger, Outline ;
- EmptyState unique ;
- Skeleton, Spinner, Progress, ComposerLoading, CardLoading et PageLoading.

Les états hover, focus, pressed, loading et disabled sont centralisés là où ils
s’appliquent. Les composants ne contiennent ni valeur chromatique brute, ni
taille Tailwind arbitraire, ni SVG inline, ni animation Phase 1.

## Accessibilité

- Focus visible unifié ;
- labels, aides et erreurs reliés aux champs ;
- `aria-invalid`, `aria-busy`, `role="alert"` et `role="status"` intégrés ;
- boutons icône nommés ;
- HTML sémantique et niveau de titre configurable ;
- couleurs principales vérifiées à au moins 4,5:1 ;
- tokens réduits sous `prefers-reduced-motion` ;
- documentation clavier, zoom, mobile et lecteur d’écran.

## Catalogue interne

Storybook étant absent, `DesignSystemCatalogue` expose les familles,
variantes, exemples métier et principaux états dans un composant interne non
routé. Aucune route ou page produit n’a été ajoutée.

## Audit et décisions

L’audit détaillé classe chacun des 53 fichiers en Conserver, Modifier,
Supprimer ou Fusionner. La majorité conserve son comportement métier mais devra
adopter les primitives officielles en Phase 2.

### Suppressions Phase 2

- `assistant/assistant-sidebar.tsx` : réexport déprécié ;
- `assistant/context-panel.tsx` : alias pur ;
- `assistant/suggestion-icons.tsx` : bibliothèque SVG locale remplacée par
  Lucide.

Aucun de ces fichiers n’est supprimé maintenant afin de préserver écrans,
imports et tests.

### Réutilisation Phase 2

- AppShell reste l’unique shell authentifié ;
- AppSidebar reste la navigation principale ;
- toutes les actions métier, validations et intégrations sont conservées ;
- les contrats de données des composants métier restent inchangés ;
- BrandLockup continue d’utiliser uniquement
  `/public/brand/sidian-logo.png`.

## Garde-fou

`pnpm design-system:check` vérifie :

- présence des tokens et documents obligatoires ;
- absence de couleurs brutes, pixels, millisecondes et valeurs Tailwind
  arbitraires dans les primitives ;
- absence de SVG inline et d’animation ;
- définition de chaque token consommé ;
- présence de Lucide React.

## Validation

| Commande | Résultat |
| --- | --- |
| `pnpm design-system:check` | Réussi — 151 tokens contrôlés |
| `pnpm test:design-system` | Réussi — 5 tests |
| `pnpm test:ui` | Réussi — 19 fichiers, 89 tests |
| `pnpm exec tsc --noEmit` | Réussi |
| `pnpm exec eslint src/design-system scripts/check-design-system.mjs` | Réussi |
| `pnpm build` | Réussi — Next.js 16.2.10 |

## Limitations volontaires

- Aucun écran existant n’utilise encore les nouvelles primitives.
- Le catalogue n’est pas monté dans une route.
- Aucune animation de composant n’est fournie ; seuls les motion tokens sont
  définis.
- La checkbox d’authentification reste une extension à formaliser avant sa
  migration.
- Les alias historiques et valeurs arbitraires existantes restent en place
  jusqu’à la Phase 2.
- L’évaluation visuelle finale du catalogue attend la validation de cette
  fondation.

## Fichiers Phase 1

### Créés

- `src/design-system/tokens.css`
- `src/design-system/tokens.ts`
- `src/design-system/utils.ts`
- `src/design-system/index.ts`
- `src/design-system/catalogue.tsx`
- `src/design-system/catalogue.module.css`
- `src/design-system/design-system.test.tsx`
- `src/design-system/components/*`
- `scripts/check-design-system.mjs`
- `docs/design-system/*`
- ce rapport

### Modifiés

- `src/app/globals.css` : import du socle et pont de compatibilité ;
- `package.json` : scripts de contrôle et dépendance Lucide ;
- `pnpm-lock.yaml` : verrouillage Lucide.

Le repository contenait déjà d’autres modifications non commitées avant cette
Phase 1. Elles ont été préservées et ne sont pas revendiquées dans ce rapport.

## Suite

La Phase 1 s’arrête ici. La migration UI de Phase 2 ne doit commencer qu’après
validation explicite de cette fondation.
