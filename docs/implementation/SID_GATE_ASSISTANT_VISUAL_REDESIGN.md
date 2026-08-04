# SID Gate — Assistant Visual Redesign

**Date :** 2026-07-26  
**Workspace :** `/Users/jonathan/sidian-v2`  
**Aucun commit automatique.**

## Decision

`PASS` — l’Assistant n’est plus un prototype sombre vide : surface principale claire, hiérarchie empty/conversation, logo officiel PNG, composer compact, auth harmonisée.

## Visual direction

Light main + sidebar sombre élégante ; accent Sidian Blue inchangé ; calme / premium (Claude–ChatGPT–Apple–Linear inspiré, non copié). Logo unique : `public/brand/sidian-logo.png` via `BrandLockup` + `next/image` (pas de SVG, pas de wordmark texte).

## Before screenshots

`docs/implementation/screenshots/ui-redesign/before-*.png`

- desktop 1440 : empty, conversation, protection
- mobile 390 : empty, drawer, protection
- connexion, inscription ; démarrage → redirect `/connexion?erreur=session` (auth requise)

## After screenshots

`docs/implementation/screenshots/ui-redesign/after-*.png`

- mêmes vues ; drawer via `/dev/assistant?demo=A&nav=open` (preview SSR)

## Logo

- Source unique : `/brand/sidian-logo.png` (156×156, fond transparent, proportions préservées)
- Emplacements : sidebar assistant, drawer mobile, AuthShell, AppShell (onboarding inclus), public payment shell, app error
- SVG marks ignorés pour l’UI

## Greeting / empty / composer

- Greeting : `resolveGreetingFirstName` — never email/username ; sinon « Bonjour »
- Empty : greeting + résumé + 1 CTA primaire + ≤2 secondaires ; **pas** de raccourcis sous le composer
- Composer compact, placeholder « Demande quelque chose à Sidian… »
- États data A–E (welcome) : none_due / due_calm / needs_attention / first_use / load_error

## Mobile

- Drawer : `overflow-hidden`, overlay au-dessus, close dans le panneau, hook `useIsLgBreakpoint` (plus de snapshot serveur coincé)
- Preview : `?nav=open`
- Sheet protection : safe-area ; statut visible

## Auth

- Même identité (logo PNG + brume légère)
- Lien « Déjà inscrit » uniquement dans le footer page (retiré du `SignUpForm`)

## Tests / build

- `pnpm test:ui` — OK (assistant + feedback + app)
- `pnpm exec tsc --noEmit` — OK
- `pnpm build` — OK

## Commit proposé

```
refactor(ui): redesign Sidian assistant experience
```

## Hors scope respecté

Pas de backend / APIs / migrations / Stripe / WhatsApp / email / workers / règles financières. Pas de commit git.
