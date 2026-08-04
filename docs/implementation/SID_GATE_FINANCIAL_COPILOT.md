# SID Gate — Financial Copilot (Concept C)

**Date :** 2026-07-26  
**Workspace :** `/Users/jonathan/sidian-v2`  
**Aucun commit automatique.**

## Decision

`PASS` — direction officielle Concept C « Financial Copilot » : copilote financier premium, conversationnel, light, sans dashboard+chat.

## Direction UX validée

- Header : **Agent Sidian** / **Ton assistant financier IA**
- Nav : Agent Sidian · Protections · Paiements · Clients · Activité · Paramètres
- Empty state calme (greeting + statut + résumé + « Que souhaites-tu faire ? » + 1 primaire / 2 secondaires)
- Composer premium, placeholder unique `Demande quelque chose à Sidian…`, sans hint clavier
- Cartes métier seulement quand utile (protection / paiement / action / confirmation / chronologie)
- Panneau Protection fermé au démarrage ; ouverture discrète quand le brouillon est utile
- Light cohérent (conversation + panneau + sheet) ; sidebar sombre OK
- Logo unique : `/brand/sidian-logo.png` via `BrandLockup`

## Inventaire composants

### Conservés
- `AssistantShell`, `useIsLgBreakpoint`, `ComposerShortcuts`, `greeting.ts`
- `converse-adapter`, `agent-client`, `protection-panel/api`, `map-draft-to-panel`
- Auth / AppShell / BrandLockup (logo PNG déjà en place)

### Refactorés
- `assistant-sidebar.tsx` — nav Concept C, logo plus lisible, profil moins comprimé
- `conversational-workspace.tsx` — header, largeur ~820px, ouverture panneau différée, empty CTAs
- `welcome-state.tsx` / `welcome-summary.ts` — structure empty state validée
- `composer.tsx` — placeholder, style Claude-like, suppression hint Entrée
- `message-thread.tsx` + **nouveau** `message-card.tsx` — cartes métier optionnelles
- `protection-panel/*` — hiérarchie premium, réassurance, sheet plein écran light
- `demo-states.ts` — microcopie naturelle + cartes

### Supprimés (comportements / copy)
- Hint « Entrée pour envoyer · Maj+Entrée… »
- Ouverture brutale du panneau au premier CTA
- Labels admin (« Ce que ça change », « On prépare… », « J’ai besoin de : »)
- Nav « Assistant » / « Paiements à recevoir » (renommés)

## Screenshots

**Before :** `docs/implementation/screenshots/financial-copilot/before-*.png`  
**After :** `docs/implementation/screenshots/financial-copilot/after-*.png`

Note : `/app/demarrage` redirige vers `/connexion?erreur=session` sans auth — capture onboarding = shell auth.

## Tests / build

- `pnpm test:ui` — OK (77)
- `pnpm test` — OK (schema/auth/prod/stripe/security + 987 forms)
- `pnpm exec tsc --noEmit` — OK
- `pnpm build` — OK

## Hors scope respecté

Pas de Stripe / WhatsApp / Email / RPC / DB / migrations / API / workflows métier.  
Pas de commit git.

## Commit proposé (texte seulement)

```
feat(ui): Financial Copilot (Concept C) assistant experience
```
