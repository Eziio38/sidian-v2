# DESIGN_DECISIONS.md — Décisions prises, et pourquoi

**Objet :** consigner les décisions d'architecture visuelle réellement inscrites dans le
code, leur raison, leur coût, et les questions qui restent ouvertes.
**Instantané :** `fa6dbf8` + arbre de travail au 3 août 2026, 21 h 03.
**Portée :** ce document ne prescrit rien. Il explique ce qui a été fait pour que la
prochaine personne n'ait pas à le redécouvrir en lisant 46 fichiers CSS.


> **Volatilité des références.** Les numéros de ligne correspondent à l'instantané
> indiqué ; plusieurs fichiers de ce périmètre étaient modifiés en parallèle pendant la
> rédaction. Le chemin de fichier et le nom du symbole sont les ancres durables ;
> revérifier une ligne avant d'agir sur un constat isolé.

---

## 1. Le thème clair est la référence et le défaut

**Décision.** Le thème clair est déclaré sans condition sur `:root` et sur
`[data-theme="light"]` (`src/design-system/tokens.css:20-21`). Le défaut produit d'un
nouveau compte est `light` — en TypeScript (`src/lib/theme/theme.ts:23`), en base
(`supabase/migrations/20260803120000_theme_preference.sql`, `default 'light'`), et dans le
script anti-flash (`src/lib/theme/theme-script.ts:36`). Le texte de l'écran de paramètres
l'énonce à l'utilisateur : « Le thème clair est la référence de Sidian »
(`src/app/app/parametres/page.tsx:49`).

**Pourquoi.**
1. *Sans JavaScript, il faut que quelque chose s'affiche correctement.* Un thème déclaré
   sur `:root` s'applique même si le script anti-flash échoue, si le cookie est absent, ou
   si le rendu est statique. Faire du sombre le défaut aurait exigé que la valeur par
   défaut soit posée par du code exécutable.
2. *Le produit s'adresse à des freelances et petites agences en contexte bureautique
   diurne.* Le clair est le mode par défaut de la quasi-totalité des outils financiers avec
   lesquels Sidian coexiste (banque en ligne, facturation, Stripe Dashboard).
3. *Le clair est plus exigeant.* Un système conçu d'abord en clair et dérivé en sombre
   révèle immédiatement les contrastes faibles ; l'inverse les masque.

**Coût assumé.** `SIDIAN_DESIGN_LOCK.md` §Couleurs dit « Dark mode par défaut ». Le
document et le code se contredisent — voir §8, question ouverte n° 1.

---

## 2. Le sombre est un override de primitives, pas une inversion

**Décision.** Le bloc `[data-theme="dark"]` (`tokens.css:245-301`) redéfinit **34
primitives `--ds-color-*`** et cinq ombres. Rien d'autre. Aucun composant n'a de règle
`dark:`, aucune couleur n'est calculée par inversion, aucun filtre CSS n'est appliqué.

**Pourquoi.**
1. *L'inversion produit des couleurs fausses.* Inverser #EDF2FF (Brume) donne un bleu sale ;
   inverser une teinte de succès donne un magenta. `SIDIAN_DESIGN_SYSTEM.md` §Dark Mode
   demande explicitement des « versions sombres teintées », pas des inverses.
2. *Un composant correctement écrit bascule sans être touché.* La preuve est mesurable :
   les CSS Modules consomment `--ds-*` **1 645 fois** ; aucun d'eux n'a de code spécifique
   au thème.
3. *La palette sombre n'est pas inventée.* Ce sont les valeurs de la direction artistique
   `agent-dark` déjà validée pour le workspace, promues au rang de primitives — le
   commentaire de `tokens.css:232-235` le dit explicitement.
4. *La surface de maintenance est bornée.* 34 valeurs à relire, pas 163.

**Coût assumé.** Tout composant qui écrit une couleur en dur ne bascule pas. Il en reste
**70 occurrences d'utilitaires Tailwind de palette sur 19 fichiers**, dont 38 dans
7 fichiers vivants (`FINAL_UI_AUDIT.md` §9), et **145 littéraux hexadécimaux** dans les
CSS Modules du workspace (§3 ci-dessous).

**Conséquence positive vérifiée.** Le sombre est aujourd'hui **plus contrasté** que le
clair sur les statuts (succès 7,68:1 contre 5,20:1 ; alerte 8,26:1 contre 6,79:1).

---

## 3. `data-theme` est réservé au thème ; l'apparence descriptive vit sur `data-appearance`

**Décision.** `data-theme` ne prend que deux valeurs, `light` ou `dark`, et n'est porté que
par `<html>` ou par un sous-arbre volontairement épinglé. Le marqueur descriptif du shell
(`agent-dark`, `assistant-light`, `light`) vit sur un attribut distinct,
`data-appearance` (`src/components/app/app-shell.tsx:159-162`).

**Pourquoi.** L'ancienne valeur `data-theme="agent-dark"` était captée par les sélecteurs de
thème et rendait impossible toute règle propre sur `[data-theme="dark"]`. Le commentaire
du code le documente (`app-shell.tsx:159-161`, `tokens.css:237-240`).

---

## 4. Le workspace Agent reste sombre dans les deux thèmes

**Décision.** `/app/assistant` force `appearance="agent-dark"`
(`src/components/assistant/conversational-workspace.tsx:4007`), quel que soit le thème
choisi par l'utilisateur.

**Pourquoi.**
1. *La direction artistique de l'Agent est verrouillée.* `SIDIAN_DESIGN_LOCK.md` §Règle
   absolue : « L'empty state de l'Agent IA est verrouillé. Il ne doit plus être redessiné
   sans validation explicite. » Une déclinaison claire du workspace serait un redessin.
2. *Le sombre porte une intention produit.* L'Agent est un espace de concentration, distinct
   des pages métier. `SIDIAN_CONVERSATIONAL_UX.md` §9 : « Dark uniquement sur
   `/app/assistant` et `/dev/assistant` ».
3. *Le coût de la déclinaison est réel.* Treize CSS Modules du workspace construisent leurs
   surfaces avec `color-mix(in srgb, #ffffff X%, …)` — **61 occurrences**. Un voile blanc à
   4-16 % ne signifie rien sur fond clair. Décliner l'Agent en clair, ce n'est pas basculer
   des tokens : c'est réécrire treize fichiers.

**Coût assumé.** Un utilisateur qui choisit « Clair » voit tout le produit en clair
**sauf sa page d'accueil**, et rien ne le lui explique (`FINAL_UX_AUDIT.md` P2-9). La
décision est par ailleurs **verrouillée dans le CSS**, pas dans une couche de tokens : la
revisiter est coûteux, ce qui est acceptable pour une direction artistique validée mais
doit être su.

**Effet de bord à corriger.** Le squelette de chargement du segment `/app` est clair
(`src/app/app/loading.tsx:4` → `PageSkeleton`), donc chaque navigation vers l'accueil
produit un flash clair avant un écran sombre (`FINAL_UX_AUDIT.md` P2-6).

---

## 5. Les pages publiques de paiement `/p/*` sont épinglées en clair

**Décision.** `src/app/p/layout.tsx:17` :
`<div data-theme="light" className="contents">`. Le sous-arbre reprend le bloc
`[data-theme="light"]` de `tokens.css`, quel que soit le thème de `<html>`.

**Pourquoi.**
1. *La préférence n'appartient pas au visiteur de cette page.* Le thème vient du cookie du
   navigateur, donc éventuellement du **prestataire** si les deux partagent un poste. Rien
   ne justifie d'imposer le goût de l'émetteur au payeur.
2. *C'est un écran financier vu une fois.* Un écran de règlement doit être maximalement
   conventionnel et lisible. Le clair est le mode par défaut de tous les tunnels de
   paiement grand public, à commencer par Stripe Checkout — vers lequel la page redirige
   immédiatement. Un enchaînement sombre → clair aurait suggéré un changement de site.
3. *Le mécanisme était déjà nécessaire.* `[data-theme="light"]` a été ajouté à côté de
   `:root` précisément pour rendre l'épinglage possible ; le commentaire de
   `tokens.css:10-19` explique en détail pourquoi il n'y a pas de conflit de spécificité.

**Coût assumé.** Les six `bg-white` restants du produit sont dans `/p/*` — sans risque
puisque le sous-arbre est clair, mais ils contournent quand même la couche de tokens.

**Incohérence relevée.** `/p/autorisation/retour` et `/p/autorisation/annulation`
redéfinissent une coquille locale au lieu de `PublicPaymentShell` : pas de lockup Sidian,
pas de mention de sécurité Stripe (`UX_FLOWS.md` §5, F-1). Ce n'est pas une décision, c'est
une omission.

---

## 6. Les écrans d'authentification suivent l'OS tant qu'aucune préférence n'existe

**Décision.** `/connexion`, `/inscription`, `/mot-de-passe-oublie`,
`/reinitialiser-mot-de-passe` résolvent `system` **en l'absence de préférence enregistrée**
(`src/lib/theme/theme.ts:53-63`, appliqué par `theme-script.ts:33-38`). Dès qu'un cookie ou
un compte porte une préférence, elle prime.

**Pourquoi.**
1. *Un visiteur sans préférence n'a pas encore de compte.* Lui imposer le clair, c'est
   décider à sa place avant même qu'il puisse choisir. Suivre son système est le seul
   signal légitime dont on dispose.
2. *La liste est explicite, pas une heuristique.* `OS_FOLLOWING_PUBLIC_PATHS` énumère
   quatre chemins. Aucune route ne bascule par accident.
3. *La préférence, une fois exprimée, gagne toujours.* Le comportement OS n'est jamais un
   override — c'est un défaut de dernier recours.

**Coût assumé.** `FINAL_TECHNICAL_AUDIT.md` §Theming relève que « les écrans
d'authentification sont en clair alors que la surface d'accueil du produit est verrouillée
en sombre ». Avec cette décision, ils peuvent désormais être sombres — mais un utilisateur
dont l'OS est clair verra toujours l'enchaînement auth clair → accueil sombre. Ce n'est pas
résolu, c'est atténué.

---

## 7. Décisions de plus petite portée, mais structurantes

### 7.1 — Les couleurs de statut sont aliasées sur les valeurs du design system

`src/app/globals.css:53-61` : `--sidian-success`, `-warning`, `-danger` pointent désormais
sur `--ds-color-*` au lieu de porter leurs teintes historiques.

**Pourquoi.** Les valeurs historiques échouaient AA sur leur propre fond teinté :
succès #059669 sur #ECFDF3 = **3,57:1**, alerte #D97706 sur #FFFAEB = **3,05:1**, danger
#DC2626 sur #FEF3F2 = **4,44:1** (seuil 4,5:1). Les valeurs `--ds-color-*` couvrent le même
rôle en passant : **5,20 / 6,79 / 6,05:1**. Les fonds et bordures sont inchangés — seule la
teinte du texte fonce, donc l'identité visuelle n'a pas bougé.

**Effet de bord.** Ces teintes proviennent de `SIDIAN_DESIGN_SYSTEM.md` §2 (tableau
« Sémantiques »), qui liste encore #059669 / #D97706 / #DC2626. Le tableau du document est
désormais faux. Question ouverte n° 4.

### 7.2 — `--text-tertiary` ne partage plus la valeur de `--text-disabled`

`globals.css:87-88`. `--text-tertiary` porte du texte informatif et doit rester lisible :
il passe de `--sidian-gris-400` (**2,60:1** sur blanc) à `--ds-color-text-muted`
(**4,83:1**). L'ancienne valeur est conservée pour `--text-disabled` seul, exempté par
WCAG 1.4.3.

### 7.3 — `--background` est le fond applicatif, pas la surface

`globals.css:71`. Quand `--background` valait la surface (blanc) alors que le shell peint
`--ds-color-background`, une bande d'une autre teinte apparaissait sous le contenu et en
survol de défilement. Les cartes restent blanches via `--surface`.

### 7.4 — La variante `dark:` de Tailwind est pilotée par le choix explicite

`globals.css:13` : `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *))`.
Sans cette redéfinition, `dark:` se serait rattaché à `prefers-color-scheme` : un compte
réglé sur « Clair » aurait vu les utilitaires `dark:` s'appliquer sur un système sombre.
C'est un garde-fou — l'architecture reste portée par les tokens, pas par cette variante.

### 7.5 — Le cookie de thème est délibérément non-`HttpOnly`

`src/lib/theme/theme-server.ts:36-37`. Le script anti-flash doit pouvoir le lire **avant la
première peinture**, sans attendre React. La valeur n'est pas un secret : c'est un choix
d'affichage. Le cookie est effacé à la déconnexion (`clearThemePreferenceCookie`,
`theme-server.ts:59`) pour que deux comptes partageant un navigateur restent isolés, et
réaligné à la connexion (`syncThemePreferenceCookieFromAccount`, `:72`).

### 7.6 — La base est la source de vérité par compte ; le cookie n'en est que la projection

L'écriture passe par une RPC `security definer` qui dérive le prestataire de `auth.uid()`
et n'accepte **aucun identifiant depuis l'appelant**
(`supabase/migrations/20260803120000_theme_preference.sql`). La colonne est ajoutée au
trigger `protect_prestataire_sensitive_columns` : aucune écriture PostgREST directe
possible. Conforme à `AGENTS.md` §Règles de sécurité (« aucune écriture directe … toute
action passe par une fonction métier déterministe »).

**Choix assumé, avec réserve.** L'appel est en « tirer et oublier » —
`void onPersist?.(next)` (`src/components/theme/theme-provider.tsx:145`) — parce qu'un choix
d'affichage ne doit jamais faire attendre. Mais l'échec est **totalement muet** : le thème
est appliqué localement et l'utilisateur retrouvera l'ancien sur un autre appareil sans
avoir été prévenu. À reconsidérer (`FINAL_UX_AUDIT.md` P2-17).

### 7.7 — Tokens sémantiques plutôt qu'utilitaires bruts

**Décision.** Les composants consomment `--ds-*` via CSS Modules ; `bg-white`,
`text-slate-500`, `bg-emerald-50` sont proscrits.

**Pourquoi.** Un utilitaire de palette est une valeur, pas un rôle : il ne peut pas
basculer avec le thème et ne porte aucune intention. Le coût du non-respect a été mesuré :
20 `bg-white` codés en dur ramenaient le texte à **1,08:1** en sombre — illisible.
Le compte total est passé de **65** occurrences de `bg-white` à `fa6dbf8` à **7**
aujourd'hui, dont 6 dans `/p/*` (épinglé clair) et 1 dans un commentaire.

**État.** Décision tenue à ~95 %. Reste 7 fichiers vivants non thémés
(`FINAL_UI_AUDIT.md` §9).

### 7.8 — Un choix non tranché : deux bleus primaires coexistent

Ce n'est pas une décision assumée, c'est un accident à corriger. Le design system utilise
`--ds-color-accent` (#315fd9, **5,57:1** avec du blanc) ; sept boutons écrits en Tailwind
utilisent `--sidian-blue` (#3b6df8, **4,44:1**, **sous le seuil AA**), dont le bouton
« Régler maintenant » du client payeur (`src/app/p/[token]/pay-button.tsx:82`).
`SIDIAN_DESIGN_SYSTEM.md` §2 désigne #3B6DF8 comme le bleu de marque. Question ouverte n° 5.

---

## 8. Questions ouvertes — décision humaine requise

Ces points ne peuvent pas être tranchés dans le code sans arbitrer une intention produit.

### Q1 — `SIDIAN_DESIGN_LOCK.md` dit « Dark mode par défaut ». Le code dit clair.

Les deux affirmations sont incompatibles. Trois issues possibles :
(a) mettre à jour le design lock pour dire « clair par défaut, Agent verrouillé en sombre » ;
(b) revenir à un défaut sombre, ce qui invalide les raisons de §1 ;
(c) restreindre la portée du design lock à la seule surface Agent, ce qui est de fait déjà
le cas.

**Le document est aujourd'hui lu comme faisant autorité. Tant qu'il n'est pas mis à jour,
tout lecteur conclura que le produit ne respecte pas sa propre direction artistique.**

### Q2 — Le bloc KPI de l'ordre de lecture verrouillé est-il abandonné ?

`SIDIAN_DESIGN_LOCK.md` §Composition fixe : « 1. Bonjour 2. Copy 3. KPI 4. Composer
5. Actions rapides ». L'implémentation (`welcome-state.tsx:61-96`) ne rend **aucun bloc
KPI** — les trois cartes calculées côté serveur
(`src/app/app/assistant/page.tsx:122-161`) ne servent qu'à dériver une phrase de texte
(`welcome-summary.ts:125-189`).

C'est cohérent avec `PRODUCT_PRINCIPLES.md` §5 et §7 (« pas de dashboard rempli de KPI
inutiles ») et vraisemblablement délibéré. Mais l'ordre verrouillé n'a jamais été mis à
jour, et le rôle typographique « Chiffre KPI » (`SIDIAN_DESIGN_SYSTEM.md` §3) ainsi que le
token `--text-kpi` n'ont plus aucun consommateur.

### Q3 — Le thème doit-il être proposé ailleurs que dans les paramètres ?

Aujourd'hui : un seul point d'entrée, `/app/parametres`. Pas d'interrupteur dans la
sidebar, pas d'entrée dans le menu profil (qui porte pourtant « Paramètres » et
« Gérer mon abonnement », `app-sidebar.tsx:865-895`). Question de découvrabilité, pas
d'implémentation.

### Q4 — Le tableau « Sémantiques » de `SIDIAN_DESIGN_SYSTEM.md` doit-il être corrigé ?

Il liste #059669 / #D97706 / #DC2626, valeurs qui échouent AA sur leurs fonds teintés et
qui ne sont plus celles du code (#047857 / #92400e / #b42318). Soit le document est corrigé,
soit la décision §7.1 est révoquée — mais alors le produit redevient non conforme.

### Q5 — Quel bleu est le CTA principal ?

`--sidian-blue` (#3b6df8) est le bleu de marque documenté, mais échoue AA avec du texte
blanc (**4,44:1**). `--ds-color-accent` (#315fd9) passe (**5,57:1**) et est déjà le bleu de
tous les boutons du design system. Trois issues : aligner les sept CTA restants sur
`--ds-color-accent` ; assombrir le bleu de marque ; ou assumer explicitement l'écart et le
documenter comme un choix de marque au détriment de la conformité.

**Rappel : ce bleu porte le bouton « Régler maintenant » du client payeur.** C'est le
bouton le plus critique du produit, vu par des tiers, sur des écrans non maîtrisés.

### Q6 — Registre : tutoiement ou vouvoiement ?

`src/lib/ux/microcopy.ts:2` déclare « tutoiement, ton humain ». Les pages métier respectent
la règle. Toute la surface Agent vouvoie (`welcome-summary.ts`, `composer.tsx:43-47`,
`document-attachments.ts`), et les messages d'erreur du **même écran** tutoient
(`conversational-workspace.tsx:539-563`). Ce n'est pas un choix de design assumé : c'est
une dérive, mais la trancher touche une centaine de chaînes.

### Q7 — Faut-il une variante de carte « avertissement » ?

`card.module.css` ne définit que `.info`, `.error`, `.success` (plus des variantes
neutres). `StatusBanner` mappe donc `tone: "warning"` sur la carte **info**
(`status-banner.tsx:33`) : hors ligne, permission refusée et plafond de prélèvement non
validé s'affichent sur une surface bleue d'information avec un badge orange. Ajouter la
variante est trivial ; décider que l'avertissement mérite sa propre surface est une
décision de design.
