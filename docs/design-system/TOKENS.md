# Référence des tokens

## Source et nommage

`src/design-system/tokens.css` est l’unique source de valeurs. Les noms suivent
`--ds-{famille}-{rôle}`. `tokens.ts` ne duplique aucune valeur : il expose des
références typées vers ces variables.

Les alias `--sidian-*` de `globals.css` sont une couche de compatibilité
temporaire. Ils restent nécessaires aux écrans existants mais ne sont pas
autorisés dans un nouveau composant du design system.

## Couleurs

| Rôle | Token | Valeur |
| --- | --- | --- |
| Fond app | `--ds-color-background` | `#f7f8fb` |
| Surface | `--ds-color-surface` | blanc |
| Surface élevée | `--ds-color-surface-raised` | blanc |
| Surface atténuée | `--ds-color-surface-muted` | `#eef0f4` |
| Bordure | `--ds-color-border` | `#e3e6ec` |
| Bordure forte | `--ds-color-border-strong` | `#cbd0da` |
| Texte principal | `--ds-color-text-primary` | `#0d1117` |
| Texte secondaire | `--ds-color-text-secondary` | `#4b5563` |
| Texte atténué | `--ds-color-text-muted` | `#6b7280` |
| Bleu de marque | `--ds-color-brand` | `#3b6df8` |
| Accent interactif | `--ds-color-accent` | `#315fd9` |

Le bleu de marque sert aux éléments identitaires ou décoratifs non textuels.
L’accent interactif, plus sombre, est utilisé par les boutons et liens afin de
conserver un contraste AA avec le texte blanc.

Chaque statut possède trois tokens : foreground, surface et bordure.

- Success : confirmation ou résultat achevé.
- Warning : vérification ou risque non bloquant.
- Danger : erreur, perte possible ou action destructive.
- Info : contexte utile sans gravité.

## Interactions

- Hover : changement léger de surface ou d’accent.
- Pressed : surface plus marquée et translation de 1 px pour les boutons.
- Disabled : surface et texte dédiés, avec interaction réellement désactivée.
- Focus : anneau bleu de 2 px avec offset de 2 px.
- Overlay : voile dérivé du texte principal, jamais du noir pur.

## Typographie, espacement et layout

Les tables complètes sont dans `TYPOGRAPHY.md` et `SPACING.md`. Aucun composant
ne définit localement une taille de texte, un espacement, un rayon, une largeur
structurante ou une icône.

## Élévation

| Niveau | Usage |
| --- | --- |
| none | Surface intégrée |
| xs | Séparation minimale |
| sm | Carte élevée ou composer |
| md | Bouton flottant, menu |
| lg | Drawer ou sheet |
| xl | Modal majeure |

Les ombres sont froides et diffuses. Bordure et grande ombre ne sont pas
combinées par défaut.

## Mouvement

| Token | Valeur | Usage |
| --- | ---: | --- |
| `--ds-duration-fast` | 120 ms | Hover, focus, pressed |
| `--ds-duration-normal` | 180 ms | Apparition d’un petit élément |
| `--ds-duration-slow` | 280 ms | Drawer, sheet, changement spatial |

Easings : standard, entrance, exit, emphasis. Les durées deviennent quasi
nulles avec `prefers-reduced-motion`; les animations continues sont supprimées.

## Z-index

Les couches officielles sont : base 0, sticky 10, dropdown 20, overlay 40,
modal 50, toast 60, tooltip 70. Aucun composant ne crée un nombre local.

## Modification d’un token

Un changement est recevable seulement si :

1. le besoin concerne plusieurs composants ;
2. le nom décrit un rôle stable ;
3. le contraste et les états sont vérifiés ;
4. la documentation, le catalogue et les tests sont mis à jour ;
5. la migration des alias historiques est évaluée séparément.
