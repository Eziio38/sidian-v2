import "server-only";

/**
 * Événements de l'endpoint webhook FACTURATION. Volontairement disjoint de
 * `@/lib/stripe/webhooks/event-types` (endpoint Connect) : si l'une des deux
 * listes recouvrait l'autre, un événement pourrait être traité par le mauvais
 * chemin avec le mauvais secret.
 */
export const SIDIAN_BILLING_WEBHOOK_EVENTS = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
] as const;

export type SidianBillingWebhookEventType =
  (typeof SIDIAN_BILLING_WEBHOOK_EVENTS)[number];

export function isSidianBillingWebhookEvent(
  type: string,
): type is SidianBillingWebhookEventType {
  return (SIDIAN_BILLING_WEBHOOK_EVENTS as readonly string[]).includes(type);
}
