/**
 * Runtime paiements automatiques (P0) — file de jobs + exécuteur fail-closed.
 *
 * - Scanners → enqueue uniquement
 * - Exécuteur → checklist 03 §4 → PaymentIntent off-session carte
 * - Webhook Stripe = source de vérité pour RÉUSSIE / paiement
 * - Jamais de débit depuis un webhook entrant
 */

export {
  AUTOMATIC_EXECUTION_GUARD_VERSION,
  AUTO_DEBIT_REGLE_CEILING_PRODUCT_READY,
  PAYMENT_JOB_LEASE_SECONDS,
  PAYMENT_RUNTIME_CURRENCY,
  PAYMENT_RUNTIME_STRIPE_CURRENCY,
  STRIPE_OFF_SESSION_IDEMPOTENCY_PREFIX,
} from "./constants";

export {
  PAYMENT_RUNTIME_ERROR_CODES,
  PaymentRuntimeError,
  isPaymentRuntimeError,
} from "./errors";
export type {
  PaymentRuntimeErrorCode,
  PaymentRuntimeErrorCategory,
} from "./errors";

export { evaluateAutomaticPaymentChecklist } from "./checklist";

export {
  buildOffSessionStripeIdempotencyKey,
  buildPaymentJobIdempotencyKey,
} from "./idempotency";

export {
  createPaymentRuntimeService,
} from "./service";
export type {
  PaymentExecutorDeps,
  PaymentRuntimeService,
} from "./service";

export {
  enqueueAutomaticPaymentCandidates,
} from "./scanner";
export type {
  AutomaticPaymentCandidate,
  ScanAutomaticPaymentsResult,
} from "./scanner";

export {
  createPaymentCreateAttemptExecutor,
  createPaymentRuntimeExecutors,
} from "./agent-executor";

export {
  createMemoryPaymentJobRepository,
  createMemoryPaymentAttemptRepository,
} from "./memory-repository";

export {
  createSupabasePaymentJobRepository,
  createSupabasePaymentAttemptRepository,
} from "./supabase-repository";

export { createOffSessionCardPaymentIntent } from "./stripe-off-session";

export type {
  PaymentJob,
  PaymentJobSource,
  PaymentJobStatus,
  AutomaticPaymentChecklistInput,
  ChecklistResult,
  DrainJobResult,
  PaymentCreateAttemptToolOutput,
  OffSessionProviderOutcome,
} from "./types";

export type {
  PaymentJobRepository,
  PaymentAttemptRepository,
} from "./repository";
