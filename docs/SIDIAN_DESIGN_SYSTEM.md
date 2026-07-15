# SIDIAN_DESIGN_SYSTEM.md

# Source des tokens visuels Sidian : couleurs, typographie, espacements, tailles, poids, rayons, icônes et densité.

# Ce fichier définit les valeurs de référence. Il ne définit pas la composition des pages, le layout 3 colonnes, les rôles de page ou les comportements de scroll.

# Les règles de composition, d'App Shell et de layout 3 colonnes vivent uniquement dans SIDIAN_UI_PATTERNS.md.

# Avant tout batch UI, lire SIDIAN_DESIGN_SYSTEM.md et SIDIAN_UI_PATTERNS.md ensemble.

---

## 1. Logo

- Pictogramme : l'entrelacs — deux boucles liées, l'engagement qui tient.
- Fichiers : `/public/brand/sidian-mark-blue.png` · `/public/brand/sidian-mark-white.png` (détourés, fond transparent, 156 px — source vectorielle SVG à récupérer, TODO).
- Couleur du mark : Sidian Blue #3B6DF8 sur TOUS les fonds, y compris Nuit. Variante blanche uniquement si le fond rend le bleu illisible (photo, visuel chargé).
- Lockup : mark + « Sidian » en Outfit ExtraBold (800), letter-spacing -0.02em. Le mot est TOUJOURS du texte rendu en Outfit, jamais une image. Espace mark↔texte : ~40 % de la hauteur du mark.
- Zone de protection : 25 % de la hauteur du mark sur chaque côté.
- Taille minimale : 20 px. Favicon : à valider en 16 px (variante simplifiée si besoin). Next.js : `app/icon.png` (32 px) · `app/apple-icon.png` (180 px).

---

## 2. Couleurs

### Marque


| Token       | Hex     | Usage                                                                                   |
| ----------- | ------- | --------------------------------------------------------------------------------------- |
| Sidian Blue | #3B6DF8 | Primaire : actions, liens, états actifs, graphique                                      |
| Ciel        | #6B96FA | Accent clair — SEUL bleu autorisé sur fond sombre (accents UI ; le logo fait exception) |
| Brume       | #EDF2FF | Fonds teintés clairs, halos, badges brand                                               |
| Nuit        | #0D1117 | Ancre sombre : texte fort, marketing/landing                                            |
| Ardoise     | #1D2535 | Sombre secondaire (hover du Nuit)                                                       |


### Sémantiques


| Token  | Hex     | Fond teinté |
| ------ | ------- | ----------- |
| Succès | #059669 | #ECFDF3     |
| Alerte | #D97706 | #FFFAEB     |
| Danger | #DC2626 | #FEF3F2     |


### Gris froids


| Token          | Hex     | Usage                                            |
| -------------- | ------- | ------------------------------------------------ |
| gris-50        | #F7F8FB | Fond sidebar, hover de rows                      |
| gris-100       | #EEF0F4 | Traits de séparation, fonds neutres              |
| gris-200       | #E3E6EC | Borders (popovers, modals, inputs)               |
| gris-300       | #CBD0DA | Borders de nœuds inactifs, dots neutres          |
| gris-400       | #9AA1AE | Texte tertiaire, placeholders, dots "en attente" |
| gris-500       | #6B7280 | Texte secondaire, headers de table, labels       |
| gris-600       | #4B5563 | Texte secondaire appuyé                          |
| Texte primaire | #0D1117 | = Nuit                                           |


## Color System

Les couleurs Sidian ne doivent jamais être choisies librement dans les composants. Chaque couleur a un rôle produit précis et doit rester cohérente entre le dashboard, les pages métier, les drawers, les popovers et les emails.

- **Sidian Blue** est réservé aux actions principales, liens actifs, états actifs et focus rings.
- **Ciel** est l'accent bleu lisible sur fond sombre. Il peut remplacer Sidian Blue en dark mode lorsque le contraste est meilleur.
- **Brume** sert uniquement aux fonds brand très légers en light mode.
- **Nuit** structure les textes forts et les fonds sombres premium.
- **Ardoise** est la surface sombre secondaire.
- **Succès** n'est pas décoratif : uniquement validé, activé, payé, terminé.
- **Alerte** signale une attention nécessaire mais pas un risque bloquant.
- **Danger** est réservé aux vraies erreurs, risques, suppressions ou blocages.
- Les avatars client utilisent des pastels neutres et déterministes. Ils ne portent jamais de signification de statut.

### Light Mode

#### Backgrounds et surfaces

- App background : blanc, ou gris-50 uniquement pour les zones de navigation ou de respiration.
- Sidebar : gris-50 / blanc légèrement teinté, jamais bleu décoratif.
- Contenu principal : blanc.
- Cards : blanc + border gris-200 + shadow douce si une séparation premium est nécessaire.
- Séparateurs : gris-100.
- Rows : blanc, hover gris-50.
- Popovers : blanc + border gris-200 + shadow douce.
- Drawers : blanc.

#### Texte

- Texte principal : Nuit #0D1117.
- Texte secondaire : gris-500.
- Texte tertiaire, placeholders, méta : gris-400.
- Les montants importants utilisent Nuit + `tabular-nums`.

#### Actions et focus

- CTA principal : Sidian Blue #3B6DF8.
- Hover CTA : bleu légèrement plus dense, sans changer de famille chromatique.
- Liens : Sidian Blue.
- Focus ring : Sidian Blue avec faible opacité.
- Ne jamais utiliser le bleu pour une décoration sans action, focus ou état actif.

#### États

- Succès : uniquement pour validé / activé / payé / terminé.
- Alerte : attention, préavis, action à surveiller.
- Danger : erreur, risque réel, suppression, prélèvement bloqué ou action destructive.

### Dark Mode

Le dark mode Sidian doit rester calme, haut de gamme et lisible. Il ne doit pas être noir pur partout.

#### Backgrounds et surfaces

- Fond principal : Nuit #0D1117 ou équivalent très sombre.
- Surface card : Ardoise #1D2535 ou surface sombre proche.
- Surface muted : sombre secondaire légèrement plus clair que le fond.
- Sidebar : légèrement différente du contenu principal pour préserver la profondeur.
- Popovers/drawers : surface sombre légèrement plus claire que le fond.
- Éviter les glows. En dark mode, l'élévation vient surtout des niveaux de surface et des borders.

#### Texte

- Texte principal : blanc cassé / gris très clair.
- Texte secondaire : gris-300 ou gris-400.
- Texte tertiaire : gris-500.
- Borders : sombres, subtils, jamais blancs agressifs.

#### Actions et focus

- Sidian Blue peut rester le CTA principal si le contraste est suffisant.
- Ciel #6B96FA est l'accent recommandé sur fond sombre.
- CTA principal : visible, premium, jamais fluorescent.
- Focus ring : Ciel ou Sidian Blue avec opacité contrôlée.

#### États

- Succès : vert désaturé, jamais fluo.
- Alerte : orange désaturé.
- Danger : rouge désaturé.
- Les fonds teintés light (`#ECFDF3`, `#FFFAEB`, `#FEF3F2`) ne doivent pas être réutilisés tels quels en dark mode. Utiliser des versions sombres teintées.

### Mode-aware Tokens

| Usage | Light | Dark |
| --- | --- | --- |
| App background | #FFFFFF / gris-50 | Nuit #0D1117 |
| Sidebar background | gris-50 / blanc teinté | Nuit / Ardoise |
| Surface card | #FFFFFF | Ardoise #1D2535 ou surface sombre proche |
| Surface muted | gris-50 | sombre secondaire |
| Border default | gris-200 | border sombre subtile |
| Divider | gris-100 | blanc à très faible opacité |
| Text primary | Nuit #0D1117 | gris très clair / blanc cassé |
| Text secondary | gris-500 | gris-300 / gris-400 |
| Text tertiary | gris-400 | gris-500 |
| CTA primary | Sidian Blue #3B6DF8 | Sidian Blue ou Ciel |
| Link active | Sidian Blue | Ciel |
| Focus ring | Sidian Blue faible opacité | Ciel faible opacité |
| Success text | Succès #059669 | Succès désaturé |
| Warning text | Alerte #D97706 | Alerte désaturé |
| Danger text | Danger #DC2626 | Danger désaturé |
| Popover | blanc + border gris-200 + shadow | surface sombre + border subtile |
| Drawer | blanc | surface sombre premium |

Si des variables CSS existent dans le projet, elles doivent pointer vers ces rôles plutôt que vers des usages visuels ponctuels. Ne pas inventer de nouveaux tokens dans le code sans les documenter ici.

### Component Color Rules

#### Buttons

- Primaire : bleu uniquement pour l'action principale de l'écran.
- Secondaire light : blanc ou gris très clair, border gris-200.
- Secondaire dark : surface sombre secondaire, border subtile.
- Disabled light : gris clair, texte gris-400.
- Disabled dark : sombre désaturé, texte gris-500.
- Un écran ne doit pas multiplier les CTA bleus concurrents.

#### Badges

- Gris : attente, neutre, information non prioritaire.
- Vert : activé, OK, payé, terminé.
- Orange : attention, préavis, surveillance.
- Rouge : risque, erreur, blocage, action destructive.
- Ne jamais afficher deux badges verts redondants sur une même ligne.

#### Avatars

- Pastels neutres en light mode.
- Versions légèrement désaturées en dark mode.
- Couleur déterministe selon le nom client.
- Ne jamais utiliser rouge, orange ou vert comme indicateur de statut.
- Les statuts doivent être exprimés par badges, labels ou icônes dédiées, pas par l'avatar.

#### Rows

- Light : blanc, hover gris-50.
- Dark : surface sombre, hover légèrement plus clair.
- État actif : accent discret, jamais grande surface saturée.
- Une row ne doit pas combiner plusieurs couleurs de statut.

#### Rails

- Light : card blanche, border gris-200, shadow douce si nécessaire.
- Dark : surface sombre avec border subtile.
- Le rail ne doit pas porter de couleurs décoratives.
- Les compteurs du rail utilisent gris par défaut, rouge/orange uniquement si action réelle.

#### Cards

- Light : blanc + border gris-200 + shadow douce.
- Dark : surface sombre + border subtile, shadow minimale.
- Les cards importantes peuvent utiliser l'élévation, pas une couleur de fond vive.
- Éviter les aplats gris massifs dans le contenu principal.

#### Drawers

- Light : blanc.
- Dark : surface sombre premium.
- Overlay : blur ou voile adapté au mode.
- Éviter les fonds noirs purs.
- Les boutons de fermeture restent neutres, sauf action destructive explicite.

#### Popovers

- Light : blanc + border gris-200 + shadow douce.
- Dark : surface sombre légèrement plus claire que le fond + border subtile.
- Pas de glow.
- Les popovers ne doivent pas introduire de nouvelles couleurs de statut.

#### Datepicker

- Selected : bleu.
- Today : outline bleu discret.
- Hover light : gris clair.
- Hover dark : surface sombre plus claire.
- Ne jamais utiliser vert/orange/rouge dans le datepicker sauf statut métier explicite affiché ailleurs.

#### Segmented control

- Light : fond gris très clair, item actif blanc.
- Dark : fond sombre secondaire, item actif surface plus claire.
- Active state discret : border, shadow douce ou contraste de surface.
- Ne pas utiliser le bleu pour tous les items actifs sauf si le segmented control représente une navigation critique.

### Color Don'ts

Ne pas :

- utiliser le bleu pour des éléments décoratifs ;
- utiliser vert/orange/rouge hors statuts ;
- créer de nouvelles nuances sans les documenter ;
- utiliser des gradients dans l'app métier ;
- utiliser du noir pur massif en dark mode ;
- utiliser des couleurs saturées en dark mode ;
- donner une signification de statut aux avatars ;
- multiplier les couleurs dans une même ligne ;
- mélanger plusieurs statuts visuels pour une même information ;
- réutiliser un fond sémantique light directement en dark mode.

### Premium Dark Mode Principles

- Sombre ne veut pas dire noir.
- Le contraste doit être contrôlé, pas maximal partout.
- Le dark mode utilise moins de couleurs que le light mode.
- Les surfaces sont différenciées par niveau, pas par couleur vive.
- Le CTA bleu doit rester visible sans devenir fluorescent.
- Les statuts sont désaturés.
- Aucune couleur décorative.
- La lisibilité passe avant l'effet visuel.

### Checklist couleur avant modification UI

Avant chaque modification UI :

- vérifier le light mode ;
- vérifier le dark mode ;
- vérifier que les couleurs viennent du design system ;
- vérifier que les statuts ont la même signification partout ;
- vérifier que le bleu reste réservé aux actions, focus et états actifs ;
- vérifier que les avatars ne communiquent pas un statut ;
- vérifier le contraste texte/fond ;
- vérifier que les borders dark mode ne sont pas trop contrastées ;
- vérifier qu'une ligne ou une card ne multiplie pas les couleurs inutilement.

## Spacing & Layout Density

Les espacements Sidian doivent rester cohérents entre les pages pour éviter qu'un écran paraisse plus dense, plus vide ou moins premium qu'un autre sans raison produit. Tous les espacements suivent la grille 4px.

### Layout spacing references

Ces règles donnent des valeurs d'espacement et de dimension. Elles ne définissent pas le layout 3 colonnes, qui vit uniquement dans `SIDIAN_UI_PATTERNS.md`.

#### Sidebar desktop

- Largeur fixe : 220-240px selon l'existant validé.
- Padding horizontal : 16-20px.
- Padding vertical : 16-24px.
- Espace entre groupes de navigation : 24-32px.
- Item nav height : 40-44px.
- Gap icône / label : 10-12px.

#### Page content spacing

- Padding page desktop : 24-32px.
- Gap entre contenu principal et rail droit : 24px quand le pattern 3 colonnes est utilisé.
- Les largeurs utiles et wrappers de page sont définis dans `SIDIAN_UI_PATTERNS.md`.

### Page header

- Margin-bottom : 20-24px.
- Titre + sous-titre : gap 4-6px.
- CTA aligné top-right.
- CTA même hauteur sur toutes les pages : 40-44px.
- CTA même padding horizontal : 16-18px.

### Cards / containers

#### Cards principales

- Padding : 20-24px.
- Radius : 12px.
- Border : 1px gris-200.
- Gap interne : 16-20px.

#### Cards compactes / KPI

- Padding : 16-20px.
- Gap interne : 10-14px.
- Séparateurs internes : gris-100.

#### Rail droit

- Padding : 20-24px.
- Section gap : 20-24px.
- Divider gap : 16-20px.
- Ne jamais ressembler à une petite card isolée.

### Lists / rows

#### Rows dashboard / contrats

- Hauteur minimum : 56-64px selon densité.
- Padding horizontal : 16-20px.
- Padding vertical : 12-14px.
- Gap avatar / texte : 12px.
- Gap entre lignes : 8-10px.
- Hover : léger, sans déplacement.
- Row clickable entière.

#### Colonnes

- Type / montant / échéance / statut doivent avoir des largeurs stables.
- Éviter les colonnes qui flottent.
- Aligner les montants en `tabular-nums`.

### Toolbar

- Hauteur : 40-44px.
- Searchbox width : 260-320px.
- Gap entre search / boutons : 8-12px.
- Boutons filtre / tri : 36-40px height.
- Toolbar margin-bottom : 16px.
- Search à gauche, filtre / tri à droite.

### Inputs / forms / drawers

#### Drawer

- Largeur desktop : 440-520px selon contexte.
- Padding header : 24px.
- Padding body : 24px.
- Padding footer : 16-20px 24px.
- Section gap : 24px.
- Divider margin : 20-24px.

#### Inputs

- Height : 40-44px.
- Padding horizontal : 12-14px.
- Label margin-bottom : 6px.
- Field gap : 14-16px.
- Radius : 10-12px.

#### Segmented control

- Height : 34-38px.
- Padding interne : 2-3px.
- Radius : 10-12px.
- Option active centrée verticalement.

#### Datepicker

- Popover padding : 16px.
- Grid gap : 6-8px.
- Day cell : 34-38px.
- Header month gap : 12-16px.
- Radius : 12-16px.

### Badges / avatars / icons

#### Badges

- Height : 22-26px.
- Padding horizontal : 8-10px.
- Radius full.
- Font-size : 12px.
- Pas de badge trop haut dans les rows.

#### Avatars

- Liste : 28-32px.
- Petits avatars groupés : 22-24px.
- Dashboard summary : 22-26px.
- Overlap max : -6px.
- `+X` même taille que les avatars.

#### Icons

- Sidebar : 18-20px.
- Buttons : 16px.
- Table / list meta : 14-16px.
- StrokeWidth Lucide : 1.75.

### Responsive / mobile

Ne pas inventer de nouveaux layouts mobiles sans validation.

- Padding mobile : 16px.
- Drawers deviennent full-width ou bottom sheet selon contexte.
- Rail droit passe sous le contenu ou disparaît selon priorité.
- Toolbar peut passer en colonne si nécessaire.

### Density principles

- Dashboard : densité moyenne, lecture rapide.
- Contrats : densité légèrement plus compacte.
- Drawer : respirant, focus formulaire.
- Notifications : dense mais très scannable.
- Aucune page ne doit utiliser des espacements différents sans raison produit.

### Spacing Don'ts

Ne pas :

- étirer les searchbox inutilement ;
- créer des cards trop hautes pour peu de contenu ;
- changer les gaps page par page ;
- utiliser de paddings arbitraires.

---

## 3. Typographie

- Police unique : **Outfit** (Google Fonts, variable 300–800). Fallback : `system-ui, sans-serif`.
- Poids autorisés : 400 (corps) · 500 (labels, nav) · 600 (semibold : noms, boutons, montants) · 700 (titres) · 800 (réservé au lockup logo).

### Échelle


| Rôle                    | Taille  | Poids   | Détails                                |
| ----------------------- | ------- | ------- | -------------------------------------- |
| Display (titre de page) | 32px    | 700     | letter-spacing -0.03em · lh 1.15       |
| Titre de section        | 16px    | 700     | letter-spacing -0.015em                |
| Chiffre KPI             | 26px    | 700     | tabular-nums                           |
| Label KPI               | 13px    | 500     | gris-500                               |
| Corps                   | 14px    | 400     | lh 1.5                                 |
| Corps secondaire        | 13px    | 400     | gris-500                               |
| Caption / méta          | 12px    | 400–500 | gris-400                               |
| Header de table         | 11px    | 500     | uppercase · tracking 0.06em · gris-500 |
| Eyebrow / label fort    | 11px    | 600–700 | uppercase · tracking 0.06–0.08em       |
| Boutons                 | 13–14px | 600     | —                                      |


### Chiffres & montants

- `font-variant-numeric: tabular-nums` obligatoire sur tous les montants et colonnes de chiffres.
- Format montant : `1 200 €` — espace fine entre milliers, espace insécable avant €.
- Format date : `12 juin 2026`.

---

## 4. Formes, rayons, icônes

- Grille d'espacement : multiples de 4 px.
- Rayons : 8 px (inputs, boutons, badges nav) · 10 px (FeaturedIcon md) · 12 px (tuiles) · 16 px (conteneurs flottants : popovers, modals) · full (pills, dots, avatars).
- Traits : séparateurs gris-100 (1px) · borders gris-200 (1px).
- Icônes : Lucide uniquement, strokeWidth 1.75. Tailles : 16 px (sm) · 20 px (md).
- Ombres : usage sobre et fonctionnel. Les cards peuvent utiliser une shadow douce si elle améliore la hiérarchie ; les conteneurs flottants peuvent porter une ombre unique : `0 8px 24px rgba(13,17,23,.08)`. Pas de glow ni d'ombres décoratives.

## Scrollbars

Classe unique : `dashboard-card-scroll` sur toutes les zones scrollables internes (listes Dashboard, Contrats, drawers, panels).

Règles :

- light mode : discrète, gris clair (gris-400 à faible opacité), jamais dominante ;
- dark mode : subtile, jamais blanche agressive ;
- track transparent ;
- thumb arrondi (radius full) ;
- hover légèrement plus visible ;
- scrollbar fine (6px) ;
- tokens CSS : `--scrollbar-thumb`, `--scrollbar-thumb-hover`, `--scrollbar-track` dans `globals.css`.
