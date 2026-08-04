import { createHash } from "node:crypto";

import { STRIPE_OFF_SESSION_IDEMPOTENCY_PREFIX } from "./constants";

/**
 * Clé d'idempotence Stripe stable pour un essai off-session.
 * Ne jamais y inclure d'aléa : les reprises après panne doivent rejouer la même clé.
 */
export function buildOffSessionStripeIdempotencyKey(params: {
  creanceId: string;
  amountCents: number;
  currency: string;
  authorizationId: string;
  attemptVersion: string;
}): string {
  const material = [
    params.creanceId,
    String(params.amountCents),
    params.currency.toUpperCase(),
    params.authorizationId,
    params.attemptVersion,
  ].join("|");
  const digest = createHash("sha256").update(material, "utf8").digest("hex");
  return `${STRIPE_OFF_SESSION_IDEMPOTENCY_PREFIX}_${digest.slice(0, 48)}`;
}

/** Clé d'idempotence de file de jobs (scanner / agent). */
export function buildPaymentJobIdempotencyKey(params: {
  creanceId: string;
  amountCents: number;
  currency: string;
  attemptVersion: string;
  source: "scanner" | "agent_tool";
}): string {
  const material = [
    params.source,
    params.creanceId,
    String(params.amountCents),
    params.currency.toUpperCase(),
    params.attemptVersion,
  ].join("|");
  const digest = createHash("sha256").update(material, "utf8").digest("hex");
  return `sidian_payment_job_${digest.slice(0, 48)}`;
}
