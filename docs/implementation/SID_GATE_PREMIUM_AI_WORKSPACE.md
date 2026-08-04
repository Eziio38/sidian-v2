# SID Gate — Premium AI Workspace

**Date :** 2026-07-27  
**Workspace :** `/Users/jonathan/sidian-v2`  
**Aucun commit automatique.**

## Decision

`PASS` — workspace IA premium unifié, light, sans dashboard+chat ni sidebar sombre.

## Direction visuelle validée

- Light mode principal : fond gris-50, surfaces blanches, sidebar claire (`rgb(255,255,255)`)
- Nav unique : Aujourd’hui · Protections · Paiements · Clients · Activité · Paramètres
- Logo officiel : `/brand/sidian-logo.png` via `BrandLockup` + `next/image`
- Composer unique, placeholder `Demande quelque chose à Sidian…`, sans hint clavier
- Aujourd’hui : greeting + ligne d’attention + max 3 cartes synthèse + CTAs + composer
- Mode travail : header compact, briefing masqué quand conversation active
- Panneau Protection light + réassurance « Rien ne sera envoyé avant ta confirmation. »

## Inventaire

### Ajoutés
- `src/components/app/app-nav-config.ts` — nav produit unique
- `src/components/app/app-sidebar.tsx` — sidebar claire partagée
- `src/app/app/activite/page.tsx` — timeline événements
- `src/app/app/paiements/page.tsx` — liste paiements filtrable
- `src/app/dev/workspace/page.tsx` — preview métier sans auth
- `src/components/app/app-shell.test.tsx`
- `src/components/assistant/premium-ai-workspace.test.tsx`

### Refactorés
- `app-shell.tsx` — shell unique (`page` | `workspace`), drawer mobile, light
- `assistant-shell.tsx` — alias thin vers AppShell workspace
- `assistant-sidebar.tsx` — réexport AppSidebar
- `app-navigation.tsx` — consomme `APP_NAV`
- `welcome-state.tsx` — Aujourd’hui + brief cards
- `conversational-workspace.tsx` — header Aujourd’hui, work mode, largeur 780–980px
- `globals.css` — tokens light sidebar + accent/error/shadow-md
- Pages métier (protections, clients, paramètres) — mêmes titres / shell

### Supprimés (comportements / libellés)
- Sidebar noire dominante
- Dual shell App vs Assistant (un seul `data-shell="app"`)
- Nav Dashboard / Bien démarrer / Assistant / Agent Sidian / Paiements à recevoir / Stripe / Approbations
- Hint « Entrée pour envoyer · Maj+Entrée… »
- `/app` dashboard → redirect `/app/assistant` (Aujourd’hui)

### Conservés (hors nav)
- Routes `/app/demarrage`, `/app/approbations`, `/app/connexion-stripe` (accessibles, hors nav principale)

## Screenshots

**Before :** `docs/implementation/screenshots/premium-ai-workspace/before-*.png`  
**After :** `docs/implementation/screenshots/premium-ai-workspace/after-*.png`

Preview métier : `/dev/workspace?page=paiements|clients|activite|parametres|protections|empty|erreur`  
Preview conversation : `/dev/assistant?demo=A|B|C&nav=open`

## Tests / build

- `pnpm test:ui` — OK (89)
- `pnpm test` — OK (999 forms + schema/auth/prod/stripe/security)
- `pnpm exec tsc --noEmit` — OK
- `pnpm build` — OK

## Validation visuelle (DOM)

- Sidebar `rgb(255, 255, 255)` desktop + drawer mobile
- Même nav AppShell page / workspace
- Header « Aujourd’hui », greeting, brief cards, composer placeholder
- Aucun hint clavier ; logo `/brand/sidian-logo.png`
- Panneau Protection ouvert en demo C + réassurance confirmation

## Hors scope respecté

Pas de Stripe / WhatsApp / Email / RPC / DB / migrations / API / workflows métier.  
Pas de commit git.

## Commit proposé (texte seulement)

```
feat(ui): Premium AI Workspace — shell unifié light
```
