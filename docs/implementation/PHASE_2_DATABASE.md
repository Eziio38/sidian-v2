# Phase 2 — Socle de données MVP

Statut : schéma MVP appliqué en local uniquement (juillet 2026).

## Tables (13)

`prestataire`, `client_payeur`, `creance`, `tentative_paiement`, `paiement`, `payment_authorization`, `dossier_suivi`, `regle`, `conversation`, `message`, `approval_request`, `audit_log`, `processed_webhook_event`.

## Machines d'état séparées

- `creance.etat` — financier
- `tentative_paiement.etat` — essai
- `payment_authorization.etat` — autorisation
- `dossier_suivi.etat` — relationnel

Aucun trigger ne modifie `creance.etat` depuis une tentative échouée.

## Commandes locales

```bash
pnpm supabase:start
pnpm supabase:reset   # 8 migrations
pnpm test:schema    # 30 tests
pnpm supabase:types
```

## Preuves locales

- `pnpm supabase:reset` — 8 migrations appliquées, seed vide
- `pnpm test:schema` — 30 tests structurels/RLS (JWT authenticated + triggers SQL)
- `pnpm supabase:types` — `src/types/database.generated.ts`

## Reporté

- Trigger d'onboarding `auth.users` → `prestataire` (phase Auth)
- Trigger métier `paiement` → `creance.etat` (fonction métier future)
- Application des migrations sur staging (manuel, après validation)
