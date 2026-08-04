# FINAL_UI_AUDIT.md — Audit du système visuel

**Périmètre :** tokens, typographie, rythme d'espacement, rayons, élévation, iconographie,
les deux thèmes, contrastes calculés, incohérences, tokens morts.
**Instantané :** `fa6dbf8` + arbre de travail au 3 août 2026, 21 h 03.
**Méthode :** tous les ratios sont calculés depuis les valeurs réelles de
`src/design-system/tokens.css` et `src/app/globals.css` (formule WCAG 2.x, luminance
relative sRGB). Aucun chiffre n'est repris d'une source tierce.

> Les fichiers de ce périmètre étaient modifiés en parallèle pendant la rédaction
> (`globals.css` : 553 → 582 lignes). Les valeurs ci-dessous correspondent à l'instantané
> indiqué.

---

## 1. Architecture des tokens

Trois couches, dans cet ordre de dépendance :

```
src/design-system/tokens.css      163 tokens --ds-*  ← source unique des valeurs
        ↓ alias
src/app/globals.css               ~110 alias --sidian-* / rôles  ← couche héritée
        ↓ @theme inline
utilitaires Tailwind              bg-surface, text-nuit, rounded-lg…
```

`tokens.css` respecte sa propre règle (« les valeurs primitives ne vivent que dans ce
fichier ») : les composants consomment `--ds-*` à **1 645 reprises** dans les CSS Modules,
contre 7 références résiduelles à `--sidian-*` et 1 à `--assistant-*`.

### Deux systèmes de style coexistent

| Approche | Fichiers | Périmètre |
| --- | --- | --- |
| CSS Modules + `--ds-*` | 46 | Design system, workspace Agent, shell, sidebar, feedback |
| Utilitaires Tailwind | 29 | `/p/**`, écrans d'auth, `/app/demarrage`, `/app/approbations`, détail dossier, `StripeConnectPanel`, `/` |

C'est la fracture structurante du système visuel : la moitié moderne bascule en sombre par
héritage de tokens, l'autre moitié pas.

---

## 2. Couleur — les deux thèmes

### Mécanique

Le clair est déclaré **sans condition** sur `:root` *et* sur `[data-theme="light"]`
(`tokens.css:20-21`). Le second sélecteur permet d'épingler un sous-arbre en clair sous une
racine sombre — c'est exactement ce qui verrouille `/p/*` (`src/app/p/layout.tsx:17`).

Le sombre est un **bloc d'override des primitives** `[data-theme="dark"]`
(`tokens.css:245-301`), pas une inversion algorithmique. 34 primitives sont redéfinies ;
tout le reste hérite.

Conséquence directe : un composant qui consomme `--ds-color-*` bascule sans une ligne de
code. Un composant qui écrit `bg-white` ou `bg-emerald-50` ne bascule pas.

### Contrastes calculés — thème clair

| Paire | Ratio | Verdict |
| --- | --- | --- |
| `text-primary` / `surface` | **18,92:1** | AAA |
| `text-primary` / `background` | **17,82:1** | AAA |
| `text-secondary` / `surface` | **7,56:1** | AAA |
| `text-muted` / `surface` | **4,83:1** | AA |
| `text-muted` / `background` | **4,55:1** | AA (marge de 0,05) |
| `text-muted` / `surface-muted` | **4,24:1** | **échec AA texte normal** |
| `success` / `success-surface` | **5,20:1** | AA |
| `warning` / `warning-surface` | **6,79:1** | AA |
| `danger` / `danger-surface` | **6,05:1** | AA |
| `info` / `info-surface` | **4,97:1** | AA |
| `accent` (#315fd9) + `text-inverse` | **5,57:1** | AA |
| **`--sidian-blue` (#3b6df8) + blanc** | **4,44:1** | **échec AA** |
| `disabled-text` / `disabled-surface` | **2,28:1** | exempté (WCAG 1.4.3) |
| `border` / `surface` | 1,25:1 | Non conforme 1.4.11 si la bordure porte l'information |
| **Anneau de focus** (accent 42 % composité sur blanc) | **1,89:1** | **échec 1.4.11 (seuil 3:1)** |

### Contrastes calculés — thème sombre

| Paire | Ratio | Verdict |
| --- | --- | --- |
| `text-primary` / `surface` | **16,73:1** | AAA |
| `text-primary` / `background` | **18,08:1** | AAA |
| `text-secondary` / `surface` | **8,28:1** | AAA |
| `text-muted` / `surface` | **4,93:1** | AA |
| `text-muted` / `surface-muted` | **4,13:1** | **échec AA texte normal** |
| `success` / `success-surface` | **7,68:1** | AAA |
| `warning` / `warning-surface` | **8,26:1** | AAA |
| `danger` / `danger-surface` | **7,09:1** | AAA |
| `info` / `info-surface` | **7,02:1** | AAA |
| `accent` (#6b96fa) + `text-inverse` | **6,86:1** | AA |
| `disabled-text` / `disabled-surface` | 3,42:1 | exempté |
| **Anneau de focus** (accent 55 % composité) | **2,77:1** | **échec 1.4.11** |

Le sombre est globalement **plus contrasté** que le clair sur les statuts. C'est la
conséquence attendue du choix « teintes désaturées sur surfaces sombres teintées » de
`SIDIAN_DESIGN_SYSTEM.md` §Dark Mode.

### Corrections vérifiées (déjà en place)

| Correction | Avant | Après |
| --- | --- | --- |
| `--sidian-success` → `--ds-color-success` | #059669 sur #ecfdf3 = **3,57:1** | #047857 = **5,20:1** |
| `--sidian-warning` → `--ds-color-warning` | #d97706 sur #fffaeb = **3,05:1** | #92400e = **6,79:1** |
| `--sidian-danger` → `--ds-color-danger` | #dc2626 sur #fef3f2 = **4,44:1** | #b42318 = **6,05:1** |
| `--text-tertiary` | `--sidian-gris-400` = **2,60:1** | `--ds-color-text-muted` = **4,83:1** |
| `bg-white` codé en dur | **65** occurrences à `fa6dbf8` | **7** aujourd'hui, dont 6 dans `/p/*` (épinglé clair) et 1 dans un commentaire |

Les valeurs « avant » sont recalculées depuis `git show HEAD:src/app/globals.css` — elles
concordent au centième avec les chiffres annoncés.

### Constats de contraste encore ouverts

**C-1 (P1) — Le bleu de marque échoue AA sur le CTA le plus critique du produit.**
`--sidian-blue` #3b6df8 avec du texte blanc donne **4,44:1** ; le seuil AA texte normal est
4,5:1. Sept boutons utilisent `bg-sidian-blue text-white` :

- `src/app/p/[token]/pay-button.tsx:82` — « Régler maintenant », le bouton du payeur ;
- `src/app/p/error.tsx:25`, `src/app/p/annule/resume-payment-link.tsx:52` ;
- `src/components/app/approval-decision.tsx:28`, `follow-up-controls.tsx:163` ;
- `src/components/app/stripe-connect-panel.tsx:318` et `:328`.

Le bouton du design system utilise `--ds-color-accent` (#315fd9, **5,57:1**) et passe. Le
produit a donc **deux bleus primaires** avec deux niveaux de conformité. Le clair échoue,
le sombre aussi (#3b6df8 + blanc = 4,40:1 sur une surface sombre).

**C-2 (P1) — L'anneau de focus n'atteint pas 3:1 dans aucun des deux thèmes.**
`--ds-color-focus-ring` (`tokens.css:62-66` et `:286-290`) est l'accent mélangé à 42 %
(clair) / 55 % (sombre) avec du transparent. Composité, cela donne **1,89:1** sur blanc et
**2,77:1** sur surface sombre. WCAG 2.2 (1.4.11 + 2.4.11) exige 3:1 pour un indicateur de
focus. Tout le clavier est concerné : `button.module.css:24-27`, `field.module.css:61-65`,
`workspace-blocks.module.css:67`.

**C-3 (P2) — `text-lien` sur les écrans d'auth.** `--color-lien` → `--text-link` →
`--sidian-blue` : **4,44:1** sur blanc, **4,18:1** sur `gris-50`. Utilisé
`inscription/page.tsx:19`, `connexion/page.tsx:38`, `sign-in-form.tsx:54`.

**C-4 (P2) — `text-muted` sur `surface-muted`.** 4,24:1 (clair) / 4,13:1 (sombre).
La combinaison existe : bulles de message, badges neutres, pastilles de statut.

**C-5 (P2) — `Ciel` #6b96fa est documenté comme accent utilisable, mais donne 2,85:1 sur
blanc.** `SIDIAN_DESIGN_SYSTEM.md` le réserve au fond sombre ; rien dans le code n'empêche
son usage en clair (`--sidian-ciel` est exposé en `text-ciel` via `@theme`).

---

## 3. Typographie

### Échelle déclarée vs échelle documentée

| Rôle documenté (`SIDIAN_DESIGN_SYSTEM.md` §3) | Doc | Token implémenté | Écart |
| --- | --- | --- | --- |
| Display (titre de page) | 32 px / 700 / -0.03em | `--ds-type-h1-*` = 32 px / **600** / -0.035em | poids |
| — | — | `--ds-type-display-*` = **40 px** / 600 | rôle absent de la doc |
| Titre de section | 16 px / **700** / -0.015em | `--ds-type-title-*` = 16 px / **600** / -0.01em | poids + tracking |
| Chiffre KPI | 26 px / 700 tabular | `--text-kpi-size` = 26 px, **aucun poids** | poids non tokenisé ; utilitaire `text-kpi` **jamais utilisé** |
| Corps | 14 px / 400 / lh 1.5 | `--ds-type-body-*` = 14 px / 400 / 1.5 | conforme |
| Corps secondaire | 13 px / 400 | `--ds-type-body-small-*` = 13 px / 400 | conforme |
| Caption / méta | 12 px / 400-500 | `--ds-type-caption-*` = 12 px / 400 | conforme |
| Header de table | **11 px** / 500 / uppercase / 0.06em | **aucun token** | rôle absent |
| Eyebrow / label fort | **11 px** / 600-700 / uppercase / **0.06-0.08em** | `--ds-type-label-*` = **12 px** / **500** / **0.01em** | trois écarts |
| Boutons | 13-14 px / 600 | `button.module.css:12-13` : body 14 px / 600 ; `.sm` 13 px | conforme |

**T-1 (P2) — Le rôle « eyebrow » est le plus divergent.** L'eyebrow est le seul élément qui
porte l'identité éditoriale (`welcome-state.tsx:67`, « Votre agent IA »). Le token le rend
en 12 px / 500 / 0.01em ; la doc demande 11 px / 600-700 / 0.06-0.08em uppercase. Le résultat
à l'écran ne ressemble pas à un eyebrow.

**T-2 (P2) — Deux rôles de titre pour le même usage.** `--ds-type-display-size` (40 px) et
`--ds-type-h1-size` (32 px) existent tous les deux ; `globals.css` mappe
`--text-display-size` sur **h1** (32 px), donc le token `display` (40 px) n'est utilisé
qu'une fois dans tout le code (`Typography` du catalogue). La doc ne connaît qu'un rôle.

### Utilisation réelle des rôles (CSS Modules)

| Rôle | Occurrences |
| --- | --- |
| `body-small` (13 px) | 51 |
| `caption` (12 px) | 33 |
| `body` (14 px) | 23 |
| `title` (16 px) | 10 |
| `label` | 3 |
| `h3` | 2 |
| `h1` | 2 |
| `h2` | 1 |
| `display` | 1 |
| `code` | 1 |

Le produit est écrit en **13 px** avant tout. La hiérarchie de titres est quasi absente des
CSS Modules parce qu'elle vit dans `app-shell.module.css` (`.title`) et dans les pages
Tailwind (`text-lg`, `text-2xl`, `text-[32px]`).

**T-3 (P2) — Sept tailles de police codées en dur hors échelle :**
`0.6875rem` (11 px) ×3 — `composer-shortcuts.module.css:126`,
`welcome-state.module.css:30`, `suggestion-date-picker.module.css:50` ;
`1.05rem` — `welcome-state.module.css:87` ;
`0.625rem` (10 px) et `0.5625rem` (9 px) — `message-thread.module.css:216` et `:226` ;
`0.8125rem` — `suggestion-date-picker.module.css:63` (valeur correcte, token disponible).
Les 11 px correspondent d'ailleurs à ce que la doc demande pour l'eyebrow : le besoin est
réel, le token manque.

**T-4 (P2) — Les pages Tailwind utilisent l'échelle Tailwind, pas celle de Sidian.**
`text-lg` (18 px), `text-2xl` (24 px), `text-xl` (20 px), `text-[32px]`, `text-[26px]`
apparaissent dans `approbations/page.tsx`, `paiements-a-recevoir/[id]/page.tsx`,
`p/**`, `auth-shell.tsx`, `src/app/page.tsx`. Aucune de ces valeurs n'est un rôle Sidian.

### Chiffres

`tabular-nums` est appliqué systématiquement sur les montants — vérifié sur
`paiements/page.tsx`, `paiements-a-recevoir/[id]/page.tsx:122`, `approbations/page.tsx:84`,
`demarrage/page.tsx:76`, `workspace-blocks.module.css`. Conforme.

---

## 4. Rythme d'espacement

Douze pas déclarés (`tokens.css:132-144`), tous multiples de 4 px : 4, 8, 12, 16, 20, 24,
32, 40, 48, 64, 80, 96. `--ds-space-7`, `-9`, `-11`… n'existent pas — la grille est
volontairement trouée pour empêcher les valeurs intermédiaires.

**Respect mesuré :** sur l'ensemble des 46 CSS Modules, **22 valeurs `px` seulement** ne
sont pas des multiples de 4, et l'écrasante majorité sont des `blur()` ou des offsets
d'ombre (légitimes). Les vraies dérives géométriques sont :

| Fichier | Valeur | Note |
| --- | --- | --- |
| `app-sidebar.module.css:562` | `min-height: 30px` | hors grille |
| `app-sidebar.module.css:757` | `min-height: 34px` | hors grille |
| `conversation-title-bar.module.css:63-64` | `13px` × `13px` | icône hors échelle |
| `composer.module.css:447` | `border-radius: 999px` | doublon de `--ds-radius-pill` |
| `globals.css` | `--space-field-gap: 14px` | hors grille (mais conforme à la doc « 14-16px ») |

**Conclusion : la grille 4 px est tenue.** C'est le point le plus solide du système.

**E-1 (P2) — En revanche, les 29 fichiers Tailwind utilisent l'échelle Tailwind**
(`p-5`, `gap-3`, `mt-1.5`, `py-2.5`, `px-2`). `mt-1.5` = 6 px et `py-2.5` = 10 px sont hors
grille Sidian. `paiements-a-recevoir/[id]/page.tsx:150` et `stripe-connect-panel.tsx:318`
en portent.

---

## 5. Rayons

| Token | Valeur | Usage |
| --- | --- | --- |
| `--ds-radius-sm` | 8 px | 19 |
| `--ds-radius-md` | 10 px | 22 |
| `--ds-radius-lg` | 12 px | 11 |
| `--ds-radius-xl` | 16 px | 17 |
| `--ds-radius-2xl` | 20 px | 6 |
| `--ds-radius-pill` | 999 rem | 18 |

**R-1 (P2) — `--ds-radius-2xl` (20 px) n'existe pas dans la doc**, qui s'arrête à
« 16 px (conteneurs flottants) · full ». Six usages.

**R-2 (P1 visuel) — `rounded-2xl` en Tailwind ne vaut pas `--ds-radius-2xl`.**
`globals.css` ne mappe que `--radius-sm/md/lg/xl` dans `@theme inline` ; `rounded-2xl`
retombe donc sur la valeur Tailwind par défaut (**16 px**), pas sur les 20 px du design
system. `p/public-payment-shell.tsx:14`, `p/autorisation/retour/page.tsx:15`,
`p/autorisation/annulation/page.tsx:7` et `auth-shell.tsx:25` utilisent `rounded-2xl` :
la carte de paiement du client et la carte d'auth ont un rayon qui n'appartient à aucune
décision documentée.

**R-3 (P2) — Trois rayons codés en dur** : `composer.module.css:141` (`0 !important`),
`:447` (`999px`), `conversation-title-bar.module.css:20` (`0`).

---

## 6. Élévation

Six niveaux (`--ds-shadow-none` → `-xl`), redéfinis en sombre (`tokens.css:293-300`) avec
un commentaire explicite : « en sombre la profondeur vient des surfaces, pas de l'ombre ».
Conforme à la doc.

**Usage réel dans les CSS Modules : 12 occurrences au total** (sm ×5, lg ×3, xs ×2, xl ×1,
md ×1). L'élévation est très peu employée — conforme à « ombres très discrètes »
(`SIDIAN_DESIGN_LOCK.md`).

**El-1 (P2) — Le composer redéfinit trois ombres complètes en littéral**
(`composer.module.css:15-17`, `:31-33`, `:52-53`) au lieu d'utiliser les tokens, avec des
valeurs (`0 20px 48px`, `0 24px 56px`) plus fortes que `--ds-shadow-xl`. Le composer est
l'élément le plus élevé du produit alors que la doc ne prévoit qu'une ombre unique
`0 8px 24px rgba(13,17,23,.08)` pour les conteneurs flottants.

**El-2 (P2) — Cinq fichiers utilisent des gradients** (`composer.module.css`,
`conversational-workspace.module.css`, `protection-panel.module.css`,
`workspace-name-dialog.module.css`, `auth-shell.tsx:17`) alors que
`SIDIAN_DESIGN_SYSTEM.md` §Color Don'ts interdit « les gradients dans l'app métier ». Les
quatre premiers sont dans le workspace Agent (dont la direction artistique est verrouillée
séparément) ; `auth-shell.tsx` est bien une page métier.

---

## 7. Iconographie

Bibliothèque unique : Lucide. Composant `Icon` (`src/design-system/components/icon.tsx`),
`aria-hidden` par défaut, taille pilotée par CSS (`xs` 14 / `sm` 16 / `md` 20 / `lg` 24),
`--ds-icon-stroke: 1.75`.

**I-1 (P2) — 16 icônes contournent le composant** avec une taille littérale hors échelle :
`size={12}` ×2, `size={13}` ×6, `size={14}` ×6, `size={15}` ×2. Fichiers :
`app-sidebar.tsx`, `composer.tsx`, `conversation-organize.tsx`,
`conversation-title-bar.tsx`. La doc demande 18-20 px pour la sidebar ; l'implémentation y
met du 13-14 px.

**I-2 (P2) — Trois épaisseurs de trait coexistent** : `strokeWidth={1.7}` ×9,
`{1.8}` ×5, `{2}` ×2 — alors que la doc et `--ds-icon-stroke` imposent **1.75**. Aucun de
ces appels ne lit le token.

---

## 8. Tokens morts

### Tokens `--ds-*` sans aucun consommateur

Sur 163 tokens déclarés, **2** ne sont jamais référencés nulle part :

- `--ds-layer-base`
- `--ds-layout-search-width`

**2** ne sont référencés que par la chaîne d'alias de `globals.css`, sans jamais atteindre
un composant :

- `--ds-color-warning-border`
- `--ds-font-weight-bold`

C'est un taux de mortalité très faible (2,5 %). Le fichier de tokens est sain.

### Alias Tailwind `@theme` sans utilitaire correspondant

En revanche, **50 entrées `@theme inline` de `globals.css` n'ont aucun utilitaire
correspondant dans le code** — elles génèrent des classes que rien n'utilise :

- **Toute la famille assistant (10)** : `--color-assistant-bg`, `-sidebar`,
  `-sidebar-text`, `-sidebar-muted`, `-composer`, `-panel`, `-bubble`, `-bubble-user`,
  `-text`, `-muted`. Le workspace est passé en CSS Modules ; ces alias, et les 17 tokens
  `--assistant-*` sous-jacents de `globals.css`, ne servent plus.
- **Tous les rôles de texte (7)** : `--color-text-primary`, `-secondary`, `-tertiary`,
  `-disabled`, `-link`, `-muted`, `--color-foreground`.
- **Toute l'échelle typographique (7)** : `--text-display`, `-kpi`, `-section`, `-body`,
  `-body-sm`, `-caption`, `-eyebrow`. Les pages Tailwind utilisent `text-sm` / `text-lg`
  natifs à la place.
- **Les états (3)** : `--color-state-hover`, `-active`, `-disabled`.
- **Les bordures (3)**, `--color-warning*` (3), `--color-accent*` (2), `--color-gris-300/400/600`,
  `--color-brume`, `--color-ciel`, `--color-ardoise`, `--color-error`,
  `--color-surface-empty/loading/muted`, `--radius-sm`, `--radius-md`, `--shadow-md`,
  `--shadow-float`, `--color-background`.

**D-1 (P2) — La couche d'alias `globals.css` est aux deux tiers morte.** Elle a un coût
réel : chaque token qui y vit doit être maintenu en double thème, et
`FINAL_TECHNICAL_AUDIT.md` §Theming la cite comme le principal risque de dérive.

### Références à des tokens jamais déclarés

`--sidian-aurora-a`, `--sidian-aurora-b`, `--sidian-aurora-c` sont lus **10 fois**
(`composer.module.css:64,69,74,93,98`, `workspace-name-dialog.module.css:22`,
`conversational-workspace.module.css:10`) et **déclarés nulle part**. Ils tombent toujours
sur leur littéral de repli : `#3b6df8`, `#6b96fa`, et **`#4fd1c5`** — un turquoise qui
n'existe dans aucune palette Sidian et qui ne peut basculer avec le thème.

### `feedbackToneClasses`

`src/components/feedback/types.ts:15-53` déclare une table de classes Tailwind brutes
(`bg-emerald-50`, `text-amber-900`, `bg-red-100`…). **Elle n'est importée nulle part** :
`StatusBanner` est passé au composant `Card` du design system. 39 lignes de couleurs
mortes, hors tokens, non thémées.

---

## 9. Utilitaires Tailwind bruts encore en place

Comptage exact au moment de l'instantané : **70 occurrences** d'utilitaires de palette
Tailwind (`white`, `emerald`, `amber`, `red`, `slate`…) sur **19 fichiers**.

| Fichier | Occ. | Bascule en sombre ? |
| --- | --- | --- |
| `components/app/stripe-connect-panel.tsx` | 22 | **non** |
| `components/feedback/types.ts` | 18 | code mort (`feedbackToneClasses` n'est importé nulle part) |
| `app/app/paiements-a-recevoir/[id]/page.tsx` | 3 | **non** — pastilles de chronologie |
| `app/app/approbations/page.tsx` | 3 | **non** — bandeau d'erreur |
| `components/app/approval-decision.tsx` | 3 | **non** — messages succès / erreur |
| `components/app/follow-up-controls.tsx` | 3 | **non** — idem |
| `components/app/cancel-receivable-button.tsx` | 2 | **non** — idem |
| `app/app/demarrage/page.tsx` | 2 | **non** — pastille d'étape validée |
| `app/p/retour/authorization-proposal.tsx` | 3 | sans objet (épinglé clair) |
| `app/p/**` (7 autres fichiers) | 8 | sans objet |
| `components/auth/auth-shell.tsx` | 1 | commentaire uniquement |

Le reliquat **vivant et non thémé** tient donc en **7 fichiers** :
`stripe-connect-panel`, `approval-decision`, `follow-up-controls`,
`cancel-receivable-button`, `approbations/page`, `demarrage/page`,
`paiements-a-recevoir/[id]/page` — soit 38 occurrences.

> Pendant la rédaction, cinq composants de tableau de bord non utilisés
> (`dashboard-overview`, `-summary`, `-actions`, `-deadlines`, `-portfolio`) ont été
> supprimés de l'arbre de travail. Ils portaient à eux seuls 14 occurrences
> supplémentaires. Le comptage ci-dessus est postérieur à cette suppression.

---

## 10. Le workspace Agent : 61 littéraux qui présupposent un fond sombre

Treize CSS Modules du workspace construisent leurs surfaces avec
`color-mix(in srgb, #ffffff X%, …)` — **61 occurrences** :
`attachment-preview-dialog`, `composer`, `composer-shortcuts`, `conversation-resources`,
`message-card`, `message-hover-actions`, `message-suggestions`, `message-thread`,
`project-creation-drawer`, `protection-panel`, `suggestion-date-picker`,
`workspace-name-dialog`, `workspace-toast`.

Un voile blanc à 4-16 % ne fonctionne que sur un substrat sombre. Ces modules ne peuvent
donc **pas** être rendus en clair, quel que soit `data-theme`. C'est cohérent avec la
décision « l'Agent reste sombre dans les deux thèmes » (`DESIGN_DECISIONS.md` §3), mais
cela signifie que la décision est **verrouillée dans le CSS**, pas dans une couche de
tokens : la revisiter coûterait une réécriture de 13 fichiers.

Au total **145 littéraux hexadécimaux** subsistent dans les CSS Modules.

---

## 11. Incohérences de composants

**Co-1 (P1) — Il n'existe pas de variante de carte « avertissement ».**
`StatusBanner` mappe `tone: "warning"` sur `CardVariant: "info"`
(`status-banner.tsx:33`), faute de `.warning` dans `card.module.css`. Un avertissement
(hors ligne, permission refusée, plafond de prélèvement non validé) s'affiche donc avec la
**surface bleue d'information** et un badge orange. Le message visuel contredit le message
textuel.

**Co-2 (P1) — La prop `surface` de `StatusBanner` est acceptée puis jetée.**
`status-banner.tsx:47` : `void surface;`. `OfflineBanner` et `PermissionDenied` passent
`surface="dark"` (`conversational-workspace.tsx:3925-3926`) sans aucun effet. Les bannières
d'état du workspace sombre sont rendues avec les surfaces claires du design system.

**Co-3 (P2) — `ProtectionPanel` porte `aria-label` et `aria-labelledby` simultanément**
(`protection-panel.tsx:142-143`). `aria-labelledby` gagne ; « Panneau protection » est mort.

**Co-4 (P2) — Le panneau de menu profil est correctement neutralisé**
(`app-sidebar.module.css:700` : `visibility: hidden`), alors que le dock du composer ne
l'est pas — voir A-1 ci-dessous. Deux traitements différents du même problème dans la même
base.

---

## 12. Accessibilité — constats restant ouverts au moment de l'audit

**A-1 (P1) — Le dock du composer est focusable sous `aria-hidden`.**
`conversational-workspace.tsx:4224` pose `aria-hidden={mobileSheetOpen ? true : undefined}`
et `conversational-workspace.module.css:193-195` ne fait que `pointer-events: none`. Le
textarea, le bouton d'envoi et le bouton micro restent dans l'ordre de tabulation d'un
sous-arbre déclaré caché aux technologies d'assistance — violation directe de
`aria-hidden`. Le shell résout exactement ce problème deux niveaux plus haut en posant
`inert` (`app-shell.tsx:131-132`) ; le dock ne le fait pas.

**A-2 (P1) — Cibles tactiles à 28 px.** `message-hover-actions.module.css:81-83` et
`:151-153` : `width: 28px; min-width: 28px; min-height: 28px` pour les actions de message
(copier, pouce haut/bas, réessayer) et la fermeture du panneau de retour. WCAG 2.5.8 (AA)
demande 24 px — c'est passé — mais 2.5.5 (AAA) et le socle mobile du produit demandent
44 px. `globals.css:459-462` définit `.sidian-touch-target { min-height: 44px }` : la
classe existe et n'est pas appliquée ici. Autres cas : `app-sidebar.module.css:562` (30 px),
`:757` (34 px), `composer-shortcuts.module.css:63` (32 px).

**A-3 (P2) — Le fil de conversation est un `role="log"` non borné.**
`message-thread.tsx:63-65` : `role="log" aria-live="polite" aria-relevant="additions"` sur
le conteneur de **tous** les messages, sans virtualisation. Sur une longue conversation, un
lecteur d'écran reçoit un flux d'annonces croissant.

**A-4 (P2) — Les messages n'ont pas d'auteur accessible.** `message-thread.tsx:93-104`
distingue utilisateur et agent par `data-role` et par le style ; aucun libellé textuel,
même visuellement masqué. `SIDIAN_CONVERSATIONAL_UX.md` §9 prévoyait pourtant des « noms
message 12 px / 600 ».

**A-5 (P2) — Le toast s'efface au bout de 5,2 s sans pause.**
`workspace-toast.tsx:22-28` : `setTimeout` fixe, aucune suspension au survol ou au focus,
aucun moyen de rappeler le message. WCAG 2.2.1.

### Corrigés pendant la rédaction de cet audit

- `<main>` ajouté sur la route workspace (`app-shell.tsx:229`) — le lien d'évitement pointe
  désormais sur un landmark et non sur une `<section>`.
- `SuggestionDatePicker` : `role="grid"`, `role="row"`, `role="gridcell"`, tabindex
  itinérant et navigation aux flèches (`suggestion-date-picker.tsx:145`, `:300-318`).
- `ConfirmIrreversible` : entrée de focus, restitution à la fermeture, `Escape` et piège de
  focus (`confirm-irreversible.tsx:58-120`).
- `<h1 class="sr-only">` ajouté sur `src/app/app/error.tsx:27`.

---

## 13. Synthèse

**Ce qui est solide**

1. `tokens.css` est une vraie source unique : 1 645 consommations, 2,5 % de tokens morts.
2. La grille 4 px est tenue (22 écarts sur 46 fichiers, presque tous des flous/ombres).
3. Le sombre par override de primitives fonctionne et est **plus** contrasté que le clair
   sur les statuts.
4. Les corrections de contraste annoncées sont réelles et vérifiées au centième.
5. L'élévation est sobre, conforme à la direction artistique verrouillée.

**Ce qui reste à trancher**

| # | Constat | Priorité |
| --- | --- | --- |
| C-2 | Anneau de focus < 3:1 dans les deux thèmes | **P1** |
| C-1 | `bg-sidian-blue` + blanc = 4,44:1 sur 7 CTA dont celui du payeur | **P1** |
| Co-1 | Aucune variante de carte « avertissement » | **P1** |
| Co-2 | `StatusBanner surface="dark"` sans effet | **P1** |
| A-1 | Dock du composer focusable sous `aria-hidden` | **P1** |
| A-2 | Cibles à 28 px | **P1** |
| D-1 | Couche d'alias `globals.css` aux deux tiers morte | P2 |
| §9 | 7 fichiers vivants encore en Tailwind brut de statut | P2 |
| T-1/T-3 | Rôle eyebrow divergent, 7 tailles hors échelle | P2 |
| R-2 | `rounded-2xl` ≠ `--ds-radius-2xl` | P2 |
| I-1/I-2 | 16 icônes hors échelle, 3 épaisseurs de trait | P2 |
| §8 | `--sidian-aurora-*` jamais déclarés, repli turquoise `#4fd1c5` | P2 |
