import "server-only";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getStripeClient } from "@/lib/stripe/client";
import {
  resolveConnectedAccountPaymentRails,
  type SidianPaymentRail,
} from "@/lib/stripe/connect/retrieve-and-sync";
import {
  consumePublicRateLimit,
  pseudonymizeRateLimitSubject,
} from "@/lib/stripe/checkout/rate-limit";
import { classifyStripeFailure, StripeDomainError } from "@/lib/stripe/shared/errors";
import type { Database } from "@/types/database.generated";

import { FUTURE_PAYMENT_AUTHORIZATION_TEXT_VERSION } from "./consent";
import { isStripeCheckoutSessionId } from "./public-input";
import {
  AUTHORIZATION_RAW_TOKEN_RE,
  authorizationTokenForReconsideration,
  authorizationTokenForTentative,
  authorizationTokenHash,
} from "./token";

type AdminClient = SupabaseClient<Database>;
type SidianEnvironment = "local" | "staging" | "production";

const AUTHORIZATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const SETUP_SESSION_TTL_SECONDS = 30 * 60;

type PublicFunctions = Database["public"]["Functions"];

type ProposalPreparation = {
  status?: "proposed" | "not_offered";
};

type SetupContext = {
  found?: boolean;
  authorization_id?: string;
  etat?: string;
  expired?: boolean;
  stripe_account_id?: string;
  stripe_customer_id?: string;
  authorization_text_version?: string;
  source_checkout_session_id?: string;
  stripe_setup_checkout_session_id?: string | null;
  setup_provisioning_status?: string;
  prestataire_id?: string;
  client_payeur_id?: string;
};

type SetupClaim = {
  status?: "claimed" | "reclaimed" | "in_progress" | "already_created";
  authorization_id?: string;
  stripe_account_id?: string;
  stripe_customer_id?: string;
  stripe_setup_checkout_session_id?: string;
  idempotency_key?: string;
  lease_token?: string;
};

type PublicAuthorizationProjection = {
  found?: boolean;
  etat?: string;
  expired?: boolean;
  authorization_text_version?: string;
  prestataire_nom?: string;
  initial_payment_state?: string;
  setup_provisioning_status?: string;
};

type ReconsiderationContext = {
  found?: boolean;
  authorization_id?: string;
  stripe_account_id?: string;
  stripe_customer_id?: string;
  authorization_text_version?: string;
  prestataire_id?: string;
  client_payeur_id?: string;
  source_checkout_session_id?: string;
};

export type AuthorizationProposalDisplayResult =
  | { status: "not_found" }
  | { status: "rate_limited" }
  | {
      status: "display";
      state: string;
      expired: boolean;
      prestataireNom: string;
      initialPaymentProcessing: boolean;
      setupProvisioningStatus: string;
    };

export type CreateAuthorizationSetupResult =
  | { status: "ready"; url: string }
  | { status: "completed"; returnUrl: string }
  | { status: "not_found" | "expired" | "not_available" | "retry" }
  | { status: "rate_limited" };

function stringId(
  value: string | { id?: string | null } | null | undefined,
): string | undefined {
  if (typeof value === "string") return value || undefined;
  return value && typeof value.id === "string" ? value.id : undefined;
}

function paymentMethodTypes(
  rails: SidianPaymentRail[],
): Stripe.Checkout.SessionCreateParams.PaymentMethodType[] {
  return rails.map((rail) => (rail === "sepa_core" ? "sepa_debit" : "card"));
}

function samePaymentMethodTypes(
  actual: readonly string[] | null | undefined,
  expected: readonly string[],
): boolean {
  if (!actual || actual.length !== expected.length) return false;
  return [...actual].sort().join(",") === [...expected].sort().join(",");
}

function isReusableSetupSessionIdentity(params: {
  session: Stripe.Checkout.Session;
  sessionId: string;
  authorizationId: string;
  customerId: string;
}): boolean {
  const { session, sessionId, authorizationId, customerId } = params;
  return (
    session.object === "checkout.session" &&
    session.id === sessionId &&
    session.mode === "setup" &&
    stringId(session.customer) === customerId &&
    session.currency?.toLowerCase() === "eur" &&
    session.metadata?.sidian_payment_authorization_id === authorizationId &&
    session.metadata?.sidian_authorization_text_version ===
      FUTURE_PAYMENT_AUTHORIZATION_TEXT_VERSION
  );
}

async function rpcJson<Name extends keyof PublicFunctions>(
  admin: AdminClient,
  rpc: Name,
  args: PublicFunctions[Name]["Args"],
  errorCode: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await admin.rpc(rpc, args);
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new StripeDomainError(errorCode, undefined, "retryable");
  }
  return data as Record<string, unknown>;
}

function rpcString(
  row: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function rpcBoolean(
  row: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = row[key];
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Prépare le token présent dans la success_url du Checkout de paiement. La RPC
 * refuse une seconde proposition pour la relation ; dans ce cas le token n'est
 * pas ajouté à l'URL publique.
 */
export async function prepareAuthorizationProposalForPayment(params: {
  supabaseAdmin: AdminClient;
  tentativeId: string;
  stripeAccountId: string;
  stripeCustomerId: string;
  tokenSecret?: string;
  now?: Date;
}): Promise<{ rawToken: string } | null> {
  const rawToken = authorizationTokenForTentative(
    params.tentativeId,
    params.tokenSecret,
  );
  const now = params.now ?? new Date();
  const result = await rpcJson(
    params.supabaseAdmin,
    "prepare_payment_authorization_proposal",
    {
      p_tentative_id: params.tentativeId,
      p_stripe_account_id: params.stripeAccountId,
      p_stripe_customer_id: params.stripeCustomerId,
      p_public_token_hash: authorizationTokenHash(rawToken),
      p_public_token_expires_at: new Date(
        now.getTime() + AUTHORIZATION_TOKEN_TTL_MS,
      ).toISOString(),
      p_authorization_text_version:
        FUTURE_PAYMENT_AUTHORIZATION_TEXT_VERSION,
    },
    "payment_authorization_proposal_failed",
  );
  return rpcString(result, "status") === "proposed" ? { rawToken } : null;
}

export async function neutralizeUnexposedAuthorizationProposal(params: {
  supabaseAdmin: AdminClient;
  tentativeId: string;
  checkoutLeaseToken: string;
  reason: string;
  tokenSecret?: string;
}): Promise<boolean> {
  const rawToken = authorizationTokenForTentative(
    params.tentativeId,
    params.tokenSecret,
  );
  const result = await rpcJson(
    params.supabaseAdmin,
    "neutralize_unexposed_authorization_proposal",
    {
      p_tentative_id: params.tentativeId,
      p_checkout_lease_token: params.checkoutLeaseToken,
      p_public_token_hash: authorizationTokenHash(rawToken),
      p_reason: params.reason,
    },
    "payment_authorization_proposal_neutralization_failed",
  );
  return rpcBoolean(result, "neutralized") === true;
}

export async function isAuthorizationReconsiderationAvailable(params: {
  supabaseAdmin: AdminClient;
  rawPaymentLinkToken: string;
}): Promise<boolean> {
  if (!AUTHORIZATION_RAW_TOKEN_RE.test(params.rawPaymentLinkToken)) return false;
  const result = await rpcJson(
    params.supabaseAdmin,
    "resolve_authorization_reconsideration_context",
    {
      p_payment_link_token_hash: authorizationTokenHash(
        params.rawPaymentLinkToken,
      ),
    },
    "payment_authorization_reconsideration_resolution_failed",
  );
  return rpcBoolean(result, "found") === true;
}

export async function prepareAuthorizationReconsideration(params: {
  supabaseAdmin: AdminClient;
  rawPaymentLinkToken: string;
  clientIp: string;
  appUrl: string;
  sidianEnvironment: SidianEnvironment;
  stripe?: Stripe;
  tokenSecret?: string;
  now?: Date;
}): Promise<{ status: "ready"; url: string } | { status: "not_available" | "rate_limited" }> {
  if (!AUTHORIZATION_RAW_TOKEN_RE.test(params.rawPaymentLinkToken)) {
    return { status: "not_available" };
  }
  const rateDecision = await consumePublicRateLimit({
    supabaseAdmin: params.supabaseAdmin,
    category: "checkout_creation_ip",
    subjectHash: pseudonymizeRateLimitSubject(
      "checkout_creation_ip",
      params.clientIp,
    ),
  });
  if (!rateDecision.allowed) return { status: "rate_limited" };

  const contextRow = await rpcJson(
    params.supabaseAdmin,
    "resolve_authorization_reconsideration_context",
    {
      p_payment_link_token_hash: authorizationTokenHash(
        params.rawPaymentLinkToken,
      ),
    },
    "payment_authorization_reconsideration_resolution_failed",
  );
  const authorizationId = rpcString(contextRow, "authorization_id");
  const stripeAccountId = rpcString(contextRow, "stripe_account_id");
  const stripeCustomerId = rpcString(contextRow, "stripe_customer_id");
  const prestataireId = rpcString(contextRow, "prestataire_id");
  const clientPayeurId = rpcString(contextRow, "client_payeur_id");
  const sourceCheckoutSessionId = rpcString(
    contextRow,
    "source_checkout_session_id",
  );
  if (
    rpcBoolean(contextRow, "found") !== true ||
    !authorizationId ||
    !stripeAccountId ||
    !stripeCustomerId ||
    !prestataireId ||
    !clientPayeurId ||
    !sourceCheckoutSessionId ||
    rpcString(contextRow, "authorization_text_version") !==
      FUTURE_PAYMENT_AUTHORIZATION_TEXT_VERSION
  ) {
    return { status: "not_available" };
  }

  const stripe = params.stripe ?? getStripeClient();
  const [{ rails }, customer] = await Promise.all([
    resolveConnectedAccountPaymentRails({
      expectedAccountId: stripeAccountId,
      stripeAccountId,
      stripe,
    }),
    stripe.customers.retrieve(
      stripeCustomerId,
      {},
      { stripeAccount: stripeAccountId },
    ),
  ]);
  if (
    rails.length === 0 ||
    customer.deleted ||
    customer.metadata?.sidian_prestataire_id !== prestataireId ||
    customer.metadata?.sidian_client_payeur_id !== clientPayeurId ||
    customer.metadata?.sidian_environment !== params.sidianEnvironment
  ) {
    return { status: "not_available" };
  }

  const rawAuthorizationToken = authorizationTokenForReconsideration(
    params.rawPaymentLinkToken,
    authorizationId,
    params.tokenSecret,
  );
  const now = params.now ?? new Date();
  const prepared = await rpcJson(
    params.supabaseAdmin,
    "prepare_reconsidered_authorization_proposal",
    {
      p_payment_link_token_hash: authorizationTokenHash(
        params.rawPaymentLinkToken,
      ),
      p_refused_authorization_id: authorizationId,
      p_stripe_account_id: stripeAccountId,
      p_stripe_customer_id: stripeCustomerId,
      p_public_token_hash: authorizationTokenHash(rawAuthorizationToken),
      p_public_token_expires_at: new Date(
        now.getTime() + AUTHORIZATION_TOKEN_TTL_MS,
      ).toISOString(),
      p_authorization_text_version:
        FUTURE_PAYMENT_AUTHORIZATION_TEXT_VERSION,
    },
    "payment_authorization_reconsideration_failed",
  );
  if (
    rpcString(prepared, "status") !== "proposed" ||
    rpcString(prepared, "source_checkout_session_id") !== sourceCheckoutSessionId
  ) {
    return { status: "not_available" };
  }

  return {
    status: "ready",
    url: `${params.appUrl}/p/retour?session_id=${encodeURIComponent(sourceCheckoutSessionId)}&authorization_token=${encodeURIComponent(rawAuthorizationToken)}`,
  };
}

export async function resolveAuthorizationProposalForDisplay(params: {
  supabaseAdmin: AdminClient;
  rawToken: string;
  sourceCheckoutSessionId: string;
  setupCheckoutSessionId?: string;
  clientIp: string;
}): Promise<AuthorizationProposalDisplayResult> {
  if (!AUTHORIZATION_RAW_TOKEN_RE.test(params.rawToken)) {
    return { status: "not_found" };
  }
  if (
    !isStripeCheckoutSessionId(params.sourceCheckoutSessionId) ||
    (params.setupCheckoutSessionId !== undefined &&
      !isStripeCheckoutSessionId(params.setupCheckoutSessionId))
  ) {
    return { status: "not_found" };
  }
  const ipDecision = await consumePublicRateLimit({
    supabaseAdmin: params.supabaseAdmin,
    category: "link_resolution_ip",
    subjectHash: pseudonymizeRateLimitSubject(
      "link_resolution_ip",
      params.clientIp,
    ),
  });
  const tokenDecision = await consumePublicRateLimit({
    supabaseAdmin: params.supabaseAdmin,
    category: "link_resolution_token",
    subjectHash: pseudonymizeRateLimitSubject(
      "link_resolution_token",
      params.rawToken,
    ),
  });
  if (!ipDecision.allowed || !tokenDecision.allowed) {
    return { status: "rate_limited" };
  }

  const result = await rpcJson(
    params.supabaseAdmin,
    "resolve_payment_authorization_public",
    {
      p_public_token_hash: authorizationTokenHash(params.rawToken),
      p_source_checkout_session_id: params.sourceCheckoutSessionId,
      ...(params.setupCheckoutSessionId
        ? { p_setup_checkout_session_id: params.setupCheckoutSessionId }
        : {}),
    },
    "payment_authorization_resolution_failed",
  );
  const etat = rpcString(result, "etat");
  const prestataireNom = rpcString(result, "prestataire_nom");
  if (rpcBoolean(result, "found") !== true || !etat || !prestataireNom) {
    return { status: "not_found" };
  }
  return {
    status: "display",
    state: etat,
    expired: rpcBoolean(result, "expired") === true,
    prestataireNom,
    initialPaymentProcessing: [
      "CREEE",
      "NECESSITE_ACTION_CLIENT",
      "EN_TRAITEMENT",
    ].includes(rpcString(result, "initial_payment_state") ?? ""),
    setupProvisioningStatus:
      rpcString(result, "setup_provisioning_status") ?? "idle",
  };
}

export async function createAuthorizationSetupSession(params: {
  supabaseAdmin: AdminClient;
  rawToken: string;
  sourceCheckoutSessionId: string;
  clientIp: string;
  consentAccepted: boolean;
  appUrl: string;
  sidianEnvironment: SidianEnvironment;
  stripe?: Stripe;
}): Promise<CreateAuthorizationSetupResult> {
  if (
    !params.consentAccepted ||
    !AUTHORIZATION_RAW_TOKEN_RE.test(params.rawToken) ||
    !isStripeCheckoutSessionId(params.sourceCheckoutSessionId)
  ) {
    return { status: "not_available" };
  }
  const stripe = params.stripe ?? getStripeClient();

  const ipDecision = await consumePublicRateLimit({
    supabaseAdmin: params.supabaseAdmin,
    category: "checkout_creation_ip",
    subjectHash: pseudonymizeRateLimitSubject(
      "checkout_creation_ip",
      params.clientIp,
    ),
  });
  if (!ipDecision.allowed) return { status: "rate_limited" };

  const contextRow = await rpcJson(
    params.supabaseAdmin,
    "resolve_payment_authorization_setup_context",
    {
      p_public_token_hash: authorizationTokenHash(params.rawToken),
      p_source_checkout_session_id: params.sourceCheckoutSessionId,
    },
    "payment_authorization_resolution_failed",
  );
  const authorizationId = rpcString(contextRow, "authorization_id");
  if (rpcBoolean(contextRow, "found") !== true || !authorizationId) {
    return { status: "not_found" };
  }
  if (rpcBoolean(contextRow, "expired") === true) return { status: "expired" };
  const stripeAccountId = rpcString(contextRow, "stripe_account_id");
  const stripeCustomerId = rpcString(contextRow, "stripe_customer_id");
  const prestataireId = rpcString(contextRow, "prestataire_id");
  const clientPayeurId = rpcString(contextRow, "client_payeur_id");
  if (
    !stripeAccountId ||
    !stripeCustomerId ||
    !prestataireId ||
    !clientPayeurId ||
    rpcString(contextRow, "authorization_text_version") !==
      FUTURE_PAYMENT_AUTHORIZATION_TEXT_VERSION
  ) {
    return { status: "not_available" };
  }

  const tokenDecision = await consumePublicRateLimit({
    supabaseAdmin: params.supabaseAdmin,
    category: "checkout_new_operation_link",
    subjectHash: pseudonymizeRateLimitSubject(
      "checkout_new_operation_link",
      authorizationId,
    ),
  });
  if (!tokenDecision.allowed) return { status: "rate_limited" };

  // Le simple query param ne suffit jamais : la Session source est relue dans
  // le compte Connect attendu et doit être terminée. Son payment_status n'est
  // volontairement pas un gate (SEPA peut encore être processing/unpaid).
  const sourceSession = await stripe.checkout.sessions.retrieve(
    params.sourceCheckoutSessionId,
    {},
    { stripeAccount: stripeAccountId },
  );
  if (
    sourceSession.id !== params.sourceCheckoutSessionId ||
    sourceSession.mode !== "payment" ||
    sourceSession.status !== "complete" ||
    stringId(sourceSession.customer) !== stripeCustomerId
  ) {
    return { status: "not_available" };
  }

  const customer = await stripe.customers.retrieve(
    stripeCustomerId,
    {},
    { stripeAccount: stripeAccountId },
  );
  if (
    customer.deleted ||
    customer.metadata?.sidian_prestataire_id !== prestataireId ||
    customer.metadata?.sidian_client_payeur_id !== clientPayeurId ||
    customer.metadata?.sidian_environment !== params.sidianEnvironment
  ) {
    return { status: "not_available" };
  }

  const { rails } = await resolveConnectedAccountPaymentRails({
    expectedAccountId: stripeAccountId,
    stripeAccountId,
    stripe,
  });
  if (rails.length === 0) return { status: "not_available" };

  const claimRow = await rpcJson(
    params.supabaseAdmin,
    "claim_payment_authorization_setup",
    {
      p_public_token_hash: authorizationTokenHash(params.rawToken),
      p_source_checkout_session_id: params.sourceCheckoutSessionId,
      p_stripe_account_id: stripeAccountId,
      p_stripe_customer_id: stripeCustomerId,
      p_authorization_text_version:
        FUTURE_PAYMENT_AUTHORIZATION_TEXT_VERSION,
      p_lease_seconds: 120,
    },
    "payment_authorization_setup_claim_failed",
  );
  if (rpcString(claimRow, "status") === "in_progress") return { status: "retry" };

  const claimAuthorizationId = rpcString(claimRow, "authorization_id");
  const claimStripeAccountId = rpcString(claimRow, "stripe_account_id");
  const claimStripeCustomerId = rpcString(claimRow, "stripe_customer_id");
  const claimSetupSessionId = rpcString(
    claimRow,
    "stripe_setup_checkout_session_id",
  );
  const claimLeaseToken = rpcString(claimRow, "lease_token");
  const claimIdempotencyKey = rpcString(claimRow, "idempotency_key");

  const returnUrl = `${params.appUrl}/p/autorisation/retour?authorization_token=${encodeURIComponent(params.rawToken)}&source_session_id=${encodeURIComponent(params.sourceCheckoutSessionId)}&session_id={CHECKOUT_SESSION_ID}`;
  if (
    rpcString(claimRow, "status") === "already_created" &&
    claimSetupSessionId
  ) {
    if (
      !claimAuthorizationId ||
      claimAuthorizationId !== authorizationId ||
      claimStripeAccountId !== stripeAccountId ||
      claimStripeCustomerId !== stripeCustomerId
    ) {
      return { status: "retry" };
    }
    const existing = await stripe.checkout.sessions.retrieve(
      claimSetupSessionId,
      {},
      { stripeAccount: stripeAccountId },
    );
    if (
      !isReusableSetupSessionIdentity({
        session: existing,
        sessionId: claimSetupSessionId,
        authorizationId: claimAuthorizationId,
        customerId: claimStripeCustomerId,
      })
    ) {
      return { status: "retry" };
    }
    if (existing.status === "open" && existing.url) {
      const expectedTypes = paymentMethodTypes(rails);
      if (
        !samePaymentMethodTypes(existing.payment_method_types, expectedTypes)
      ) {
        // Les capacités Stripe live ont changé depuis la création. Ne jamais
        // réexposer l'ancienne Session : expiration Stripe d'abord, rotation
        // transactionnelle des clés ensuite. Le clic suivant reprovisionnera
        // avec l'ensemble exact de rails désormais actifs.
        await stripe.checkout.sessions.expire(
          existing.id,
          {},
          {
            stripeAccount: stripeAccountId,
            idempotencyKey: `sidian_setup_rails_changed_${existing.id}`,
          },
        );
        const { error: invalidateError } = await params.supabaseAdmin.rpc(
          "invalidate_payment_authorization_setup_session",
          {
            p_authorization_id: claimAuthorizationId,
            p_stripe_setup_checkout_session_id: existing.id,
            p_reason: "setup_capabilities_changed",
          },
        );
        if (invalidateError) {
          throw new StripeDomainError(
            "payment_authorization_setup_invalidation_failed",
            undefined,
            "retryable",
          );
        }
        return { status: "retry" };
      }
      return { status: "ready", url: existing.url };
    }
    return {
      status: "completed",
      returnUrl: returnUrl.replace(
        "{CHECKOUT_SESSION_ID}",
        encodeURIComponent(existing.id),
      ),
    };
  }

  if (!claimAuthorizationId || !claimLeaseToken || !claimIdempotencyKey) {
    throw new StripeDomainError(
      "payment_authorization_setup_claim_incomplete",
      undefined,
      "retryable",
    );
  }

  try {
    const metadata = {
      sidian_payment_authorization_id: claimAuthorizationId,
      sidian_authorization_text_version:
        FUTURE_PAYMENT_AUTHORIZATION_TEXT_VERSION,
    };
    const session = await stripe.checkout.sessions.create(
      {
        mode: "setup",
        currency: "eur",
        customer: stripeCustomerId,
        payment_method_types: paymentMethodTypes(rails),
        metadata,
        setup_intent_data: { metadata },
        expires_at: Math.floor(Date.now() / 1000) + SETUP_SESSION_TTL_SECONDS,
        success_url: returnUrl,
        cancel_url: `${params.appUrl}/p/autorisation/annulation`,
      },
      {
        stripeAccount: stripeAccountId,
        idempotencyKey: claimIdempotencyKey,
      },
    );
    const expiresAt = new Date(
      (session.expires_at ??
        Math.floor(Date.now() / 1000) + SETUP_SESSION_TTL_SECONDS) * 1000,
    ).toISOString();
    const { error } = await params.supabaseAdmin.rpc(
      "complete_payment_authorization_setup",
      {
        p_authorization_id: claimAuthorizationId,
        p_lease_token: claimLeaseToken,
        p_stripe_account_id: stripeAccountId,
        p_stripe_customer_id: stripeCustomerId,
        p_stripe_setup_checkout_session_id: session.id,
        p_stripe_setup_intent_id: stringId(session.setup_intent) ?? null,
        p_session_expires_at: expiresAt,
      },
    );
    if (error) {
      throw new StripeDomainError(
        "payment_authorization_setup_completion_failed",
        undefined,
        "retryable",
      );
    }
    if (!session.url) {
      throw new StripeDomainError(
        "payment_authorization_setup_url_missing",
        undefined,
        "retryable",
      );
    }
    return { status: "ready", url: session.url };
  } catch (error) {
    const failure = classifyStripeFailure(error);
    await params.supabaseAdmin.rpc(
      "fail_payment_authorization_setup",
      {
        p_authorization_id: claimAuthorizationId,
        p_lease_token: claimLeaseToken,
        p_retryable: failure.disposition === "retryable",
        p_error_code: failure.code,
      },
    );
    throw error;
  }
}

export async function declineAuthorizationProposal(params: {
  supabaseAdmin: AdminClient;
  rawToken: string;
  sourceCheckoutSessionId: string;
  clientIp: string;
}): Promise<"declined" | "not_available" | "rate_limited"> {
  if (!AUTHORIZATION_RAW_TOKEN_RE.test(params.rawToken)) {
    return "not_available";
  }
  if (!isStripeCheckoutSessionId(params.sourceCheckoutSessionId)) {
    return "not_available";
  }
  const [ipDecision, tokenDecision] = await Promise.all([
    consumePublicRateLimit({
      supabaseAdmin: params.supabaseAdmin,
      category: "checkout_creation_ip",
      subjectHash: pseudonymizeRateLimitSubject(
        "checkout_creation_ip",
        params.clientIp,
      ),
    }),
    consumePublicRateLimit({
      supabaseAdmin: params.supabaseAdmin,
      category: "checkout_new_operation_link",
      subjectHash: pseudonymizeRateLimitSubject(
        "checkout_new_operation_link",
        params.rawToken,
      ),
    }),
  ]);
  if (!ipDecision.allowed || !tokenDecision.allowed) return "rate_limited";
  const result = await rpcJson(
    params.supabaseAdmin,
    "decline_payment_authorization_proposal",
    {
      p_public_token_hash: authorizationTokenHash(params.rawToken),
      p_source_checkout_session_id: params.sourceCheckoutSessionId,
    },
    "payment_authorization_decline_failed",
  );
  return rpcBoolean(result, "declined") === true ? "declined" : "not_available";
}
