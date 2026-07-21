import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getStripeClient } from "@/lib/stripe/client";
import { ensureStripeCustomerForClient } from "@/lib/stripe/customers/ensure-customer";
import {
  resolveConnectedAccountPaymentRails,
  type SidianPaymentRail,
} from "@/lib/stripe/connect/retrieve-and-sync";
import {
  consumePublicRateLimit,
  pseudonymizeRateLimitSubject,
  type PublicRateLimitCategory,
} from "@/lib/stripe/checkout/rate-limit";
import { classifyStripeFailure, StripeDomainError } from "@/lib/stripe/shared/errors";
import type { Database } from "@/types/database.generated";

type Db = Database;
type AdminClient = SupabaseClient<Db>;
type SidianEnvironment = "local" | "staging" | "production";

// Format du token brut émis par open_payment_receivable (base64url, 32 octets).
const RAW_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const SESSION_TTL_SECONDS = 30 * 60;

export type CreatePaymentSessionResult =
  | { status: "ready"; url: string; tentativeId: string }
  | { status: "not_found" }
  | { status: "not_payable"; reason: string }
  | {
      status: "rate_limited";
      category: PublicRateLimitCategory;
      resetAt: string | null;
    }
  | { status: "retry" };

type ResolvedLink = {
  found: boolean;
  payment_link_id?: string;
  creance_id?: string;
  prestataire_id?: string;
  client_payeur_id?: string;
  stripe_account_id?: string | null;
  montant?: number;
  devise?: string;
  remaining?: number;
  creance_etat?: string;
  creance_archived?: boolean;
  client_email?: string | null;
  client_nom?: string | null;
};

type ClaimResult = {
  status: "claimed" | "reclaimed" | "in_progress" | "already_created";
  tentative_id?: string | null;
  montant?: number;
  idempotency_key?: string;
  lease_token?: string;
  stripe_checkout_session_id?: string;
};

function tokenHashOf(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export type ResolveLinkDisplayResult =
  | { status: "not_found" }
  | {
      status: "rate_limited";
      category: PublicRateLimitCategory;
      resetAt: string | null;
    }
  | {
      status: "display";
      payable: boolean;
      reason?: string;
      montant: number;
      remaining: number;
      clientNom: string | null;
    };

/**
 * Résout un lien pour AFFICHAGE (page publique), sans créer de Session Stripe.
 * Consomme uniquement les quotas d'ouverture. La payabilité affichée est de
 * niveau lien/créance ; la payabilité réelle (compte connecté live) est
 * revérifiée au moment de l'action « Payer » (createPaymentCheckoutSession).
 */
export async function resolvePaymentLinkForDisplay(params: {
  supabaseAdmin: AdminClient;
  rawToken: string;
  clientIp: string;
}): Promise<ResolveLinkDisplayResult> {
  const admin = params.supabaseAdmin;

  const ipDecision = await consumePublicRateLimit({
    supabaseAdmin: admin,
    category: "link_resolution_ip",
    subjectHash: pseudonymizeRateLimitSubject("link_resolution_ip", params.clientIp),
  });
  if (!ipDecision.allowed) {
    return { status: "rate_limited", category: "link_resolution_ip", resetAt: ipDecision.reset_at };
  }

  if (!RAW_TOKEN_RE.test(params.rawToken)) {
    return { status: "not_found" };
  }

  const tokenDecision = await consumePublicRateLimit({
    supabaseAdmin: admin,
    category: "link_resolution_token",
    subjectHash: pseudonymizeRateLimitSubject("link_resolution_token", params.rawToken),
  });
  if (!tokenDecision.allowed) {
    return { status: "rate_limited", category: "link_resolution_token", resetAt: tokenDecision.reset_at };
  }

  const { data, error } = await admin.rpc("resolve_payment_link_by_token_hash", {
    p_token_hash: tokenHashOf(params.rawToken),
  });
  if (error) {
    throw new StripeDomainError("payment_link_resolution_failed", undefined, "retryable");
  }
  const resolved = (data ?? { found: false }) as ResolvedLink;
  if (!resolved.found) {
    return { status: "not_found" };
  }

  const remaining = resolved.remaining ?? 0;
  const open =
    !resolved.creance_archived &&
    (resolved.creance_etat === "OUVERTE" ||
      resolved.creance_etat === "PARTIELLEMENT_REGLEE") &&
    remaining > 0;
  const reason = resolved.creance_archived
    ? "archived"
    : remaining <= 0
      ? "settled"
      : !open
        ? "not_open"
        : undefined;

  return {
    status: "display",
    payable: open,
    reason,
    montant: resolved.montant ?? 0,
    remaining,
    clientNom: resolved.client_nom ?? null,
  };
}

export async function createPaymentCheckoutSession(params: {
  supabaseAdmin: AdminClient;
  rawToken: string;
  clientIp: string;
  appUrl: string;
  sidianEnvironment: SidianEnvironment;
  stripe?: Stripe;
}): Promise<CreatePaymentSessionResult> {
  const stripe = params.stripe ?? getStripeClient();
  const admin = params.supabaseAdmin;

  // Le quota d'ouverture/résolution (link_resolution_*) est consommé en amont,
  // lors de l'affichage de la page (resolvePaymentLinkForDisplay). Ici on ne
  // consomme que les quotas de CRÉATION de Session (action explicite « Payer »).
  if (!RAW_TOKEN_RE.test(params.rawToken)) {
    return { status: "not_found" };
  }

  const { data: resolvedData, error: resolveError } = await admin.rpc(
    "resolve_payment_link_by_token_hash",
    { p_token_hash: tokenHashOf(params.rawToken) },
  );
  if (resolveError) {
    throw new StripeDomainError("payment_link_resolution_failed", undefined, "retryable");
  }
  const resolved = (resolvedData ?? { found: false }) as ResolvedLink;
  if (!resolved.found || !resolved.payment_link_id || !resolved.creance_id) {
    return { status: "not_found" };
  }

  // Payabilité : état de créance, solde, compte connecté configuré.
  if (resolved.creance_archived) return { status: "not_payable", reason: "archived" };
  if (
    resolved.creance_etat !== "OUVERTE" &&
    resolved.creance_etat !== "PARTIELLEMENT_REGLEE"
  ) {
    return { status: "not_payable", reason: "not_open" };
  }
  if ((resolved.remaining ?? 0) <= 0) {
    return { status: "not_payable", reason: "already_settled" };
  }
  const stripeAccountId = resolved.stripe_account_id;
  if (!stripeAccountId) {
    // Lien préparé mais compte Stripe non configuré : non payable (pas une erreur).
    return { status: "not_payable", reason: "account_not_configured" };
  }

  if (resolved.devise !== "EUR") {
    return { status: "not_payable", reason: "unsupported_currency" };
  }

  // Revérification live du compte et dérivation stricte des rails actifs.
  // L'ordre card → SEPA est stable et ne dépend jamais du montant.
  let paymentRails: SidianPaymentRail[];
  try {
    ({ rails: paymentRails } = await resolveConnectedAccountPaymentRails({
      expectedAccountId: stripeAccountId,
      stripeAccountId,
      stripe,
    }));
  } catch (error) {
    if (
      error instanceof StripeDomainError &&
      error.code === "stripe_account_not_eligible_for_payment_rail"
    ) {
      return { status: "not_payable", reason: "account_not_payable" };
    }
    throw error;
  }
  if (paymentRails.length === 0) {
    return { status: "not_payable", reason: "account_not_payable" };
  }
  const paymentMethodTypes = paymentRails.map((rail) =>
    rail === "sepa_core" ? "sepa_debit" : "card",
  ) as Stripe.Checkout.SessionCreateParams.PaymentMethodType[];

  // Quotas de création de Session (par IP et par lien).
  const creationIpDecision = await consumePublicRateLimit({
    supabaseAdmin: admin,
    category: "checkout_creation_ip",
    subjectHash: pseudonymizeRateLimitSubject("checkout_creation_ip", params.clientIp),
  });
  if (!creationIpDecision.allowed) {
    return { status: "rate_limited", category: "checkout_creation_ip", resetAt: creationIpDecision.reset_at };
  }
  const linkDecision = await consumePublicRateLimit({
    supabaseAdmin: admin,
    category: "checkout_new_operation_link",
    subjectHash: pseudonymizeRateLimitSubject(
      "checkout_new_operation_link",
      resolved.payment_link_id,
    ),
  });
  if (!linkDecision.allowed) {
    return { status: "rate_limited", category: "checkout_new_operation_link", resetAt: linkDecision.reset_at };
  }

  // Claim exclusif du provisioning (sérialise, gère reprise et réutilisation).
  const { data: claimData, error: claimError } = await admin.rpc(
    "claim_checkout_provisioning",
    {
      p_creance_id: resolved.creance_id,
      p_payment_link_id: resolved.payment_link_id,
      p_stripe_account_id: stripeAccountId,
      p_operation_key: randomUUID(),
      p_idempotency_key: `sidian_checkout_${randomUUID()}`,
      p_lease_seconds: 120,
    },
  );
  if (claimError) {
    throw new StripeDomainError("checkout_claim_failed", undefined, "retryable");
  }
  const claim = claimData as ClaimResult;

  if (claim.status === "in_progress") {
    return { status: "retry" };
  }

  if (claim.status === "already_created" && claim.stripe_checkout_session_id) {
    const existing = await stripe.checkout.sessions.retrieve(
      claim.stripe_checkout_session_id,
      {},
      { stripeAccount: stripeAccountId },
    );
    if (existing.status === "open" && existing.url) {
      return { status: "ready", url: existing.url, tentativeId: String(claim.tentative_id) };
    }
    // Session expirée/terminée non encore réconciliée par webhook : réessayer.
    return { status: "retry" };
  }

  const tentativeId = claim.tentative_id;
  const leaseToken = claim.lease_token;
  const amount = claim.montant;
  const idempotencyKey = claim.idempotency_key;
  if (!tentativeId || !leaseToken || !amount || !idempotencyKey) {
    throw new StripeDomainError("checkout_claim_incomplete", undefined, "retryable");
  }

  try {
    const { customerId } = await ensureStripeCustomerForClient({
      supabaseAdmin: admin,
      prestataireId: resolved.prestataire_id!,
      clientPayeurId: resolved.client_payeur_id!,
      stripeAccountId,
      clientEmail: resolved.client_email ?? null,
      clientNom: resolved.client_nom ?? null,
      sidianEnvironment: params.sidianEnvironment,
      stripe,
    });

    const metadata = {
      sidian_creance_id: resolved.creance_id,
      sidian_tentative_id: tentativeId,
    };
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer: customerId,
        client_reference_id: tentativeId,
        payment_method_types: paymentMethodTypes,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "eur",
              unit_amount: amount,
              product_data: { name: "Paiement à recevoir" },
            },
          },
        ],
        payment_intent_data: { metadata },
        metadata,
        expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
        success_url: `${params.appUrl}/p/retour?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${params.appUrl}/p/annule`,
      },
      { stripeAccount: stripeAccountId, idempotencyKey },
    );

    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : (session.payment_intent?.id ?? "");
    const expiresAtEpoch =
      session.expires_at ?? Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
    const expiresAt = new Date(expiresAtEpoch * 1000).toISOString();

    const { error: completeError } = await admin.rpc("complete_checkout_provisioning", {
      p_tentative_id: tentativeId,
      p_lease_token: leaseToken,
      p_stripe_checkout_session_id: session.id,
      p_stripe_payment_intent_id: paymentIntentId,
      p_stripe_customer_id: customerId,
      p_stripe_account_id: stripeAccountId,
      p_session_expires_at: expiresAt,
      p_application_fee_amount: 0,
    });
    if (completeError) {
      throw new StripeDomainError("checkout_completion_failed", undefined, "retryable");
    }

    if (!session.url) {
      throw new StripeDomainError("checkout_session_url_missing", undefined, "retryable");
    }
    return { status: "ready", url: session.url, tentativeId };
  } catch (error) {
    // Libère le provisioning : retryable → failed_retryable ; terminal → ANNULEE.
    const failure = classifyStripeFailure(error);
    try {
      await admin.rpc("fail_checkout_provisioning", {
        p_tentative_id: tentativeId,
        p_lease_token: leaseToken,
        p_retryable: failure.disposition === "retryable",
        p_error_code: failure.code,
      });
    } catch {
      // Best-effort : ne masque jamais l'erreur d'origine.
    }
    throw error;
  }
}
