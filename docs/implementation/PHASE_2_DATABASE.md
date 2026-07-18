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
pnpm supabase:reset   # 11 migrations (MVP 8 + SID-SEC-001 ×2 + SID-PROD-001)
pnpm test:local-guard # **26/26** — garde-fou loopback + localOnlyFetch
pnpm test:schema      # **33/33** structurels/RLS (+ préfixe local-guard)
pnpm test:auth        # **38/38** Auth + SID-SEC-001 (+ préfixe local-guard)
pnpm test:prod-001    # suite SID-PROD-001 (compteur > 14)
pnpm supabase:types
```

Les compteurs exacts SID-SEC-001 sont documentés dans `PHASE_3_AUTH.md` et la checklist ops.

## Preuves locales SID-SEC-001

- `pnpm supabase:reset` — migrations `2026071512*` + `20260716220000_*` + `20260717220000_*`
- `pnpm test:local-guard` — **26/26**
- `pnpm test:schema` — **33/33** (JWT + intégrité SQL + ACL prestataire, 8 privilèges)
- `pnpm test:auth` — **38/38**
- Diagnostic : `scripts/diagnose-prestataire-integrity.sql`
- ACL `authenticated` sur `prestataire` : **SELECT uniquement** (MAINTAIN révoqué)
- Détail Auth : `PHASE_3_AUTH.md`
- `pnpm supabase:types` — `src/types/database.generated.ts`

## SID-PROD-001 — clients + paiements à recevoir

- Migration : `20260718120000_sid_prod_001_clients_creances.sql` (non encore validée Codex)
- Colonnes : `archived_at`, `creation_key` (unique par prestataire), `creance.libelle`
- Mutations : RPC étroites uniquement ; `authenticated` = SELECT sur `client_payeur` / `creance`
- Helper interne `require_current_prestataire_id()` : aucun `EXECUTE` pour `anon` / `authenticated` / `service_role` / `PUBLIC`
- Création manuelle : toujours `BROUILLON` / `import_manuel`
- Devise MVP : **EUR uniquement** (Zod + SQL)
- Montants : 0,01 € → 1 000 000,00 € (1 → 100000000 centimes), conversion exacte sans flottant
- Archivage client : refusé si créance non archivée (`CLIENT_HAS_ACTIVE_CREANCES`), y compris brouillons ; idempotent si déjà archivé ; **invariant concurrent** via `FOR UPDATE` sur `client_payeur` partagé par create / update draft / archive (aucune barrière de test dans le schéma)
- Idempotence créations : `creation_key` UUID côté formulaire, stable pendant la soumission
- UI : `/app/clients`, `/app/paiements-a-recevoir` — vocabulaire « paiement(s) à recevoir »
- Tests : `pnpm test:prod-001`
- Doc produit : `PHASE_4_CLIENTS_CREANCES.md`

## Reporté

- Trigger métier `paiement` → `creance.etat` (fonction métier future)
- SID-INT-001 Pennylane / tables de liaison externes
- Application des migrations sur staging (manuel, après validation)
- Contre-revue Codex SID-PROD-001 (non validée à ce stade)

## Suivi sécurité Auth

- SID-SEC-001 onboarding : `20260716220000_sid_sec_001_prestataire_onboarding_rpc.sql`
- SID-SEC-001 finalisation (ACL/UPDATE/email canonique/RPC nom) : `20260717220000_sid_sec_001_prestataire_update_hardening.sql`
- SID-PROD-001 : `20260718120000_sid_prod_001_clients_creances.sql`
- Détail : `PHASE_3_AUTH.md` · `PHASE_4_CLIENTS_CREANCES.md`
