# Phase 4 — Clients et paiements à recevoir (SID-PROD-001)

Statut : implémenté en local (18 juillet 2026). **En attente de validation Codex** (contre-revue non validée).

## Périmètre

- Clients payeurs : liste, création, édition (nom/email), archivage logique
- Paiements à recevoir (`creance`) : liste, création brouillon, édition brouillon, archivage
- Vocabulaire UI : **Clients** / **Paiements à recevoir** (jamais « Factures » comme objet principal ; jamais « créance(s) » visible)
- Mutations via RPC SECURITY DEFINER ; SELECT PostgREST uniquement
- Idempotence des créations via `creation_key` (UUID, unique par prestataire)

## Règles métier clés

| Règle | Comportement |
|---|---|
| Archivage client | Refusé si ≥1 créance non archivée (`CLIENT_HAS_ACTIVE_CREANCES`, y compris `BROUILLON`). **Invariant transactionnel** : `create_current_creance`, `update_current_creance_draft` et `archive_current_client_payeur` verrouillent `client_payeur` (`FOR UPDATE`) — impossible d’avoir un client archivé avec une créance active. Idempotent si déjà archivé. Aucune barrière de test dans le schéma applicatif. |
| Archivage client répété | Idempotent si déjà archivé |
| Devise | `EUR` exact uniquement (refuse `eur`, `USD`, `ZZZ`, vide) |
| Montants | 1…100000000 centimes ; conversion euros→centimes exacte (pas de `Number * 100`) |
| Email | `lower(btrim(...))` + validation SQL alignée Zod (points/labels) ; message utilisateur générique |
| Idempotence UI | `creationKey` stable sur erreur ; rotation uniquement après succès |
| Brouillons | Création toujours `BROUILLON` / `import_manuel` ; update draft uniquement si brouillon |
| Sélection client (édition) | Pas de réaffectation silencieuse ; état bloqué si client courant non sélectionnable |

## Routes

| Route | Accès |
|---|---|
| `/app` | Accueil shell |
| `/app/clients` | Clients |
| `/app/paiements-a-recevoir` | Paiements à recevoir |

## Commandes

```bash
pnpm supabase:reset
pnpm test:local-guard   # inclut le garde-fou PostgreSQL loopback :54322
pnpm test:prod-001
pnpm test:forms         # ClientForm / CreanceForm (Vitest + Testing Library)
pnpm lint
pnpm typecheck
pnpm build
```

Les courses concurrentielles de `test:prod-001` ouvrent un `pg.Client` uniquement après
`assertLocalPostgresUrl` (hôte loopback + port `54322` strict).

## Hors périmètre

Pennylane (SID-INT-001), Stripe, bouton « Sécuriser », publication brouillon → ouverte.
