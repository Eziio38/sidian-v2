# Guide typographique

## Familles

- **Interface** : Outfit, chargée par Next Font, puis `system-ui`.
- **Code et identifiants techniques autorisés** : SF Mono, Consolas,
  Liberation Mono, puis `monospace`.

Aucune autre police ne doit être chargée dans un composant.

## Rôles officiels

| Rôle | Taille | Graisse | Interligne | Usage |
| --- | ---: | ---: | ---: | --- |
| Display | 40 px | 600 | 1.10 | Moment d’accueil rare ou chiffre héro |
| H1 | 32 px | 600 | 1.20 | Titre unique de page |
| H2 | 24 px | 600 | 1.25 | Section majeure, montant prioritaire |
| H3 | 20 px | 600 | 1.30 | Sous-section ou panneau |
| Title | 16 px | 600 | 1.40 | Titre de carte ou de groupe |
| Body | 14 px | 400 | 1.50 | Contenu et explications principales |
| Body Small | 13 px | 400 | 1.50 | Métadonnées et détails secondaires |
| Caption | 12 px | 400 | 1.40 | Horodatage, aide très courte |
| Label | 12 px | 500 | 1.30 | Label de champ, badge, libellé compact |
| Code | 13 px | 500 | 1.50 | Identifiant ou valeur technique interne |

Les tailles en pixels du tableau sont des équivalences documentaires. Le code
utilise les tokens en `rem`.

## Hiérarchie

- Une page possède un seul H1.
- H2 et H3 suivent l’ordre du document ; une apparence plus petite ne justifie
  jamais de sauter un niveau.
- `Display` n’est pas un niveau de titre. Utiliser `as="h1"` seulement si le
  contenu est réellement le titre principal.
- `Title` ne remplace pas un heading quand une section doit être navigable.
- Les textes d’action utilisent Body en graisse 600 via la primitive Button.
- Les montants conservent des chiffres lisibles et une unité explicite.

## Ton et largeur

- Texte principal : `--ds-color-text-primary`.
- Texte secondaire : `--ds-color-text-secondary`.
- Texte atténué : `--ds-color-text-muted`, jamais pour une information
  indispensable.
- Les paragraphes explicatifs sont limités à `--ds-prose-width` (65 caractères
  environ) pour préserver la lecture.
- Éviter les capitales intégrales. Les labels utilisent la casse phrase.
- Ne pas employer l’italique pour transmettre un statut.

## API

La primitive `Typography` accepte :

- `variant` : `display`, `h1`, `h2`, `h3`, `title`, `body`, `bodySmall`,
  `caption`, `label`, `code` ;
- `tone` : `primary`, `secondary`, `muted`, `inverse` ;
- `as` : surcharge sémantique explicite.

Le composant choisit par défaut `h1`, `h2` ou `h3` pour les rôles
correspondants et un élément neutre pour les autres.
