# Guide des composants

## Icônes

`lucide-react` est l’unique bibliothèque officielle. La primitive `Icon`
normalise les tailles `xs` 14, `sm` 16, `md` 20 et `lg` 24 px et un trait de
1,75. Une icône hérite de `currentColor` : texte secondaire par défaut, texte
principal au hover, bleu accent à l’état actif et couleur disabled lorsque son
contrôle est désactivé. Les états interactifs appartiennent au contrôle parent,
jamais à une icône isolée. Toute action représentée uniquement par une icône
doit utiliser `IconButton` avec un `label` accessible. Les SVG inline et les
bibliothèques concurrentes sont interdits.

## Boutons

| Variante | Usage |
| --- | --- |
| Primary | Action principale unique d’un groupe |
| Secondary | Action alternative visible |
| Ghost | Action de faible priorité |
| Destructive | Action irréversible ou suppression |
| Link | Navigation intégrée à une phrase ou une carte |
| Floating | Déclencheur isolé clairement identifié |

Tailles : `sm` 36 px, `md` 40 px, `lg` 44 px.

Tous les boutons possèdent les états default, hover, pressed, focus, disabled
et loading. `loading` désactive l’action, conserve un libellé explicite et
expose `aria-busy`. Un groupe ne doit pas présenter plusieurs boutons Primary.

## Inputs

Primitives officielles :

- `Input` ;
- `Textarea` ;
- `SearchInput` ;
- `Select` natif ;
- `Combobox` progressive-enhancement fondée sur `datalist` ;
- `DateInput` natif ;
- `Composer`, textarea haute dédiée à l’agent.

Chaque champ exige un label visible. `hint` et `error` sont reliés par
`aria-describedby`; `error` active `aria-invalid` et un message `role="alert"`.
Les erreurs utilisent un langage utilisateur. Elles n’exposent ni RPC, ni
Supabase, ni code interne.

Le Composer de fondation possède une hauteur confortable, une surface blanche,
une ombre légère et le placeholder produit recommandé :
« Demande quelque chose à Sidian… ». Les contrôles d’envoi, suggestions et
pièces jointes appartiendront à l’assemblage Phase 2.

## Cartes

Une primitive `Card` partage structure, densité et élévation. Ses variantes ne
portent aucune logique métier :

- `InfoCard` : contexte utile ;
- `ProtectionCard` : état ou préparation de protection ;
- `PaymentCard` : paiement ou échéance ;
- `ClientCard` : synthèse client ;
- `ErrorCard` : échec compréhensible et action de reprise ;
- `SuccessCard` : confirmation ;
- `TimelineCard` : séquence chronologique ;
- `SummaryCard` : synthèse ou briefing.

`flat` combine surface et bordure. `raised` emploie une ombre douce sans
double encadrement. `compact` réduit uniquement le padding. Une carte ne doit
pas devenir un conteneur générique autour de chaque texte.

## Badges

Tons : neutral, info, success, warning, danger, outline. Les tons sémantiques
communiquent un statut réel et conservent un libellé texte ; la couleur seule
ne suffit jamais.

## Empty State

`EmptyState` compose illustration optionnelle, titre, description et une action
maximum. Le texte explique :

1. ce qui manque ;
2. pourquoi c’est normal ou utile ;
3. comment progresser, si une action existe.

Une liste filtrée sans résultat ne réutilise pas nécessairement l’empty state
de première utilisation : son titre doit refléter le filtre.

## Loading

- `Spinner` : attente locale courte avec libellé ;
- `Skeleton` : géométrie stable d’un contenu imminent ;
- `Progress` : progression déterminée ;
- `CardLoading` : carte ;
- `ComposerLoading` : réponse de Sidian ;
- `PageLoading` : structure de page.

Les zones en chargement exposent `role="status"` et un nom accessible. Les
squelettes sont masqués aux technologies d’assistance. Conformément au
périmètre Phase 1, le Spinner fournit structure et géométrie mais aucune
animation ; une éventuelle rotation sera décidée et documentée après validation
des seuls motion tokens.

## Motion

Les durées officielles sont 120, 180 et 280 ms. Les easings couvrent standard,
entrée, sortie et emphase. La fondation ne prescrit aucune animation
décorative. Le mouvement sert uniquement à :

- confirmer un changement d’état ;
- préserver la continuité spatiale ;
- indiquer une attente ;
- ouvrir ou fermer un overlay.

Toute transition doit consommer les tokens et fournir une variante
`prefers-reduced-motion`.
