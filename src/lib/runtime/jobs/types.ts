import type {
  WorkflowJobKind,
  WorkflowScannerKind,
} from "../workflow-policy";

export type RuntimeJobStatus =
  | "pending"
  | "claimed"
  | "completed"
  | "failed_retryable"
  | "failed_terminal"
  | "cancelled";

export type RuntimeJobRecord = {
  id: string;
  prestataireId: string;
  creanceId: string;
  dossierSuiviId: string | null;
  scannerKind: WorkflowScannerKind;
  jobKind: WorkflowJobKind;
  policyVersion: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  status: RuntimeJobStatus;
  availableAt: string;
  createdAt: string;
};

export type EnqueueRuntimeJobInput = {
  prestataireId: string;
  creanceId: string;
  dossierSuiviId: string | null;
  scannerKind: WorkflowScannerKind;
  jobKind: WorkflowJobKind;
  policyVersion: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  availableAt?: string;
  now: string;
};

export type EnqueueRuntimeJobResult = {
  enqueued: boolean;
  duplicate: boolean;
  jobId: string;
  status: RuntimeJobStatus;
};

export type RuntimeJobRepository = {
  enqueue(input: EnqueueRuntimeJobInput): Promise<EnqueueRuntimeJobResult>;
};
