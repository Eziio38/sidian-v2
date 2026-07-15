# Phase 3 — Authentification et onboarding prestataire

Statut : implémenté en local (juillet 2026).

## Périmètre

- Inscription email + mot de passe avec confirmation
- Connexion / déconnexion
- Récupération de mot de passe
- Callback `/auth/callback`
- Onboarding idempotent `prestataire` côté serveur (session `authenticated`, sans service role)
- Page protégée temporaire `/app`

## Routes

| Route | Accès |
|---|---|
| `/connexion` | Public |
| `/inscription` | Public |
| `/inscription/verifier-email` | Public |
| `/mot-de-passe-oublie` | Public |
| `/reinitialiser-mot-de-passe` | Session recovery |
| `/auth/callback` | Callback Supabase |
| `/app` | Session confirmée + prestataire |

## Commandes

```bash
pnpm supabase:start
pnpm supabase:reset
pnpm test:schema
pnpm test:auth
pnpm lint
pnpm typecheck
pnpm build
```

## Redirect URLs locales (config.toml)

- `http://localhost:3000/auth/callback`
- `http://localhost:3000/reinitialiser-mot-de-passe`

## Hors périmètre

OAuth Google actif, équipes, RBAC, dashboard métier, Stripe, agent IA.
