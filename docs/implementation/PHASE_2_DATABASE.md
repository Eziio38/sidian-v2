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
pnpm supabase:reset   # 10 migrations (schéma MVP + SID-SEC-001 ×2)
pnpm test:local-guard # **26/26** — garde-fou loopback + localOnlyFetch
pnpm test:schema      # **33/33** structurels/RLS (+ préfixe local-guard)
pnpm test:auth        # **38/38** Auth + SID-SEC-001 (+ préfixe local-guard)
pnpm supabase:types
```

Les compteurs exacts des suites sont documentés après exécution dans `PHASE_3_AUTH.md` et la checklist ops.

## Preuves locales

- `pnpm supabase:reset` — migrations `2026071512*` + `20260716220000_*` + `20260717220000_*`
- `pnpm test:schema` — tests JWT + intégrité SQL + ACL prestataire (8 privilèges)
- `pnpm supabase:types` — `src/types/database.generated.ts`

## Reporté

- Trigger métier `paiement` → `creance.etat` (fonction métier future)
- Application des migrations sur staging (manuel, après diagnostic + validation)

## Suivi sécurité Auth

- SID-SEC-001 onboarding : `20260716220000_sid_sec_001_prestataire_onboarding_rpc.sql`
- SID-SEC-001 finalisation (ACL/UPDATE/email canonique/RPC nom) : `20260717220000_sid_sec_001_prestataire_update_hardening.sql`
- ACL `authenticated` sur `prestataire` : **SELECT uniquement** (MAINTAIN révoqué)
- Détail : `PHASE_3_AUTH.md`
- Diagnostic : `scripts/diagnose-prestataire-integrity.sql`
