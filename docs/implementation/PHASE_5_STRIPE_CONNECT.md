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

## Hors périmètre (SID-STRIPE-001)

Checkout paiement, Setup Session, UI onboarding, lien public client, prélèvement auto, WhatsApp, Billing Sidian.

---

# SID-STRIPE-002 — Checkout de paiement, effets financiers et lien public

Statut : **SID-STRIPE-002-A, 002-B (+ correctifs d'audit) et 002-C implémentés et
validés localement.** Chemin Checkout de **paiement** de bout en bout (socle DB,
provisioning, webhooks financiers, lien public, interface minimale prestataire
et client). Le chemin **autorisation future** (Setup Session,
`payment_authorization`, prélèvement auto) reste un lot ultérieur.

## Livré — 002-A (socle, préexistant)

- Migration `20260721120000_sid_stripe_002_a_checkout_foundation.sql` : colonnes
  de provisioning Checkout sur `tentative_paiement` (lease, snapshots, invariants),
  `open_payment_receivable` (ouverture + génération serveur du token, empreinte
  seule), rate limiting persistant (`public_rate_limit_event`).

## Livré — 002-B (ce lot)

**Migrations additives**
- `20260721150000_sid_stripe_002_b_checkout_and_financial_webhooks.sql` :
  provisioning transactionnel (`claim`/`complete`/`fail_checkout_provisioning`,
  lease + reprise après panne avec réutilisation de l'idempotency key),
  recalcul déterministe de la créance (`recalculate_creance_settlement`, trop-perçu),
  effets financiers fencés (`apply_payment_intent_processing`/`succeeded`/`payment_failed`,
  `apply_checkout_session_completed_payment`/`expired_payment`,
  `record_charge_dispute_opened`), garde de fencing partagée `assert_stripe_webhook_lease`.
- `20260721160000_sid_stripe_002_b_link_resolution.sql` :
  `resolve_payment_link_by_token_hash` (lecture serveur pure, lien actif uniquement).

**Services serveur (`src/lib/stripe/**`)**
- `webhooks/payment-effects.ts` + câblage `dispatch.ts` : mappe les objets Stripe
  vers les RPC financières, dispositions `retryable`/`terminal`/`lease_lost`.
- `checkout/create-payment-session.ts` : orchestration (résolution → revérif live
  du compte → claim → Customer → Session Stripe idempotente → complete) et
  `resolvePaymentLinkForDisplay` (affichage sans création de Session).
- `customers/ensure-customer.ts` + `bindStripeCustomerForConnectedAccount` :
  get-or-create Customer scopé au compte connecté + binding via le rôle writer.
- `checkout/rate-limit.ts` : pseudonymisation serveur + consommation des 4 quotas.

**Routes / UI**
- `GET /p/[token]` (résolution + rate limit d'ouverture) → action « Payer »
  (`pay-action.ts`, quotas de création) → redirection Stripe. `p/retour`, `p/annule`.
- Action prestataire `openPaymentReceivableAction` + `PrepareLinkButton`
  (token brut affiché une seule fois).

**Correctifs d'audit 002-B (`20260721170000_sid_stripe_002_b_audit_corrections.sql`)**
- `apply_eur_payment_intent_succeeded` : entrée EUR explicite, seule RPC de succès
  exécutable par `service_role` ; un succès Stripe sans tentative résoluble crée
  une trace d'audit + `approval_request` de rapprochement idempotentes plutôt que
  d'être acquitté silencieusement.
- `resolveConnectedAccountPaymentRails` (`connect/retrieve-and-sync.ts`) : revérification
  live dérive strictement les rails **réellement actifs** (carte, SEPA, les deux, ou
  aucun) — la Session Checkout n'propose jamais un moyen non actif côté compte connecté.

## Livré — 002-C (ce lot — interface minimale de paiement)

**Migration additive**
- `20260721180000_sid_stripe_002_c_public_display_and_status.sql` : lecture seule
  uniquement, aucun invariant financier modifié.
  - `resolve_payment_link_by_token_hash` enrichi : nom prestataire, libellé,
    référence externe, échéance, indicateur `pending_payment` (SEPA en traitement).
  - `resolve_payment_status_by_checkout_session_id` (nouvelle) : statut d'une
    tentative par identifiant de Session Checkout (capacité opaque Stripe) —
    aucun identifiant interne exposé — pour la revérification serveur de `/retour`.

**Services serveur**
- `checkout/resolve-checkout-status.ts` : mappe l'état `tentative_paiement` vers
  `confirmed` / `processing` / `not_confirmed` / `unknown` pour `/retour`.
- `connect/readiness.ts` : projection Stripe locale pour affichage prestataire
  uniquement (jamais une décision financière).
- `creances/creance-core.ts` : `listPaidAmountsByCreanceIds` (montant réglé par
  créance, agrégation applicative sur `paiement`, RLS déjà scopée).

**UI**
- `/p/[token]` : nom prestataire, libellé/référence, échéance, bouton
  « Régler maintenant », états payable / déjà réglé / paiement en cours / lien
  invalide / compte indisponible / aucun moyen disponible / erreur temporaire.
- `/p/retour` : ne conclut jamais du seul query param Stripe — revérifie via
  `resolveCheckoutReturnStatus` ; bouton « Vérifier à nouveau » (`router.refresh()`,
  nouveau rendu serveur, jamais une relecture client des query params).
- `/p/annule` : inchangé (déjà conforme — aucune écriture, retour au lien existant).
- Prestataire : `ReceivablePaymentSection` (composant réutilisable) — total / réglé /
  solde / statut / lien copiable / disponibilité Stripe lisible.
- Routes publiques (`/p/*`) : `noindex`, `no-store`, `Referrer-Policy: no-referrer`
  déjà posés en amont (`next.config.ts`, `publicPaymentRouteHeaders`).

## Décisions notables

- **Trop-perçu** : `paiement.montant` = montant reçu (autoritatif Stripe) ; créance
  `RÉGLÉE` au solde atteint, excédent tracé (`audit_log` + `approval_request`),
  jamais d'état improvisé ni de perte de fonds. Paiement sur créance terminale :
  fonds enregistrés + garde-fou humain, état terminal jamais ressuscité.
- **Idempotence / concurrence** : effets financiers appliqués au plus une fois via
  `stripe_webhook_effect` ; création de `paiement` idempotente (unique sur tentative) ;
  provisioning sérialisé par créance ; ordre de verrou créance→tentative constant ;
  tolérance au désordre et aux doublons d'arrivée des webhooks.
- **Litige** (`charge.dispute.created`) : trace d'audit obligatoire + `approval_request`,
  jamais de réécriture de `paiement`. Suspension d'autorisation `prelevement_auto` et
  escalade `dossier_suivi` câblées dans leurs lots respectifs (aucune ligne concernée
  n'existe encore).
- **Paiement en cours (002-C)** : un `EN_TRAITEMENT` non résolu bloque une nouvelle
  Session (affichage ET création) — jamais de double provisioning pendant qu'un
  prélèvement SEPA est en traitement.

## Validation locale

- `pnpm test:stripe-002-b` : **18/18** (inclut les correctifs d'audit).
- `pnpm test:stripe-002-c` : **12/12** (nouveau).
- Suite complète (`pnpm test`) : loopback 54/54, schema 33/33, auth 38/38,
  prod-001 50/50, stripe-001 20/20, stripe-002-a 12/12, stripe-002-b 18/18,
  stripe-002-c 12/12, Vitest.
- `pnpm typecheck`, `pnpm lint`, `pnpm build` (contrat désactivé) : OK.

## Réserves

- **Validation Stripe live** du chemin création de Session / Customer / redirection non
  exécutée localement (Stripe désactivé : `NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED=false`).
  Code couvert par typecheck, tests unitaires mockés et build ; E2E à rejouer sur un
  environnement Stripe test avec compte Connect.
- **Dérivation du moyen** (`carte`/`sepa_core`) best-effort à partir de l'événement,
  `null` si ambigu (colonne nullable, non structurante financièrement).
- **SID-STRIPE-002-A** : un test (`purge_expired_public_rate_limits`) reste
  intermittent (course de timing réelle, pas un défaut fonctionnel) — identifié et
  documenté séparément comme dette technique, non traité dans ce lot.
- Chemin **autorisation future** différé (cf. ci-dessus).
