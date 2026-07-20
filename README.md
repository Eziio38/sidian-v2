# Sidian

SaaS B2B français qui suit les règlements de ses clients et évite au fondateur d'une agence ou d'une entreprise indépendante d'avoir à relancer personnellement ses propres clients.

**Changement de modèle produit le 14 juillet 2026** — voir `AGENTS.md` et la bannière d'obsolescence de `docs/archive/legacy-v1/LEGACY_SIDIAN_CURSOR_UPDATED_V1_DO_NOT_USE.md` avant de lire tout document antérieur à cette date.

## Ce que fait Sidian aujourd'hui (modèle actif)

- Le prestataire crée un **paiement à recevoir** (jamais une facture légale — Sidian reste découplé de la facturation).
- Le premier règlement du client est **volontaire**, via un lien de paiement (carte ou SEPA Core, au choix du client).
- Après ce premier règlement, Sidian propose au client d'**autoriser les règlements futurs** avec ce même prestataire (carte enregistrée ou mandat SEPA) — jamais avant.
- Un agent conversationnel gère la communication (rappels préventifs, relances graduées, dialogue) dans un registre libre, et applique des règles configurables dans un registre encadré (garde-fous non contournables sur tout ce qui touche à l'argent ou à l'engagement).
- Pricing actif pendant la bêta : **Early Access à 49 € HT/mois, commission Sidian à 0 %**, limité aux 20 premiers comptes.

## Documentation de référence

Avant toute modification produit, paiement ou intégration, consulter dans cet ordre :

1. [`docs/SIDIAN_01_FONDATIONS_V2.md`](docs/SIDIAN_01_FONDATIONS_V2.md) — vision, recherche marché, ICP, principes fondateurs, contraintes légales.
2. [`docs/SIDIAN_02_PRD_V2.md`](docs/SIDIAN_02_PRD_V2.md) — parcours utilisateur, rôle de l'agent, stratégie de paiement, modèle économique, périmètre MVP.
3. [`docs/SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md`](docs/SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md) — modèle de données, machines d'état, intégrations, workers.
4. [`docs/SIDIAN_DESIGN_SYSTEM.md`](docs/SIDIAN_DESIGN_SYSTEM.md) + [`docs/SIDIAN_UI_PATTERNS.md`](docs/SIDIAN_UI_PATTERNS.md) — pour tout travail d'interface, à lire ensemble.
5. [`docs/operations/`](docs/operations/) — `PAYMENTS_RUNBOOK.md`, `PRE_DEPLOYMENT_CHECKLIST.md`, `STRIPE_TEST_MODE_VALIDATION.md`.

Voir `AGENTS.md` pour la hiérarchie complète et les règles de résolution de contradiction.

## Stack

| Couche | Outil | Notes |
|---|---|---|
| Framework | Next.js (App Router + TypeScript) | Front + API dans un seul repo |
| Hébergement | Vercel | |
| DB + Auth | Supabase | RLS activée sur toutes les tables `prestataire`-scopées (invariant non négociable, cf. 03 §6) |
| Paiements | Stripe Connect (direct charge) | Carte + SEPA Core, `application_fee_amount` configurable à 0 pendant l'Early Access |
| IA | Fournisseur configurable via profils abstraits (`classification` / `conversation` / `reasoning`) | Jamais couplé en dur à un nom de modèle — cf. 03 §10 |
| Emails | À confirmer au fil de l'implémentation | Séquences de communication, notices |
| Crons / jobs | À confirmer au fil de l'implémentation | Workers du dossier de suivi, cf. 03 §7 |
| Validation | Zod (ou équivalent) sur tous les inputs | |

**Hors périmètre MVP, backlog explicite (cf. 02 §8) :** intégration Pennylane, agrégation bancaire, statut PDP, MCP/assistants externes, rôles équipe/multi-utilisateurs.

## Installation

```bash
npm install
# ou
pnpm install
```

## Variables d'environnement

Voir `.env.example` et `docs/operations/PRE_DEPLOYMENT_CHECKLIST.md` §9. **Ne jamais committer les valeurs réelles.** Variables obligatoires a minima :

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED=false
SIDIAN_ENVIRONMENT=local
STRIPE_MODE=test
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_CONNECT_WEBHOOK_SECRET=
```

## Supabase local

**Prérequis :** [Docker Desktop](https://www.docker.com/products/docker-desktop/) (ou équivalent) pour exécuter la stack Supabase locale.

Aucune migration staging n'est appliquée automatiquement depuis le code.

```bash
pnpm supabase:start
pnpm supabase:status
pnpm supabase:reset
pnpm test:schema
pnpm supabase:types
```

Récupérez les valeurs locales (`API URL`, `anon key`, `service_role key`) depuis la sortie de `pnpm supabase:status`, puis copiez-les dans un fichier `.env.local` à la racine du projet (jamais commité). Utilisez `.env.example` comme modèle.

```bash
pnpm supabase:stop
```

### Projet staging (manuel)

Le projet distant `sidian-v2-staging` n'est pas créé automatiquement. Créez-le depuis le [dashboard Supabase](https://supabase.com/dashboard), région européenne, puis reportez `Project URL`, `anon key` et `service_role key` uniquement dans `.env.local` ou les variables d'environnement de préproduction.

Vérification locale du schéma :

```bash
pnpm supabase:reset
pnpm test:schema
pnpm supabase:types
```

Le schéma courant (17 tables, dont les registres techniques Stripe) est versionné dans `supabase/migrations/` et testé localement via `pnpm test:schema`.

## Tests

```bash
pnpm test:schema
pnpm test:auth
pnpm typecheck
pnpm lint
pnpm build
```

## Authentification (phase 3)

Pages disponibles :

- `/inscription` — création de compte email + mot de passe (confirmation requise)
- `/connexion` — connexion
- `/app` — espace prestataire temporaire protégé

Redirect URLs à configurer dans Supabase (local via `supabase/config.toml`, staging via le dashboard) :

- `http://localhost:3000/auth/callback`
- `http://localhost:3000/reinitialiser-mot-de-passe`

Voir `docs/implementation/PHASE_3_AUTH.md` pour le détail de l'onboarding prestataire.

## Déploiement

Voir `docs/operations/PRE_DEPLOYMENT_CHECKLIST.md` — **statut actuel : NO-GO PRODUCTION**, nouveau modèle en cours d'implémentation.

```bash
stripe listen --forward-connect-to localhost:3000/api/stripe/webhook
```

## Règles de sécurité (non négociables)

- Aucune donnée de carte ou d'IBAN brute stockée — références Stripe uniquement.
- RLS activée sur toutes les tables `prestataire`-scopées.
- Aucune écriture directe d'un modèle IA dans Stripe ou Supabase — toute action passe par une fonction métier déterministe (registre encadré, cf. 03 §4/§10).
- Toute action sensible (montant, engagement, action formelle) est tracée dans `audit_log` et peut nécessiter une `approval_request`.

Détail complet : `docs/SIDIAN_01_FONDATIONS_V2.md` §4, `docs/SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md` §4 et §6.

## État actuel de la reconstruction

Le produit repart d'un modèle entièrement nouveau depuis le 14 juillet 2026 (voir `AGENTS.md`). Le code antérieur à cette date (construit autour de l'enrôlement obligatoire, de la séquence J0/J5/J9/J10 et de `mission_status`) doit être trié selon la méthode définie dans `AGENTS.md` avant réutilisation — ce qui dépend de l'ancien modèle est à réécrire, ce qui est neutre (auth, design system, infra) se garde. Les migrations du nouveau schéma et le socle Stripe Connect sont appliqués et vérifiés localement ; aucun déploiement distant n'est implicite.
