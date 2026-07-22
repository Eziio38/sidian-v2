# SID-STRIPE-003 / SID-PROD-004 — reprise locale (22 juillet 2026)

Branche : **`develop`**

Statut : **terminé localement ; aucune migration distante ; non commité tant que
validation produit non confirmée**.

## Migrations ajoutées (locales uniquement)

Ordre appliqué par `pnpm supabase db reset` :

1. `20260721210300_sid_stripe_003_future_authorizations.sql`
2. `20260721210400_sid_prod_004_payment_reconciliation.sql`
3. `20260721210500_sid_stripe_003_orphan_webhook_audit.sql`
4. `20260721210600_sid_stripe_003_checkout_expiry_projection.sql`

## Stratégie autorisations legacy (fail-closed)

Les projections `payment_authorization` antérieures à SID-STRIPE-003 peuvent
être `ACTIVE` sans les snapshots setup exigés par les nouvelles contraintes.

À l’apply :

1. colonne explicite `legacy_incomplete boolean not null default false` ;
2. `UPDATE` des lignes configurées sans snapshots complets :
   `legacy_incomplete = true`, `is_default = false`, passage en `SUSPENDUE`
   (si encore exploitables) avec `suspension_reason = 'legacy_incomplete_projection'` ;
3. **aucun** identifiant Stripe inventé ;
4. contraintes strictes pour `legacy_incomplete = false` ; exemption bornée
   pour les lignes legacy ;
5. garde off-session et `set_default_payment_authorization` refusent toute
   ligne `legacy_incomplete` ;
6. un webhook mandate ne peut pas réactiver une legacy.

Les nouvelles autorisations ne deviennent `ACTIVE` qu’après SetupIntent réussi
avec preuves complètes.

## Secret HMAC

Variable serveur `SIDIAN_PAYMENT_AUTHORIZATION_TOKEN_SECRET` (≥ 32 caractères,
jamais `NEXT_PUBLIC_`, jamais dérivée de `SUPABASE_SERVICE_ROLE_KEY`).
Absence → échec fermé. TTL token public : 24 h, vérifiée côté SQL.

## Tests exécutés localement

- `pnpm supabase db reset` — migrations `212103` → `212106` appliquées
- `pnpm test:stripe-003` — 11/11
- `pnpm test:prod-004` — 9/9
- `pnpm test:stripe-003-orphan-audit` — 6/6
- `pnpm test` (suite générale) — vert, dont Vitest 62 fichiers / 357 tests
- `pnpm typecheck` / `pnpm build` — OK

Aucune migration distante. Stash de sauvegarde Codex conservé.

## Limitations restantes

- Aucune migration Preview/Production appliquée.
- SEPA off-session toujours fermé sans validation prénotification Stripe.
- Pas de worker de reprise webhook ni scanner batch de réconciliation.
- Après `pnpm supabase:types`, certains Args uuid/text nullable doivent garder
  `| null` (commentaire `NULLABLE_RPC_ARGS_PATCH` dans
  `src/types/database.generated.ts`).

## Avant staging

1. Poser `SIDIAN_PAYMENT_AUTHORIZATION_TOKEN_SECRET` (secret dédié).
2. Appliquer les 4 migrations sur le projet staging **après** revue explicite.
3. Smoke Connect + Checkout test + webhooks setup/payment.
4. Confirmer qu’aucune autorisation legacy n’est proposée en off-session.
