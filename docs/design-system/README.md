# Sidian Design System

## Statut

Cette fondation est la source officielle de l’interface Sidian à partir de la
Phase 1. Elle définit le langage visuel commun sans migrer les écrans existants.
La migration des pages et composants applicatifs reste volontairement réservée
à la Phase 2, après validation humaine de ce socle.

## Principes

1. **Clarté financière** : l’information utile et la prochaine action priment.
2. **Calme visuel** : fond gris très clair, surfaces blanches, bordures fines,
   ombres diffuses et accent bleu limité aux interactions importantes.
3. **Sémantique avant décoration** : succès, avertissement et danger décrivent
   un état réel ; ils ne servent jamais à décorer.
4. **Une seule grammaire** : un token ou une primitive officielle remplace
   toute valeur locale équivalente.
5. **Accessibilité structurelle** : HTML sémantique, labels visibles, focus
   perceptible, contrastes AA et réduction des mouvements sont intégrés aux
   primitives.
6. **Aucune logique métier cachée** : les composants de fondation présentent
   des données et des actions ; ils ne déclenchent ni Stripe, ni Supabase, ni
   workflow.

## Architecture

| Source | Rôle |
| --- | --- |
| `src/design-system/tokens.css` | Valeurs primitives et sémantiques officielles |
| `src/design-system/tokens.ts` | Références typées `var(--ds-*)` |
| `src/design-system/components/` | Primitives React et modules CSS |
| `src/design-system/catalogue.tsx` | Catalogue interne exécutable, non routé |
| `src/design-system/design-system.test.tsx` | Contrats de rendu et d’accessibilité |
| `scripts/check-design-system.mjs` | Garde-fou tokens, icônes et valeurs arbitraires |

`src/app/globals.css` importe le fichier officiel et conserve temporairement les
anciens alias `--sidian-*`. Cette couche de compatibilité protège le rendu
actuel. Elle n’est pas une seconde source : ses valeurs héritées sont à migrer
selon l’audit de composants.

## Règles de consommation

- Importer les primitives depuis `@/design-system`.
- Utiliser uniquement des variables `--ds-*` dans les nouveaux modules CSS.
- Ne pas ajouter de couleur hexadécimale, durée en millisecondes ou taille en
  pixels dans un composant.
- Ne pas utiliser de valeur Tailwind arbitraire pour contourner un token.
- Utiliser `lucide-react` via la primitive `Icon`; aucun SVG inline.
- Choisir un rôle typographique (`h1`, `bodySmall`, `label`) selon le sens du
  contenu, jamais selon la taille souhaitée.
- Ne pas modifier un token pour corriger un écran isolé. Ajouter ou adapter une
  primitive si le besoin est récurrent et documenté.

Exemple :

```tsx
import { Button, PaymentCard, Typography } from "@/design-system";

export function PaymentSummary() {
  return (
    <PaymentCard title="Paiement attendu">
      <Typography variant="h2">2 400 €</Typography>
      <Button>Préparer le lien</Button>
    </PaymentCard>
  );
}
```

## Catalogue interne

Storybook n’est pas installé dans le repository. Le composant
`DesignSystemCatalogue` présente donc toutes les familles et leurs principaux
états sans ajouter de route produit. Il peut être monté dans un environnement
interne en Phase 2, après validation de la fondation.

## Validation

```bash
pnpm design-system:check
pnpm test:design-system
pnpm test:ui
pnpm exec tsc --noEmit
pnpm build
```

Toute modification du socle doit mettre à jour les tests et la documentation
associée.
