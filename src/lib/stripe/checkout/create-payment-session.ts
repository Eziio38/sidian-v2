import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getStripeClient } from "@/lib/stripe/client";
import {
  neutralizeUnexposedAuthorizationProposal,
  prepareAuthorizationProposalForPayment,
} from "@/lib/stripe/authorizations/create-setup-session";
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
  prestataire_nom?: string | null;
  montant?: number;
  devise?: string;
  amount_paid?: number;
  remaining?: number;
  creance_etat?: string;
  creance_archived?: boolean;
  creance_libelle?: string | null;
  creance_reference_externe?: string | null;
  creance_date_echeance?: string | null;
  client_email?: string | null;
  client_nom?: string | null;
  pending_payment?: boolean;
  pending_moyen?: string | null;
};

type ClaimResult = {
  status: "claimed" | "reclaimed" | "in_progress" | "already_created";
  tentative_id?: string | null;
  montant?: number;
  idempotency_key?: string;
  lease_token?: string;
  stripe_customer_id?: string | null;
  stripe_checkout_session_id?: string;
};

function tokenHashOf(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function stripeObjectId(value: string | { id: string } | null): string | null {
  return typeof value === "string" ? value : (value?.id ?? null);
}

function samePaymentMethodTypes(
  actual: readonly string[] | null | undefined,
  expected: readonly string[],
): boolean {
  if (!actual || actual.length !== expected.length) return false;
  return [...actual].sort().join(",") === [...expected].sort().join(",");
}

function isReusablePaymentSessionIdentity(params: {
  session: Stripe.Checkout.Session;
  sessionId: string;
  tentativeId: string | null | undefined;
  creanceId: string;
  amount: number | undefined;
  customerId: string | null | undefined;
}): boolean {
  const { session, sessionId, tentativeId, creanceId, amount, customerId } =
    params;
  if (
    !tentativeId ||
    !customerId ||
    !Number.isSafeInteger(amount) ||
    (amount ?? 0) <= 0
  ) {
    return false;
  }

  return (
    session.object === "checkout.session" &&
    session.id === sessionId &&
    session.mode === "payment" &&
    session.client_reference_id === tentativeId &&
    session.metadata?.sidian_tentative_id === tentativeId &&
    session.metadata?.sidian_creance_id === creanceId &&
    session.currency?.toLowerCase() === "eur" &&
    session.amount_total === amount &&
    session.payment_status === "unpaid" &&
    stripeObjectId(session.customer) === customerId
  );
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
      amountPaid: number;
      remaining: number;
      devise: string;
      clientNom: string | null;
      prestataireNom: string | null;
      libelle: string | null;
      referenceExterne: string | null;
      dateEcheance: string | null;
      pendingMoyen: string | null;
      availableRails: SidianPaymentRail[];
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

  const montant = resolved.montant ?? 0;
  const remaining = resolved.remaining ?? 0;
  const amountPaid = resolved.amount_paid ?? Math.max(0, montant - remaining);
  const devise = resolved.devise ?? "";
  const inOpenState =
    resolved.creance_etat === "OUVERTE" ||
    resolved.creance_etat === "PARTIELLEMENT_REGLEE";
  const hasAccount = Boolean(resolved.stripe_account_id);
  // Ordre de priorité stable : un état plus définitif (archivé, réglé) prime
  // toujours sur un état transitoire (paiement en cours, compte à configurer).
  let reason = resolved.creance_archived
    ? "archived"
    : devise !== "EUR"
      ? "unsupported_currency"
      : remaining <= 0
      ? "settled"
      : !inOpenState
        ? "not_open"
        : resolved.pending_payment
          ? "pending_payment"
          : !hasAccount
            ? "account_not_configured"
            : undefined;

  let availableRails: SidianPaymentRail[] = [];
  if (!reason && resolved.stripe_account_id) {
    try {
      ({ rails: availableRails } = await resolveConnectedAccountPaymentRails({
        expectedAccountId: resolved.stripe_account_id,
        stripeAccountId: resolved.stripe_account_id,
      }));
      if (availableRails.length === 0) {
        reason = "account_not_payable";
      }
    } catch {
      // L'ouverture est une lecture pure : une indisponibilite Stripe ne doit
      // jamais exposer de detail interne ni autoriser le paiement sur cache.
      reason = "account_check_unavailable";
    }
  }

  return {
    status: "display",
    payable: reason === undefined && availableRails.length > 0,
    reason,
    montant,
    amountPaid,
    remaining,
    devise,
    clientNom: resolved.client_nom ?? null,
    prestataireNom: resolved.prestataire_nom ?? null,
    libelle: resolved.creance_libelle ?? null,
    referenceExterne: resolved.creance_reference_externe ?? null,
    dateEcheance: resolved.creance_date_echeance ?? null,
    pendingMoyen: resolved.pending_moyen ?? null,
    availableRails,
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
  if (resolved.pending_payment) {
    // Un prélèvement est déjà en traitement pour cette créance : ne jamais
    // provisionner une seconde Session tant que le premier n'est pas résolu.
    return { status: "not_payable", reason: "pending_payment" };
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
  let authorizationProposal: { rawToken: string } | null = null;
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

    // La lecture dans le compte Connect attendu ne suffit pas : une Session
    // locale mal rapprochée ne doit être ni réexposée ni mutée. On exige donc
    // l'identité financière minimale avant de décider quoi que ce soit.
    if (
      !isReusablePaymentSessionIdentity({
        session: existing,
        sessionId: claim.stripe_checkout_session_id,
        tentativeId: claim.tentative_id,
        creanceId: resolved.creance_id,
        amount: claim.montant,
        customerId: claim.stripe_customer_id,
      })
    ) {
      return { status: "retry" };
    }

    if (!samePaymentMethodTypes(existing.payment_method_types, paymentMethodTypes)) {
      // Les capacités live ont changé. Une Session ouverte et impayée dont
      // l'identité est certaine peut être neutralisée ; le webhook d'expiration
      // libérera ensuite la tentative pour un reprovisioning avec les bons rails.
      if (existing.status === "open") {
        await stripe.checkout.sessions.expire(
          existing.id,
          {},
          {
            stripeAccount: stripeAccountId,
            idempotencyKey: `sidian_checkout_rails_changed_${existing.id}`,
          },
        );
      }
      return { status: "retry" };
    }

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

    // La proposition est préparée avant Stripe afin que sa success_url soit
    // stable sur tous les retries de la même idempotency key. Le token brut est
    // déterministe/HMAC et seul son hash est persisté. Une relation déjà
    // proposée ou autorisée n'est jamais sollicitée de nouveau automatiquement.
    try {
      authorizationProposal = await prepareAuthorizationProposalForPayment({
        supabaseAdmin: admin,
        tentativeId,
        stripeAccountId,
        stripeCustomerId: customerId,
      });
    } catch {
      // La proposition est secondaire au paiement volontaire. En cas
      // d'indisponibilité, neutralise sous le lease courant toute insertion
      // ambiguë jamais exposée, journalise via SQL, puis poursuit sans token.
      try {
        await neutralizeUnexposedAuthorizationProposal({
          supabaseAdmin: admin,
          tentativeId,
          checkoutLeaseToken: leaseToken,
          reason: "authorization_proposal_unavailable",
        });
      } catch {
        // Le paiement principal reste disponible. Aucun token n'est placé dans
        // la success_url et aucune autorisation ne peut devenir ACTIVE.
      }
      authorizationProposal = null;
    }
    const authorizationQuery = authorizationProposal
      ? `&authorization_token=${encodeURIComponent(authorizationProposal.rawToken)}`
      : "";

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
        success_url: `${params.appUrl}/p/retour?session_id={CHECKOUT_SESSION_ID}${authorizationQuery}`,
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
    if (failure.disposition === "terminal") {
      try {
        await neutralizeUnexposedAuthorizationProposal({
          supabaseAdmin: admin,
          tentativeId,
          checkoutLeaseToken: leaseToken,
          reason: "checkout_creation_failed_terminal",
        });
      } catch {
        // Best-effort : la proposition reste hors ACTIVE et aucun token n'a pu
        // être exposé puisque Stripe n'a pas créé de Session réutilisable.
      }
    }
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
