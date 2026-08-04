# Guide d’espacement et de layout

## Échelle officielle

La grille de base est de 4 px. Aucun espacement intermédiaire n’est ajouté dans
un composant.

| Token | Valeur | Usage fréquent |
| --- | ---: | --- |
| `--ds-space-1` | 4 px | Micro-écart, soulignement |
| `--ds-space-2` | 8 px | Icône + libellé, éléments liés |
| `--ds-space-3` | 12 px | Groupe compact, padding de champ |
| `--ds-space-4` | 16 px | Espacement standard |
| `--ds-space-5` | 20 px | Padding de carte |
| `--ds-space-6` | 24 px | Groupe de section |
| `--ds-space-8` | 32 px | Séparation forte |
| `--ds-space-10` | 40 px | Gouttière desktop |
| `--ds-space-12` | 48 px | Grande séparation |
| `--ds-space-16` | 64 px | Respiration de page |
| `--ds-space-20` | 80 px | Moment éditorial rare |
| `--ds-space-24` | 96 px | Hauteur confortable du composer |

## Règles

- 4–8 px : relation très forte.
- 12–20 px : contenu d’un même composant.
- 24–32 px : groupes d’une même section.
- 40–64 px : sections distinctes.
- Les cartes utilisent 20 px par défaut et 16 px en densité compacte.
- Les champs placent 8 px entre label, contrôle et aide.
- Les zones tactiles interactives font au minimum 40 px ; 44 px est préféré
  sur mobile.

## Constantes de layout

| Token | Valeur | Rôle |
| --- | ---: | --- |
| `--ds-layout-sidebar-width` | 224 px | Sidebar desktop compacte |
| `--ds-layout-content-width` | 1184 px | Contenu applicatif large |
| `--ds-layout-conversation-width` | 640 px | Colonne de conversation |
| `--ds-layout-panel-width` | 376 px | Panneau métier desktop |
| `--ds-layout-drawer-width` | 480 px | Drawer large |
| `--ds-layout-rail-width` | 280 px | Rail secondaire |
| `--ds-layout-search-width` | 280 px | Recherche compacte |
| `--ds-layout-container-width` | 1184 px | Conteneur principal |

Gouttières : 16 px mobile, 24 px tablette, 40 px desktop.

Breakpoints officiels :

- `sm` : 640 px ;
- `md` : 768 px ;
- `lg` : 1024 px ;
- `xl` : 1280 px.

Les variables CSS ne sont pas utilisables directement dans une condition
`@media`. Les modules CSS peuvent donc répéter exactement une valeur de
breakpoint officielle, et uniquement celle-ci.

## Rayons

| Token | Valeur | Usage |
| --- | ---: | --- |
| `sm` | 8 px | Petit contrôle |
| `md` | 10 px | Bouton et champ |
| `lg` | 12 px | Carte |
| `xl` | 16 px | Composer, grand panneau |
| `2xl` | 20 px | Surface exceptionnelle |
| `pill` | maximal | Badge ou bouton flottant circulaire |

Le rayon exprime la famille du composant. Il ne sert pas à créer des
« cartes dans des cartes ».

## Ombres

Les niveaux `xs`, `sm`, `md`, `lg`, `xl` progressent d’un filet de profondeur à
un overlay majeur. Une surface avec bordure utilise généralement `none` ou
`xs`. Une surface flottante utilise `md` ou `lg`. Les ombres ne remplacent pas
la hiérarchie d’espacement.
