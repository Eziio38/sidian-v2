# Phase 3 — Authentification et onboarding prestataire

Statut : implémenté en local (juillet 2026). SID-SEC-001 corrigé localement (ACL, canonicalisation email, tests métier réels) — contre-revue Codex finale attendue avant staging.

## Périmètre

- Inscription email + mot de passe avec confirmation
- Connexion / déconnexion
- Récupération de mot de passe
- Callback `/auth/callback`
- Onboarding idempotent `prestataire` via RPC serveur (session `authenticated`)
- Page protégée temporaire `/app`

## Onboarding prestataire (SID-SEC-001)

### Création

- **Aucun INSERT / UPDATE / DELETE direct** `authenticated` sur `public.prestataire`
- ACL `authenticated` : **SELECT uniquement** (pas INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, **MAINTAIN**)
- Création uniquement via RPC `ensure_prestataire_for_current_user(p_nom text)`
  - `SECURITY DEFINER` + `search_path = pg_catalog, public, pg_temp`
  - `user_id` = `auth.uid()`
  - `email` = `lower(btrim(auth.users.email))` (confirmé obligatoire)
  - si `prestataire.email IS DISTINCT FROM` la forme canonique : **écriture de l'email uniquement** (casse/espaces/divergence) — champs commerciaux historiques intacts
  - attributs commerciaux à la création : **défauts SQL** (`trialing`, `early_access_49`, commission `0`, profil `controle`)
  - argument unique : `p_nom` (normalisé / borné)
- `EXECUTE` : `authenticated` uniquement (pas `anon`, pas `PUBLIC`, pas `service_role`)

### Mise à jour du nom

- RPC `update_current_prestataire_name(p_nom text)` — seul chemin de mutation applicative
- Aucun UPDATE PostgREST (y compris `nom`, `email`, `created_at`, champs commerciaux)

### Code applicatif

- Logique métier : `src/lib/auth/ensure-prestataire-core.ts` (pur, sans `server-only`)
- Entrée serveur : `src/lib/auth/ensure-prestataire.ts` (`server-only`, réexporte le cœur)
- Les tests Auth importent le **même** module cœur (pas de duplication)

### Garde-fou scripts de test

- Cible loopback stricte (`scripts/lib/assert-local-supabase.mjs`)
- `localOnlyFetch` avec `redirect: "error"` injecté dans tous les clients Supabase de test
- Aucune clé cloud héritée

### Diagnostic avant staging

Voir `scripts/diagnose-prestataire-integrity.sql` et la procédure dans `docs/operations/PRE_DEPLOYMENT_CHECKLIST.md`.

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
pnpm test:local-guard
pnpm test:schema
pnpm test:auth
pnpm lint
pnpm typecheck
pnpm build
```

Compteurs locaux mesurés (18 juillet 2026) : `test:local-guard` **26/26** · `test:schema` **33/33** · `test:auth` **38/38**.

## Redirect URLs locales (config.toml)

- `http://localhost:3000/auth/callback`
- `http://localhost:3000/reinitialiser-mot-de-passe`

## Hors périmètre

OAuth Google actif, équipes, RBAC, dashboard métier, Stripe, agent IA.
