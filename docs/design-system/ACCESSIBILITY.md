# Accessibilité

## Niveau visé

Le design system vise WCAG 2.2 AA pour les usages applicatifs. Les primitives
réduisent les erreurs d’implémentation, mais chaque écran devra encore être
testé avec ses contenus, son ordre de tabulation et ses assemblages réels.

## Contrastes de référence

Les couples principaux ont été choisis pour dépasser 4,5:1 sur le texte normal :

| Usage | Premier plan / fond | Ratio |
| --- | --- | ---: |
| Texte principal | `#0d1117` / `#f7f8fb` | 17,82:1 |
| Texte secondaire | `#4b5563` / blanc | 7,56:1 |
| Texte atténué | `#6b7280` / blanc | 4,83:1 |
| Action primaire | blanc / `#315fd9` | 5,57:1 |
| Succès | `#047857` / `#ecfdf3` | 5,20:1 |
| Avertissement | `#92400e` / `#fffaeb` | 6,79:1 |
| Danger | `#b42318` / `#fef3f2` | 6,05:1 |
| Information | `#315fd9` / `#edf2ff` | 4,97:1 |

Le texte disabled n’est pas utilisé pour une information indispensable.

## Focus et clavier

- Tous les contrôles natifs restent atteignables au clavier.
- `:focus-visible` emploie un anneau bleu de 2 px avec offset de 2 px.
- Aucun focus n’est supprimé sans remplacement visible.
- Les boutons icône exigent un nom accessible.
- Une action indisponible utilise l’attribut `disabled` ou
  `aria-disabled`, pas seulement une opacité.
- L’ordre DOM doit suivre l’ordre de lecture ; aucune correction visuelle par
  `tabIndex` positif.

## Formulaires

- Label visible relié par `htmlFor` et `id`.
- Aide et erreur reliées par `aria-describedby`.
- Erreur annoncée avec `role="alert"` et formulation actionnable.
- Required est transmis nativement et signalé visuellement.
- Le placeholder ne remplace jamais un label.
- Les inputs date et select restent natifs pour préserver les affordances de la
  plateforme.

## États asynchrones

- Les attentes localisées utilisent `role="status"` et `aria-live="polite"`.
- Les boutons loading exposent `aria-busy` et sont désactivés.
- Les squelettes sont `aria-hidden`.
- Une progression déterminée utilise l’élément `progress` avec un label.
- Le contenu final remplace l’état loading sans déplacer le focus.

## Mouvement

Sous `prefers-reduced-motion: reduce`, les durées deviennent quasi nulles. La
fondation Phase 1 ne fournit aucune animation de composant. Une animation ne
doit jamais être nécessaire pour comprendre un changement d’état.

## Responsive et mobile

- Cible tactile minimale : 40 px, 44 px privilégié.
- Les safe areas seront appliquées aux drawers et sheets lors de leur
  assemblage Phase 2.
- Le zoom navigateur ne doit pas être désactivé.
- Le contenu doit fonctionner à 320 px de largeur et à 200 % de zoom.
- Les overlays devront piéger le focus, restaurer le focus au déclencheur et
  répondre à Échap.

## Checklist d’intégration

- Un seul H1 et une hiérarchie de headings continue.
- Landmark `main` unique et navigation nommée.
- Nom, rôle, valeur corrects pour chaque contrôle.
- Aucun statut transmis uniquement par couleur.
- Texte d’erreur non technique.
- Test clavier complet.
- Vérification VoiceOver ou NVDA.
- Vérification contraste avec le contenu réel.
- Vérification à 200 % de zoom et en réduction de mouvement.
