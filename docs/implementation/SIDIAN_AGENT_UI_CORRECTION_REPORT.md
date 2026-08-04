# Sidian — Rapport de correction visuelle ciblée de la page Agent IA

Date : 27 juillet 2026  
Périmètre : page Agent IA et preview locale associée uniquement  
Commit : aucun

## 1. Décision sur les données métier

La page utilise uniquement trois informations déjà confirmées par le modèle du
dashboard :

| Repère affiché | Source existante | Rôle |
| --- | --- | --- |
| Montant attendu | `dashboard.totals.receivableCents` | Donner immédiatement l’exposition financière en cours |
| Paiements suivis | `dashboard.portfolio.activeCount` | Montrer la charge actuellement prise en charge |
| À vérifier | `dashboard.actions.length` | Isoler ce qui nécessite réellement une intervention |

`dashboard.portfolio.nextDueDate` et `nextDueCents` existent, mais le prochain
paiement n’est plus affiché sur l’accueil de l’Agent : cette information était
réelle mais secondaire dans ce contexte et créait un quatrième axe de lecture
implicite.

En cas d’échec de chargement, aucune donnée inventée n’est affichée. Les trois
repères passent à `—` avec une explication non technique.

## 2. Architecture retenue

- `src/app/app/assistant/page.tsx` reste le composant serveur qui charge et
  transforme les données confirmées.
- `WelcomeState` est un composant de présentation : accueil, réassurance et
  ligne métier.
- `ConversationalWorkspace` orchestre le fil, le contexte, les suggestions et
  le dock du composer.
- `Composer` gère la saisie, les pièces jointes locales, la dictée disponible
  dans le navigateur et le dépôt de fichiers.
- L’overlay de dépôt est rendu par portail dans l’AppShell Agent. Il couvre
  réellement toute la fenêtre tout en héritant du thème sombre.

Aucun backend, endpoint, workflow, schéma, migration ou contrat d’intégration
n’a été modifié.

## 3. Positionnement et hiérarchie

L’écran est organisé en deux zones :

1. une zone haute de compréhension, avec le message d’accueil puis une seule
   ligne de trois indicateurs séparés par des filets ;
2. une zone basse d’action, avec les intentions juste au-dessus du composer.

Le composer est un élément du flux de travail, ancré au bas du workspace et non
un footer flottant. Il conserve une safe area, une transition visuelle douce
avec le contenu et reste au même endroit quand la conversation devient active.

Les trois anciennes cartes SaaS indépendantes ont été supprimées au profit
d’une surface commune sans ombre ni rayon individuel.

## 4. Relation suggestions–composer

- Aucun titre « Suggestions ».
- Deux intentions seulement sur l’accueil :
  - `Protéger une facture`
  - `Vérifier mes paiements suivis`
- Les intentions sont séparées du composer par exactement le gap de design
  system de 8 px.
- Elles restent horizontalement défilables sur mobile.
- Chaque intention déclenche un flux déjà existant ; aucune action fictive
  n’a été ajoutée.

## 5. Microcopie avant / après

| Avant | Après |
| --- | --- |
| `Votre agent est prêt. Que souhaitez-vous que je fasse ?` | `Votre agent est prêt à agir.` puis `Que souhaitez-vous lui confier ?` |
| `Actions nécessaires` | `À vérifier` |
| `Prochain paiement` | supprimé de cet écran |
| `Créer une protection` | `Protéger une facture` |
| `Voir les paiements` | `Vérifier mes paiements suivis` |
| `Retrouver un client` | supprimé de cet accueil |
| `Demande quelque chose à Sidian…` | `Que souhaitez-vous confier à Sidian ?` |
| dépôt limité à la zone du formulaire | `Déposez vos documents ici` sur toute la fenêtre |

## 6. Composer et pièces jointes

- État initial compact et confortable, puis croissance automatique jusqu’à la
  hauteur maximale du design system.
- Trois commandes : fichiers, images/captures et dictée.
- Boutons de 44 × 44 px minimum avec nom accessible, état désactivé, focus et
  tooltip natif.
- Bouton d’envoi circulaire, activé avec du texte ou une pièce jointe.
- Aperçu local des pièces jointes, taille, type visuel et suppression
  individuelle.
- Si une pièce jointe est seule au moment de l’envoi, le composer conserve le
  fichier et demande une instruction : `Indiquez simplement ce que Sidian doit
  faire avec ces documents.`
- Le dépôt global utilise `role="status"` et `aria-live="polite"`.

## 7. Mobile et responsive

Vérifications effectuées aux tailles demandées :

- 1440 × 900 ;
- 1280 × 800 ;
- 768 × 1024 ;
- 390 × 844.

Sur mobile :

- navigation par drawer existant ;
- safe areas conservées ;
- briefing maintenu sur une seule ligne compacte ;
- détails secondaires des indicateurs masqués pour préserver la lisibilité ;
- intentions défilables ;
- composer accessible au bas du viewport ;
- correction des écarts subpixel du visual viewport pour éviter un déplacement
  artificiel du dock.

La route locale `/dev/assistant` expose uniquement des états déterministes de
capture. Ils ne sont pas disponibles comme comportement métier de production.

## 8. Accessibilité

- hiérarchie sémantique avec un `h1` unique ;
- briefing en `section` nommée et données en `dl` ;
- champ avec label accessible masqué visuellement ;
- boutons d’outil nommés et utilisables au clavier ;
- cibles tactiles de 44 px ;
- focus visible par le design system ;
- contraste sombre sans noir ni blanc purs ;
- état de dépôt annoncé sans voler le focus ;
- animations neutralisées lorsque `prefers-reduced-motion` est actif ;
- aucun texte d’aide clavier parasite.

## 9. Captures

1. [Accueil desktop 1440 × 900](screenshots/agent-ui-correction/01-accueil-desktop-1440x900.png)
2. [Accueil desktop 1280 × 800](screenshots/agent-ui-correction/02-accueil-desktop-1280x800.png)
3. [Accueil mobile 390 × 844](screenshots/agent-ui-correction/03-accueil-mobile-390x844.png)
4. [État glisser-déposer](screenshots/agent-ui-correction/04-glisser-deposer.png)
5. [État pièces jointes](screenshots/agent-ui-correction/05-pieces-jointes.png)
6. [Composer avec texte long](screenshots/agent-ui-correction/06-composer-texte-long.png)

## 10. Validations

- `pnpm test:ui` : 19 fichiers, 92 tests réussis.
- `pnpm test` : 119 fichiers, 1 007 tests Vitest réussis, ainsi que toutes les
  suites locales schema/auth/production/Stripe/sécurité.
- `pnpm exec tsc --noEmit` : réussi.
- `pnpm build` : réussi avec Next.js 16.2.10.
- `git diff --check` : réussi.

## 11. Limites fonctionnelles restantes

- Les pièces jointes sont sélectionnées et prévisualisées localement, mais ne
  sont pas envoyées ni analysées : aucun contrat d’upload existant n’a été
  contourné ou inventé.
- La dictée repose sur Web Speech API et reste désactivée si le navigateur ne la
  propose pas.
- En cas d’indisponibilité métier, les indicateurs affichent `—` plutôt qu’une
  valeur extrapolée.
- Les captures utilisent la preview locale déterministe et aucune donnée client
  réelle.

## 12. Fichiers modifiés pour cette correction

- `src/app/app/assistant/page.tsx`
- `src/app/dev/assistant/page.tsx`
- `src/components/assistant/welcome-state.tsx`
- `src/components/assistant/welcome-state.module.css`
- `src/components/assistant/conversational-workspace.tsx`
- `src/components/assistant/conversational-workspace.module.css`
- `src/components/assistant/composer.tsx`
- `src/components/assistant/composer.module.css`
- `src/components/assistant/composer-shortcuts.module.css`
- `src/components/assistant/assistant-redesign.test.tsx`
- `src/components/assistant/assistant-flows.test.tsx`
- `src/components/assistant/conversational-workspace.test.tsx`
- `src/components/assistant/composer.test.tsx`
- `src/components/assistant/premium-ai-workspace.test.tsx`
- `docs/implementation/SIDIAN_AGENT_UI_CORRECTION_REPORT.md`
- `docs/implementation/screenshots/agent-ui-correction/*`
