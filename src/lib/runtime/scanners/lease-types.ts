import type { WorkflowScannerKind } from "../workflow-policy";

export type ScanLeaseClaim = {
  creanceId: string;
  occurrenceKey: string;
  leaseToken: string;
  leaseExpiresAt: string;
};

export type EnsureScanLeasesInput = {
  scannerKind: WorkflowScannerKind;
  items: Array<{ creanceId: string; occurrenceKey: string }>;
  policyVersion: string;
};

export type ClaimScanLeasesInput = {
  scannerKind: WorkflowScannerKind;
  items: Array<{ creanceId: string; occurrenceKey: string }>;
  now: string;
  leaseSeconds: number;
  batchSize: number;
};

export type CompleteScanLeaseInput = {
  scannerKind: WorkflowScannerKind;
  creanceId: string;
  occurrenceKey: string;
  leaseToken: string;
  now: string;
};

export type FailScanLeaseInput = CompleteScanLeaseInput & {
  errorCode?: string;
};

export type ScanLeaseRepository = {
  ensure(input: EnsureScanLeasesInput): Promise<number>;
  claim(input: ClaimScanLeasesInput): Promise<ScanLeaseClaim[]>;
  complete(input: CompleteScanLeaseInput): Promise<boolean>;
  fail(input: FailScanLeaseInput): Promise<boolean>;
};
