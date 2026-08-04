# Sidian — rapport de refonte UI authentifiée

Date : 27 juillet 2026

## Audit initial

L’audit détaillé et le plan de migration sont disponibles dans
[`SID_CODEX_UI_REDESIGN_AUDIT_PLAN.md`](./SID_CODEX_UI_REDESIGN_AUDIT_PLAN.md).

Le produit disposait déjà d’une première base d’AppShell clair, mais plusieurs
systèmes visuels coexistaient encore : pages métier très « administration »,
workspace conversationnel avec en-tête dupliqué, composer traité comme un
footer, formulaires toujours déployés et panneau Protection plein écran sur
mobile.

## Composants supprimés ou neutralisés

- Suppression de l’en-tête interne redondant du workspace Aujourd’hui.
- Suppression du dock composer absolu avec bordure de footer.
- Suppression de l’affichage des références techniques d’erreur (`digest`).
- Neutralisation de tous les messages d’erreur transportés par l’API avant
  affichage.
- Réduction des formulaires métier toujours ouverts grâce à une divulgation
  progressive native.

## Composants refactorés

- `AppShell`, `AppSidebar` et configuration de navigation.
- `ConversationalWorkspace`, `WelcomeState`, `Composer`, `MessageCard` et
  `ProtectionPanel`.
- Pages Protections, Paiements, Clients, Activité et Paramètres.
- États vides, erreurs et événements métier.
- Prévisualisations locales de QA et tests UI associés.

## AppShell

Un seul AppShell sert maintenant le workspace IA et les pages métier. La
sidebar claire fait 224 px, conserve une navigation compacte, un état actif
discret et un profil ancré en bas. Le logo affiché est exclusivement
`/public/brand/sidian-logo.png`.

## Aujourd’hui

Le briefing priorise :

1. le montant attendu ;
2. le nombre d’actions nécessaires ;
3. le prochain paiement.

Une action principale et deux actions secondaires maximum suivent le briefing.
Les valeurs réelles proviennent du modèle de dashboard existant, sans nouvelle
logique backend.

## Composer

Le composer est plus haut, plus confortable et conserve le placeholder
« Demande quelque chose à Sidian… ». Il reste proche du briefing ou de la
conversation, utilise une ombre diffuse, un bouton d’envoi tactile de 44 px et
ne présente aucune aide clavier permanente.

## Conversation

Les réponses simples restent textuelles. Les résultats exploitables deviennent
des cartes métier : brouillon de protection, confirmation, paiement ou action
nécessaire. Chaque carte utile peut rouvrir son panneau de contexte.

## Panneau Protection

Le panneau conserve sa présentation progressive et n’affiche que les
informations pertinentes. Sur mobile, il devient une bottom sheet arrondie avec
scrim, poignée, safe area, fermeture par Échap, focus initial, piège de focus et
restauration du focus.

## Pages métier

- **Protections** : liste compacte, statut visible, gestion et édition en
  divulgation progressive, création assistée mise en avant.
- **Paiements** : surface de liste unique, filtres sobres, montant et statut
  lisibles sans empilement de cartes.
- **Clients** : répertoire avec identité visuelle légère et édition repliée.
- **Activité** : chronologie unifiée avec tokens sémantiques.
- **Paramètres** : sections homogènes et surfaces cohérentes avec l’AppShell.

## Mobile

Le breakpoint mobile utilise un drawer modal avec scrim, verrouillage du scroll,
focus piégé, fermeture accessible et safe areas. Aujourd’hui s’empile
verticalement et le panneau Protection devient une sheet, pas une page plein
écran.

## Accessibilité

- liens d’évitement ;
- navigation avec `aria-current` ;
- dialogs correctement nommés ;
- gestion et restauration du focus ;
- fermeture par Échap et boucle de tabulation ;
- cibles tactiles de 44 px ;
- états annoncés par `role="status"` ou `role="alert"` ;
- respect de `prefers-reduced-motion`.

## Erreurs et états

Les détails techniques, codes internes et références de diagnostic ne sont
jamais rendus. Une erreur d’enregistrement affiche :

> Je n’ai pas pu enregistrer ta demande.

avec l’action « Réessayer ».

Les empty states sont désormais composés comme des surfaces métier, sans
bordure pointillée ni vocabulaire technique.

## Validation

- `pnpm test:ui` : **19 fichiers, 89 tests réussis**.
- `pnpm test` : **118 fichiers, 999 tests réussis**.
- `pnpm exec tsc --noEmit` : **réussi**.
- `pnpm build` : **réussi** avec Next.js 16.2.10.

Le premier build final en sandbox a échoué uniquement lors du téléchargement de
la police Outfit ; le même build relancé avec accès réseau a réussi.

## Captures

Quinze captures finales sont enregistrées dans
[`screenshots/codex-ui-redesign/`](./screenshots/codex-ui-redesign/), dont trois
vues mobiles réelles en 390 × 844.

## Limitations

- Les captures utilisent des données de prévisualisation déterministes pour ne
  pas dépendre d’un compte authentifié ni modifier de donnée métier.
- Aucun test de lecteur d’écran matériel n’a été réalisé ; les comportements
  ARIA, clavier et focus sont couverts par l’implémentation et les tests
  composants.
- Aucun backend, workflow, schéma, migration, Stripe, WhatsApp, Email ou
  Supabase n’a été modifié.

## Fichiers principaux modifiés

- `src/components/app/app-shell.tsx`
- `src/components/app/app-sidebar.tsx`
- `src/components/app/app-nav-config.ts`
- `src/components/assistant/conversational-workspace.tsx`
- `src/components/assistant/welcome-state.tsx`
- `src/components/assistant/composer.tsx`
- `src/components/assistant/protection-panel/protection-panel.tsx`
- `src/components/assistant/agent-client.ts`
- `src/app/app/assistant/page.tsx`
- `src/app/app/paiements-a-recevoir/page.tsx`
- `src/app/app/paiements/page.tsx`
- `src/app/app/clients/page.tsx`
- `src/app/app/parametres/page.tsx`
- `src/components/app/dashboard-events.tsx`
- `src/components/feedback/empty-state.tsx`
- `src/components/feedback/error-state.tsx`
- `src/lib/ux/microcopy.ts`
- `src/app/dev/assistant/page.tsx`
- `src/app/dev/workspace/page.tsx`
- `src/app/globals.css`
- tests UI correspondants
- documentation et captures sous `docs/implementation/`

Aucun commit n’a été créé.
