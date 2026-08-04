import type { AUTOMATIC_EXECUTION_GUARD_VERSION } from "./constants";
import type { PaymentRuntimeErrorCode } from "./errors";

export type PaymentJobSource = "scanner" | "agent_tool";

export type PaymentJobStatus =
  | "pending"
  | "claimed"
  | "succeeded_pending_webhook"
  | "failed_terminal"
  | "failed_retryable"
  | "unknown";

export type PaymentJob = {
  id: string;
  prestataireId: string;
  creanceId: string;
  amountCents: number;
  currency: "EUR";
  source: PaymentJobSource;
  idempotencyKey: string;
  status: PaymentJobStatus;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  tentativePaiementId: string | null;
  stripePaymentIntentId: string | null;
  failureCode: PaymentRuntimeErrorCode | string | null;
  correlationId: string | null;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CreanceSnapshot = {
  id: string;
  prestataireId: string;
  clientPayeurId: string;
  etat: string;
  devise: string;
  montant: number;
  archivedAt: string | null;
  amountPaidCents: number;
  remainingCents: number;
};

export type DossierSuiviSnapshot = {
  creanceId: string;
  etat: string;
};

export type AuthorizationSnapshot = {
  id: string;
  prestataireId: string;
  clientPayeurId: string;
  etat: string;
  isDefault: boolean;
  legacyIncomplete: boolean;
  type: "card_off_session" | "sepa_core_mandate" | null;
  stripeAccountId: string | null;
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
  acceptedAt: string | null;
  authorizedAt: string | null;
  authorizationTextVersion: string | null;
  authorizationChannel: string | null;
};

export type ActiveAttemptSnapshot = {
  id: string;
  etat: string;
  source: string;
  stripePaymentIntentId: string | null;
};

export type ConnectLiveSnapshot = {
  stripeAccountId: string;
  cardPaymentsActive: boolean;
  chargesEnabled: boolean;
  restricted: boolean;
};

/**
 * Snapshot déterministe pour la checklist 03 §4.
 * `autoDebitCeilingCents` reste null tant que le produit n'a pas de règle dédiée.
 */
export type AutomaticPaymentChecklistInput = {
  paymentsEnabled: boolean;
  creance: CreanceSnapshot;
  dossier: DossierSuiviSnapshot | null;
  authorization: AuthorizationSnapshot | null;
  activeAttempt: ActiveAttemptSnapshot | null;
  connect: ConnectLiveSnapshot | null;
  requestedAmountCents: number;
  requestedCurrency: string;
  /** Plafond auto-débit issu de `regle` — null = produit incomplet → fail-closed. */
  autoDebitCeilingCents: number | null;
  /**
   * false tant qu'aucun `regle_parametre` dédié / validation produit n'existe.
   * Les loaders production doivent laisser false ; les tests peuvent forcer true.
   */
  productAutoDebitRulesReady: boolean;
  guardVersion: typeof AUTOMATIC_EXECUTION_GUARD_VERSION;
};

export type ChecklistGateId =
  | "payments_enabled"
  | "creance_state"
  | "currency"
  | "remaining_balance"
  | "amount_match"
  | "no_active_attempt"
  | "followup_state"
  | "authorization"
  | "sepa_closed"
  | "connect_payable"
  | "regle_ceiling"
  | "guard_version"
  | "scope";

export type ChecklistGateResult = {
  gate: ChecklistGateId;
  ok: boolean;
  code?: PaymentRuntimeErrorCode;
  detail?: string;
};

export type ChecklistResult =
  | {
      ok: true;
      gates: ChecklistGateResult[];
      authorizationId: string;
      stripeAccountId: string;
      stripeCustomerId: string;
      stripePaymentMethodId: string;
      amountCents: number;
      remainingCents: number;
    }
  | {
      ok: false;
      gates: ChecklistGateResult[];
      code: PaymentRuntimeErrorCode;
      detail: string;
    };

export type OffSessionProviderOutcome =
  | {
      kind: "created";
      paymentIntentId: string;
      providerStatus: string;
      requiresAction: boolean;
    }
  | {
      kind: "temporary_failure";
      code: string;
      retryable: true;
    }
  | {
      kind: "permanent_failure";
      code: string;
      retryable: false;
    }
  | {
      kind: "unknown";
      code: string;
    };

export type DrainJobResult =
  | {
      status: "pending";
      jobId: string;
      payment_attempt_id: string;
      provider_status: string;
      external_reference?: string;
    }
  | {
      status: "failure";
      jobId: string;
      code: PaymentRuntimeErrorCode | string;
      provider_status?: string;
      payment_attempt_id?: string;
    }
  | {
      status: "unknown";
      jobId: string;
      code: PaymentRuntimeErrorCode | string;
      payment_attempt_id?: string;
      external_reference?: string;
    }
  | {
      status: "skipped_in_progress";
      jobId: string;
    };

/**
 * Sortie outil agent `payment.create_attempt` — jamais `success` sur le seul
 * retour sync Stripe : le webhook reste source de vérité pour RÉUSSIE / paiement.
 */
export type PaymentCreateAttemptToolOutput = {
  status: "success" | "failure" | "partial" | "pending" | "unknown";
  payment_attempt_id?: string;
  provider_status?: string;
  external_reference?: string;
};
