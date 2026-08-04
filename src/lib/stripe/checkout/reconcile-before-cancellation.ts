import "server-only";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getStripeClient } from "@/lib/stripe/client";
import { assertConnectedScope } from "@/lib/stripe/shared/assert-connected-scope";
import { StripeDomainError } from "@/lib/stripe/shared/errors";
import type { Database } from "@/types/database.generated";

type DbClient = SupabaseClient<Database>;

type KnownCheckoutAttempt = {
  id: string;
  state: Database["public"]["Enums"]["tentative_paiement_etat"];
  stripeAccountId: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
};

type CancellationStripeContext = {
  receivableId: string;
  stripeAccountId: string | null;
  attempts: KnownCheckoutAttempt[];
};

function reconciliationError(
  code:
    | "payment_receivable_stripe_context_unavailable"
    | "payment_receivable_stripe_identity_mismatch"
    | "payment_receivable_stripe_reconciliation_failed"
    | "payment_receivable_stripe_session_not_safely_terminal",
  disposition: "retryable" | "terminal" = "retryable",
): StripeDomainError {
  return new StripeDomainError(code, undefined, disposition);
}

function stringId(
  value: string | { id?: string | null } | null | undefined,
): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && typeof value.id === "string") {
    return value.id;
  }
  return null;
}

async function loadCancellationStripeContext(
  supabase: DbClient,
  receivableId: string,
): Promise<CancellationStripeContext> {
  const receivableResult = await supabase
    .from("creance")
    .select("id, prestataire_id")
    .eq("id", receivableId)
    .maybeSingle();

  if (receivableResult.error) {
    throw reconciliationError("payment_receivable_stripe_context_unavailable");
  }
  if (!receivableResult.data) {
    throw new StripeDomainError(
      "payment_receivable_not_found",
      undefined,
      "terminal",
    );
  }

  const [prestataireResult, attemptsResult] = await Promise.all([
    supabase
      .from("prestataire")
      .select("stripe_account_id")
      .eq("id", receivableResult.data.prestataire_id)
      .maybeSingle(),
    supabase
      .from("tentative_paiement")
      .select(
        "id, etat, stripe_account_id, stripe_checkout_session_id, stripe_payment_intent_id",
      )
      .eq("creance_id", receivableResult.data.id)
      .not("stripe_checkout_session_id", "is", null)
      .order("created_at", { ascending: true }),
  ]);

  if (prestataireResult.error || attemptsResult.error || !prestataireResult.data) {
    throw reconciliationError("payment_receivable_stripe_context_unavailable");
  }

  const attempts: KnownCheckoutAttempt[] = [];
  for (const attempt of attemptsResult.data ?? []) {
    const stripeCheckoutSessionId = attempt.stripe_checkout_session_id?.trim();
    const stripeAccountId = attempt.stripe_account_id?.trim();
    if (!stripeCheckoutSessionId || !stripeAccountId) {
      throw reconciliationError(
        "payment_receivable_stripe_identity_mismatch",
        "terminal",
      );
    }
    attempts.push({
      id: attempt.id,
      state: attempt.etat,
      stripeAccountId,
      stripeCheckoutSessionId,
      stripePaymentIntentId: attempt.stripe_payment_intent_id,
    });
  }

  return {
    receivableId: receivableResult.data.id,
    stripeAccountId: prestataireResult.data.stripe_account_id,
    attempts,
  };
}

function assertCheckoutSessionIdentity(params: {
  session: Stripe.Checkout.Session;
  attempt: KnownCheckoutAttempt;
  receivableId: string;
}): void {
  const { session, attempt, receivableId } = params;
  const metadata = session.metadata;
  const paymentIntentId = stringId(session.payment_intent);

  if (
    session.object !== "checkout.session" ||
    session.id !== attempt.stripeCheckoutSessionId ||
    session.mode !== "payment" ||
    session.currency?.toLowerCase() !== "eur" ||
    session.client_reference_id !== attempt.id ||
    metadata?.sidian_tentative_id !== attempt.id ||
    metadata?.sidian_creance_id !== receivableId ||
    (attempt.stripePaymentIntentId !== null &&
      paymentIntentId !== attempt.stripePaymentIntentId)
  ) {
    throw reconciliationError(
      "payment_receivable_stripe_identity_mismatch",
      "terminal",
    );
  }
}

function assertSafelyExpired(session: Stripe.Checkout.Session): void {
  // `complete` est terminal pour Checkout, mais ne prouve pas un échec
  // financier : un SEPA peut encore être en traitement. Seul `expired` et
  // explicitement impayé autorise la suite de l'annulation.
  if (session.status !== "expired" || session.payment_status !== "unpaid") {
    throw reconciliationError(
      "payment_receivable_stripe_session_not_safely_terminal",
    );
  }
}

async function retrieveSession(params: {
  stripe: Stripe;
  stripeAccountId: string;
  sessionId: string;
}): Promise<Stripe.Checkout.Session> {
  try {
    return await params.stripe.checkout.sessions.retrieve(
      params.sessionId,
      {},
      { stripeAccount: params.stripeAccountId },
    );
  } catch {
    throw reconciliationError("payment_receivable_stripe_reconciliation_failed");
  }
}

async function expireSession(params: {
  stripe: Stripe;
  stripeAccountId: string;
  sessionId: string;
}): Promise<Stripe.Checkout.Session> {
  try {
    return await params.stripe.checkout.sessions.expire(
      params.sessionId,
      {},
      {
        stripeAccount: params.stripeAccountId,
        idempotencyKey: `sidian_cancel_checkout_${params.sessionId}`,
      },
    );
  } catch {
    // Une erreur réseau peut masquer un succès Stripe : aucun effet local tant
    // qu'un appel ultérieur à retrieve ne prouve pas l'expiration.
    throw reconciliationError("payment_receivable_stripe_reconciliation_failed");
  }
}

/**
 * Barrière Stripe autoritative exécutée avant l'annulation SQL.
 *
 * Toutes les données Stripe sont relues derrière la RLS à partir du seul UUID
 * reçu du navigateur. Une Session ouverte est expirée dans son compte Connect ;
 * aucune annulation locale n'est tentée si l'identité ou la terminalité reste
 * ambiguë.
 */
export async function reconcileCheckoutSessionsBeforeCancellation(params: {
  supabase: DbClient;
  receivableId: string;
  stripe?: Stripe;
}): Promise<void> {
  const context = await loadCancellationStripeContext(
    params.supabase,
    params.receivableId,
  );

  if (context.attempts.length === 0) return;

  const stripeAccountId = context.stripeAccountId?.trim();
  if (!stripeAccountId) {
    throw reconciliationError(
      "payment_receivable_stripe_identity_mismatch",
      "terminal",
    );
  }

  // Valide tout le scope local avant le premier effet Stripe externe.
  for (const attempt of context.attempts) {
    assertConnectedScope({
      expectedAccountId: stripeAccountId,
      actualAccountId: attempt.stripeAccountId,
      context: "payment_receivable.cancellation",
    });
  }

  const stripe = params.stripe ?? getStripeClient();
  const liveSessions = await Promise.all(
    context.attempts.map(async (attempt) => {
      const session = await retrieveSession({
        stripe,
        stripeAccountId,
        sessionId: attempt.stripeCheckoutSessionId,
      });
      assertCheckoutSessionIdentity({
        session,
        attempt,
        receivableId: context.receivableId,
      });
      if (session.status !== "open") {
        assertSafelyExpired(session);
      }
      return { attempt, session };
    }),
  );

  // Les Sessions non sûres ont déjà fait échouer Promise.all ci-dessus. On ne
  // commence les expirations qu'après validation de l'ensemble connu.
  for (const { attempt, session } of liveSessions) {
    if (session.status !== "open") continue;
    const expired = await expireSession({
      stripe,
      stripeAccountId,
      sessionId: attempt.stripeCheckoutSessionId,
    });
    assertCheckoutSessionIdentity({
      session: expired,
      attempt,
      receivableId: context.receivableId,
    });
    assertSafelyExpired(expired);
  }
}
