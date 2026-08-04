import "server-only";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import { StripeDomainError } from "@/lib/stripe/shared/errors";
import type { Database } from "@/types/database.generated";

type AdminClient = SupabaseClient<Database>;

export type PaymentIntentAttemptProjection = Pick<
  Database["public"]["Tables"]["tentative_paiement"]["Row"],
  | "id"
  | "creance_id"
  | "montant"
  | "stripe_account_id"
  | "stripe_customer_id"
  | "stripe_payment_intent_id"
  | "application_fee_amount"
>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stringId(
  value: string | { id?: string | null } | null | undefined,
): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && typeof value.id === "string") {
    return value.id;
  }
  return null;
}

function identityMismatch(): StripeDomainError {
  return new StripeDomainError(
    "webhook_payment_intent_identity_mismatch",
    undefined,
    "terminal",
  );
}

/**
 * Recoupe l'objet PaymentIntent signé avec la projection créée avant Stripe.
 * Cette fonction n'écrit rien et n'utilise aucune donnée du navigateur.
 */
export function assertPaymentIntentProjectionIdentity(params: {
  paymentIntent: Stripe.PaymentIntent;
  connectedAccountId: string;
  attempt: PaymentIntentAttemptProjection;
}): void {
  const { paymentIntent: pi, connectedAccountId, attempt } = params;
  const metadataAttemptId = pi.metadata?.sidian_tentative_id;
  const metadataReceivableId = pi.metadata?.sidian_creance_id;
  const customerId = stringId(pi.customer);
  const localFee = attempt.application_fee_amount ?? 0;
  const stripeFee = pi.application_fee_amount ?? 0;

  if (
    pi.object !== "payment_intent" ||
    !pi.id ||
    pi.currency?.toLowerCase() !== "eur" ||
    !Number.isSafeInteger(pi.amount) ||
    pi.amount <= 0 ||
    pi.amount !== attempt.montant ||
    !metadataAttemptId ||
    metadataAttemptId !== attempt.id ||
    !metadataReceivableId ||
    metadataReceivableId !== attempt.creance_id ||
    attempt.stripe_account_id !== connectedAccountId ||
    !attempt.stripe_customer_id ||
    customerId !== attempt.stripe_customer_id ||
    (attempt.stripe_payment_intent_id !== null &&
      attempt.stripe_payment_intent_id !== pi.id) ||
    stripeFee !== localFee
  ) {
    throw identityMismatch();
  }
}

async function loadAttempt(
  supabase: AdminClient,
  column: "id" | "stripe_payment_intent_id",
  value: string,
): Promise<PaymentIntentAttemptProjection | null> {
  const { data, error } = await supabase
    .from("tentative_paiement")
    .select(
      "id, creance_id, montant, stripe_account_id, stripe_customer_id, stripe_payment_intent_id, application_fee_amount",
    )
    .eq(column, value)
    .maybeSingle();

  if (error) {
    throw new StripeDomainError(
      "webhook_payment_intent_identity_lookup_failed",
      undefined,
      "retryable",
    );
  }
  return data;
}

/**
 * Résout par identifiant Stripe et par métadonnée. Un succès réellement
 * orphelin reste `null` afin que la primitive SQL F2 crée son rapprochement
 * humain durable ; deux résolutions contradictoires sont terminales.
 */
export async function resolveAndAssertPaymentIntentIdentity(params: {
  supabase: AdminClient;
  paymentIntent: Stripe.PaymentIntent;
  connectedAccountId: string;
}): Promise<PaymentIntentAttemptProjection | null> {
  const metadataAttemptId = params.paymentIntent.metadata?.sidian_tentative_id;
  const validMetadataAttemptId =
    typeof metadataAttemptId === "string" && UUID_RE.test(metadataAttemptId)
      ? metadataAttemptId
      : null;

  const [byPaymentIntent, byMetadata] = await Promise.all([
    loadAttempt(
      params.supabase,
      "stripe_payment_intent_id",
      params.paymentIntent.id,
    ),
    validMetadataAttemptId
      ? loadAttempt(params.supabase, "id", validMetadataAttemptId)
      : Promise.resolve(null),
  ]);

  if (
    byPaymentIntent &&
    byMetadata &&
    byPaymentIntent.id !== byMetadata.id
  ) {
    throw identityMismatch();
  }

  const attempt = byPaymentIntent ?? byMetadata;
  if (!attempt) return null;

  assertPaymentIntentProjectionIdentity({
    paymentIntent: params.paymentIntent,
    connectedAccountId: params.connectedAccountId,
    attempt,
  });
  return attempt;
}
