# SIDIAN_UI_PATTERNS.md

# Source des patterns UI Sidian : rôles de page, composition, App Shell, layout 3 colonnes, zones, scroll et hiérarchie.

# Ce fichier définit comment assembler les pages métier. Il ne définit pas les couleurs, la typographie, les espacements, les rayons, les tailles ou les icônes.

# Les tokens de design vivent uniquement dans SIDIAN_DESIGN_SYSTEM.md.

# Avant tout batch UI, lire SIDIAN_UI_PATTERNS.md et SIDIAN_DESIGN_SYSTEM.md ensemble.

---

## Règle d'or — rôle de page avant composants

Toute page métier Sidian doit d'abord choisir son rôle :

- Dashboard : analyse opérationnelle ;
- Contrats : gestion du portefeuille ;
- Détail contrat : preuve du suivi Sidian ;
- Notifications : événements et actions.

Puis seulement ensuite choisir ses composants.

## App Shell — Layout 3 colonnes

### Objectif

Définir la structure standard des pages métier Sidian.

Le layout de référence desktop est :

`[ Sidebar fixe ] [ Colonne centrale : header fixe + zone de contenu scrollable ] [ Rail droit sticky ]`

Le contenu central n'est pas scrollable dans son ensemble : seule la zone de
liste / contenu répétitif scrolle. Le header de page, le CTA, et toute
zone de pilotage (toolbar, workflow) au-dessus de la liste restent fixes.
Voir « Scroll behavior » plus bas.

Ce layout doit être utilisé pour :

- Dashboard ;
- Contrats ;
- Clients si pertinent ;
- Transactions si pertinent.

### Structure générale

Desktop app shell :

`[ Sidebar fixe ] [ Colonne centrale : header fixe + zone de contenu scrollable ] [ Rail droit sticky ]`

Règles :

- la sidebar reste toujours visible ;
- le contenu central est la zone principale de travail ;
- la colonne centrale ne scrolle pas entièrement ;
- le header de page (titre, sous-titre) est fixe dans la colonne centrale ;
- le CTA principal est fixe dans le header ;
- les contrôles de pilotage restent visibles ;
- la toolbar (recherche / filtre / tri) est fixe lorsqu'elle pilote une liste ;
- le workflow / la carte de pilotage (ex. funnel paiements) est fixe lorsqu'il sert de repère de lecture ;
- seules les zones de liste / contenu répétitif scrollent ;
- ne pas faire scroller le titre, le CTA ou les contrôles principaux ;
- le rail droit donne du contexte, jamais des actions principales ;
- le rail droit reste aligné en haut et sticky ;
- la page ne doit pas créer une nouvelle grille arbitraire.

### Sidebar

Rôle : navigation produit.

Contenu :

- Dashboard ;
- Contrats ;
- Clients ;
- Transactions ;
- profil en bas.

Règles :

- largeur fixe ;
- pas de collapse desktop pour le MVP ;
- pas de contenu métier dans la sidebar ;
- notifications et paramètres peuvent vivre dans le menu profil ;
- la sidebar ne doit pas influencer la largeur du contenu central.

### Contenu central

Rôle : zone de lecture et de travail principale.

Règles :

- largeur stable entre les pages ;
- padding horizontal identique entre Dashboard, Contrats et pages métier ;
- header page en haut ;
- CTA principal aligné top-right ;
- liste / workflow / table alignés dans la même grille ;
- ne pas étirer les éléments pour remplir artificiellement l'espace.

Le contenu central est divisé en deux zones :

#### A. Zone statique

Elle contient :

- titre ;
- sous-titre ;
- CTA ;
- toolbar si elle pilote une liste ;
- bloc de pilotage principal si nécessaire.

#### B. Zone scrollable

Elle contient :

- listes ;
- rows ;
- tables ;
- contenus longs répétitifs.

Exemples dashboard :

- header fixe ;
- workflow des paiements fixe ;
- liste des paiements scrollable.

Exemples contrats :

- header fixe ;
- toolbar recherche / filtre / tri fixe ;
- liste des contrats scrollable.

### Rail droit

Rôle : contexte synthétique.

Le rail droit ne doit jamais être :

- une seconde page ;
- un mini-dashboard ;
- une zone d'actions principales ;
- une liste d'alertes détaillées ;
- une zone qui concurrence le contenu central.

Il doit afficher :

- KPI de contexte ;
- synthèse portefeuille ;
- couverture ;
- répartition ;
- raccourcis très secondaires si nécessaire.

Règles visuelles :

- largeur fixe identique entre les pages ;
- sticky ;
- aligné avec le haut du contenu central ;
- même radius que les cards du dashboard ;
- même padding ;
- mêmes séparateurs ;
- hauteur suffisante pour paraître intégré ;
- pas de petite card isolée posée à droite.

### Scroll behavior

Le scroll doit être prévisible :

- sidebar : fixe ;
- rail droit : sticky ou fixe dans son espace ;
- header de page : fixe dans la colonne centrale ;
- CTA principal : fixe avec le header ;
- toolbar : fixe lorsqu'elle pilote une liste ;
- workflow Dashboard : fixe lorsqu'il sert de repère de lecture ;
- liste : scrollable ;
- éviter les doubles scrollbars visibles.

Exemple dashboard :

- header fixe ;
- CTA fixe ;
- workflow fixe ;
- liste des paiements scrollable.

Exemple contrats :

- header fixe ;
- CTA fixe ;
- toolbar recherche / filtre / tri fixe ;
- liste des contrats scrollable.

### Largeurs et gaps

Définir un système stable :

- Sidebar : largeur fixe existante validée.
- Main content : largeur fluide mais contrainte.
- Right rail : largeur fixe identique au dashboard.
- Gap main / rail : 24px.
- Padding page : 24-32px selon breakpoint.
- Toutes les pages avec rail doivent utiliser le même wrapper.

Important :

- La page Contrats doit reprendre la même largeur utile que le Dashboard.
- Aucune page ne doit inventer une largeur ou un rail différent sans décision explicite.

### CTA principal

Le CTA principal doit toujours être :

- dans le header de la page ;
- aligné top-right de la zone utile ;
- bleu Sidian ;
- unique sur la page ;
- même hauteur / radius / padding.

Exemple : `Sécuriser un contrat`

Ne pas :

- placer le CTA dans le rail droit ;
- créer plusieurs CTA bleus concurrents.

### Différence entre les pages

#### Dashboard

Rôle : analyse opérationnelle.

Question : où en sont mes paiements ?

Main content :

- header fixe ;
- workflow des paiements fixe ;
- liste des paiements scrollable.

Rail :

- portefeuille protégé.

#### Contrats

Rôle : gestion du portefeuille.

Question : quels contrats sont enregistrés et dans quel état ?

Main content :

- header fixe ;
- toolbar fixe ;
- liste des contrats scrollable.

Rail :

- portefeuille de contrats ;
- clients ;
- contrats ;
- répartition.

Important :

- La page Contrats ne doit pas devenir un second Dashboard.
- Le Dashboard ne doit pas devenir une liste de gestion.

### Responsive

Desktop :

- sidebar + main + rail.

Tablette :

- sidebar réduite ou conservée selon breakpoint ;
- rail peut passer sous le contenu si manque de largeur.

Mobile :

- pas de rail droit ;
- contenu en une colonne ;
- KPI contextuels peuvent devenir une section compacte ;
- drawers adaptés mobile séparément.

Ne pas improviser le mobile sans validation.

### Do / Don't

DO :

- réutiliser le même App Shell ;
- garder le rail droit cohérent ;
- aligner les CTA ;
- garder le scroll dans la zone de liste / contenu répétitif ;
- utiliser le rail uniquement pour le contexte.

DON'T :

- créer une grille différente par page ;
- mettre des actions importantes dans le rail ;
- faire du rail une inbox ;
- faire une searchbox pleine largeur sans raison ;
- étirer la liste pour combler l'espace ;
- ajouter des cards uniquement pour remplir ;
- faire scroller le titre de page ;
- faire scroller le CTA principal ;
- faire scroller la toolbar qui pilote une liste ;
- faire scroller le workflow Dashboard avec la liste ;
- transformer toute la colonne centrale en une zone scrollable.
