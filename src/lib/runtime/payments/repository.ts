import type { PaymentRuntimeErrorCode } from "./errors";
import type {
  AuthorizationSnapshot,
  ActiveAttemptSnapshot,
  AutomaticPaymentChecklistInput,
  ConnectLiveSnapshot,
  CreanceSnapshot,
  DossierSuiviSnapshot,
  PaymentJob,
  PaymentJobSource,
  PaymentJobStatus,
} from "./types";

export type EnqueuePaymentJobInput = {
  prestataireId: string;
  creanceId: string;
  amountCents: number;
  currency: "EUR";
  source: PaymentJobSource;
  idempotencyKey: string;
  correlationId?: string | null;
  now?: string;
};

export type ClaimPaymentJobResult =
  | { status: "claimed"; job: PaymentJob; leaseToken: string }
  | { status: "already_terminal"; job: PaymentJob }
  | { status: "in_progress"; job: PaymentJob }
  | { status: "not_found" };

export type CompletePaymentJobInput = {
  jobId: string;
  leaseToken: string;
  outcome:
    | {
        kind: "succeeded_pending_webhook";
        tentativePaiementId: string;
        stripePaymentIntentId: string;
      }
    | {
        kind: "failed_terminal" | "failed_retryable" | "unknown";
        failureCode: PaymentRuntimeErrorCode | string;
        tentativePaiementId?: string | null;
        stripePaymentIntentId?: string | null;
      };
  now?: string;
};

export interface PaymentJobRepository {
  enqueue(input: EnqueuePaymentJobInput): Promise<PaymentJob>;
  claimNext(params: {
    leaseSeconds: number;
    now?: string;
  }): Promise<ClaimPaymentJobResult>;
  claimById(params: {
    jobId: string;
    leaseSeconds: number;
    now?: string;
  }): Promise<ClaimPaymentJobResult>;
  complete(input: CompletePaymentJobInput): Promise<PaymentJob>;
  getByIdempotencyKey(key: string): Promise<PaymentJob | null>;
  getById(id: string): Promise<PaymentJob | null>;
  listByStatus(status: PaymentJobStatus, limit?: number): Promise<PaymentJob[]>;
}

export type TentativeClaimResult =
  | {
      status: "claimed" | "reclaimed";
      tentativeId: string;
      leaseToken: string;
      montant: number;
      idempotencyKey: string;
      authorizationId: string;
      stripeAccountId: string;
      stripeCustomerId: string;
      stripePaymentMethodId: string;
    }
  | {
      status: "already_created";
      tentativeId: string;
      stripePaymentIntentId: string;
      montant: number;
    }
  | { status: "in_progress"; tentativeId: string }
  | { status: "rejected"; code: PaymentRuntimeErrorCode | string };

export type CompleteTentativeInput = {
  tentativeId: string;
  leaseToken: string;
  stripePaymentIntentId: string;
  stripeAccountId: string;
  stripeCustomerId: string;
  applicationFeeAmount: number;
  /** Ne passe jamais à RÉUSSIE ici — CREEE ou NECESSITE_ACTION_CLIENT / EN_TRAITEMENT. */
  localEtat: "CREEE" | "NECESSITE_ACTION_CLIENT" | "EN_TRAITEMENT";
};

export type FailTentativeInput = {
  tentativeId: string;
  leaseToken: string;
  retryable: boolean;
  errorCode: string;
};

/**
 * Port de persistance financière (créance / autorisation / tentative).
 * Les implémentations Supabase appellent des RPC service_role fencées.
 */
export interface PaymentAttemptRepository {
  loadChecklistSnapshot(params: {
    creanceId: string;
    prestataireId: string;
    requestedAmountCents: number;
    requestedCurrency: string;
    paymentsEnabled: boolean;
  }): Promise<AutomaticPaymentChecklistInput>;

  claimAutomaticAttempt(params: {
    creanceId: string;
    prestataireId: string;
    amountCents: number;
    authorizationId: string;
    stripeAccountId: string;
    stripeCustomerId: string;
    stripePaymentMethodId: string;
    idempotencyKey: string;
    leaseSeconds: number;
  }): Promise<TentativeClaimResult>;

  completeAutomaticAttempt(
    input: CompleteTentativeInput,
  ): Promise<{ tentativeId: string; etat: string }>;

  failAutomaticAttempt(
    input: FailTentativeInput,
  ): Promise<{ tentativeId: string; etat: string }>;
}

export type PaymentSnapshotParts = {
  creance: CreanceSnapshot;
  dossier: DossierSuiviSnapshot | null;
  authorization: AuthorizationSnapshot | null;
  activeAttempt: ActiveAttemptSnapshot | null;
  connect: ConnectLiveSnapshot | null;
  autoDebitCeilingCents: number | null;
};
