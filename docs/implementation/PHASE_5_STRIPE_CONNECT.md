# SID-STRIPE-001 — Socle Stripe Connect et modèle de paiement

Statut : SID-STRIPE-001-FIX-3 implémenté et validé localement. **Prêt pour validation complète ; pas encore validé pour SID-STRIPE-002.**

## Livré

- Migration `20260719150000_sid_stripe_001_connect_payment_foundation.sql`
- Migrations additives `20260720120000_sid_stripe_001_fix_2.sql` et `20260720180000_sid_stripe_001_fix_3.sql`
- Projection Connect sur `prestataire`, dont capacité `sepa_debit_payments`, état durable de provisioning, `ready_for_collection_at`, bindings et `payment_link`
- Primitives serveur `src/lib/stripe/**` (Express, Account Link tenant-safe, Customer live scopé, revérification live par rail, devise EUR)
- Webhook unique `POST /api/stripe/webhook` — `404` immédiate si Stripe est désactivé ; sinon payload brut limité à 1 Mio, signature Stripe, claim atomique fenced, renouvellement, retry plafonné à 8 et `account.updated` idempotent
- Tests : `pnpm test:stripe-001`, Vitest domaine, schema RLS étendu

## Garanties SID-STRIPE-001-FIX-3

- Le pricing historique non vide n'est jamais reclassé ; `early_solo` est uniquement le défaut des nouveaux comptes.
- Le provisioning Connect conserve une clé d'opération et une idempotency key en base. Après crash, la reprise parcourt tous les comptes Stripe, exige une correspondance unique et valide strictement environnement, tenant, type, pays et controller avant toute création.
- La finalisation Connect crée une outbox d'audit dans la même transaction. Sa livraison vers `audit_log` est récupérable et sans doublon, y compris sous concurrence.
- Chaque claim webhook reçoit un `lease_token` neuf. Renouvellement et transition finale exigent token + tentative + lease valide ; un ancien worker ne peut plus finaliser.
- Les erreurs webhook sont classées `retryable`, `terminal` ou `lease_lost`; les retries sont plafonnés à 8 avec terminalisation automatique et raison normalisée.
- `account.updated` relit Stripe live ; token, tentative, lease, type et compte sont vérifiés sous verrou avant toute écriture. Le worker courant peut rafraîchir la projection même si la clé d'effet existe, sans dupliquer le registre. Cette sémantique reste limitée aux projections idempotentes.
- Le mode Stripe est explicite : test en local/staging, live en production. L'activation exige le flag, l'environnement logique et l'ensemble des clés ; le build échoue fermé si le contrat est incomplet.
- Les contraintes de preuve `payment_authorization` sont `NOT VALID` : elles protègent toute nouvelle écriture sans déclarer conformes les lignes historiques. Exécuter `scripts/diagnose-stripe-001-integrity.sql` avant toute préparation de migration distante ; aucune valeur historique n'est inventée.
- Les retries Stripe reçoivent un statut non-2xx tant que le traitement n'est pas durablement terminal. Une panne de persistance du statut produit également un non-2xx.
- Un Customer ne peut être bindé que si ses métadonnées `prestataire`, `client` et `environnement` correspondent exactement au scope local. La rotation passe ensuite par le rôle `stripe_customer_binding_writer` et son JWT pré-généré ; `service_role` ne possède ni la RPC ni le DML direct.

## Validation ciblée locale FIX-3

- `pnpm test:stripe-001` : **20/20** tests Stripe, précédés du garde loopback **54/54**
- Vitest ciblé webhook/configuration/Connect/Customer : **49/49**
- `pnpm typecheck` : réussi

## Hors périmètre (SID-STRIPE-002+)

Checkout paiement, Setup Session, UI onboarding, lien public client, prélèvement auto, WhatsApp, Billing Sidian.
