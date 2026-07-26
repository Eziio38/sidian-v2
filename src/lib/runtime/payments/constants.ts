/**
 * Constantes du runtime prélèvement automatique (P0).
 * La version de garde doit rester alignée sur
 * `enforce_automatic_payment_attempt_guard` (SID-STRIPE-003).
 */

/** Version du garde déterministe SQL / TypeScript — jamais fournie par le navigateur. */
export const AUTOMATIC_EXECUTION_GUARD_VERSION =
  "sidian-auto-payment-guard-v1" as const;

/** Devise produit (majuscules) — MVP strict EUR. */
export const PAYMENT_RUNTIME_CURRENCY = "EUR" as const;

/** Devise Stripe API (minuscules). */
export const PAYMENT_RUNTIME_STRIPE_CURRENCY = "eur" as const;

/**
 * Plafond produit auto-débit : aucun `regle_parametre` dédié n'existe encore
 * (03 §4 — liste hypothétique). Tant que ce flag reste false, la checklist
 * refuse tout mouvement d'argent plutôt que d'inventer un plafond.
 */
export const AUTO_DEBIT_REGLE_CEILING_PRODUCT_READY = false;

/** Lease worker pour claim d'un job / tentative (secondes). */
export const PAYMENT_JOB_LEASE_SECONDS = 120;

/** Préfixe stable des clés d'idempotence Stripe PaymentIntent off-session. */
export const STRIPE_OFF_SESSION_IDEMPOTENCY_PREFIX =
  "sidian_offsession_pi" as const;
