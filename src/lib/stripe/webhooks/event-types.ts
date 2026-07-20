import "server-only";

/**
 * Liste MVP des événements Stripe reconnus (doc 03).
 * Hors account.updated : dispatcher typé sans transition métier simulée.
 */
export const SIDIAN_STRIPE_WEBHOOK_EVENTS = [
  "account.updated",
  "checkout.session.completed",
  "checkout.session.expired",
  "payment_intent.processing",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "setup_intent.succeeded",
  "setup_intent.setup_failed",
  "payment_method.detached",
  "mandate.updated",
  "charge.dispute.created",
] as const;

export type SidianStripeWebhookEventType =
  (typeof SIDIAN_STRIPE_WEBHOOK_EVENTS)[number];

export function isKnownStripeWebhookEvent(
  type: string,
): type is SidianStripeWebhookEventType {
  return (SIDIAN_STRIPE_WEBHOOK_EVENTS as readonly string[]).includes(type);
}
