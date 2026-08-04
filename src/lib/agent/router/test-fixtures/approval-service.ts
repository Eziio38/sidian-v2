/**
 * Spy HumanApprovalService mémoire pour tests Router G1-H.
 * Aucune I/O — décisions pilotées par le test.
 */

import type {
  ApprovalConsumptionInput,
  ApprovalConsumptionResult,
  ApprovalDecisionInput,
  ApprovalInspectionFound,
  ApprovalInspectionInput,
  ApprovalInspectionResult,
  ApprovalRequestInput,
  ApprovalStatus,
  HumanApprovalService,
} from "@/lib/agent/approvals";

import { APPROVAL_ID, FIXED_NOW, TENANT_A } from "./constants";

export type SpyApprovalService = HumanApprovalService & {
  inspectCalls: ApprovalInspectionInput[];
  consumeCalls: ApprovalConsumptionInput[];
  requestCalls: ApprovalRequestInput[];
  decideCalls: ApprovalDecisionInput[];
  inspectCount: () => number;
  consumeCount: () => number;
  setInspectResult: (result: ApprovalInspectionResult) => void;
  setConsumeResult: (result: ApprovalConsumptionResult) => void;
  /** Force consume à échouer après N appels réussis (0 = échoue immédiatement). */
  failConsumeAfter: (n: number) => void;
  reset: () => void;
};

export function defaultApprovedInspection(
  overrides: Partial<ApprovalInspectionFound> = {},
): ApprovalInspectionFound {
  return {
    found: true,
    approval_id: APPROVAL_ID,
    tenant_id: TENANT_A,
    status: "approved",
    request_fingerprint: "fp_fixture",
    params_hash: "params_fixture",
    tool_id: "payment.create_attempt",
    tool_version: "1.0.0",
    mode: "agir",
    requested_autonomy_level: 2,
    requested_at: FIXED_NOW,
    expires_at: "2026-07-24T18:00:00.000Z",
    decided_at: FIXED_NOW,
    decided_by_actor_id: "decider_1",
    decision_reason_code: "APPROVE",
    ...overrides,
  };
}

export function createSpyApprovalService(options?: {
  inspectResult?: ApprovalInspectionResult;
  consumeResult?: ApprovalConsumptionResult;
  /** Statut renvoyé par inspect (défaut approved). */
  status?: ApprovalStatus;
}): SpyApprovalService {
  let inspectResult: ApprovalInspectionResult =
    options?.inspectResult ??
    defaultApprovedInspection(
      options?.status ? { status: options.status } : {},
    );
  let consumeResult: ApprovalConsumptionResult =
    options?.consumeResult ?? {
      outcome: "consumed",
      approval_id: APPROVAL_ID,
      status: "consumed",
      consumed_at: FIXED_NOW,
    };
  let consumeSuccessBudget: number | null = null;

  const inspectCalls: ApprovalInspectionInput[] = [];
  const consumeCalls: ApprovalConsumptionInput[] = [];
  const requestCalls: ApprovalRequestInput[] = [];
  const decideCalls: ApprovalDecisionInput[] = [];

  const service: SpyApprovalService = {
    inspectCalls,
    consumeCalls,
    requestCalls,
    decideCalls,
    inspectCount: () => inspectCalls.length,
    consumeCount: () => consumeCalls.length,
    async request(input) {
      requestCalls.push(input);
      return {
        approval_id: APPROVAL_ID,
        status: "pending",
        requested_at: FIXED_NOW,
        expires_at: "2026-07-24T18:00:00.000Z",
      };
    },
    async decide(input) {
      decideCalls.push(input);
      return {
        approval_id: input.approval_id,
        status: input.decision === "approve" ? "approved" : "rejected",
        decided_at: FIXED_NOW,
        decision: input.decision,
      };
    },
    async inspect(input) {
      inspectCalls.push(input);
      return structuredClone(inspectResult);
    },
    async consume(input) {
      consumeCalls.push(input);
      if (consumeSuccessBudget !== null) {
        if (consumeSuccessBudget <= 0) {
          return {
            outcome: "already_consumed",
            code: "APPROVAL_ALREADY_CONSUMED",
            approval_id: input.approval_id,
            status: "consumed",
          };
        }
        consumeSuccessBudget -= 1;
      }
      return structuredClone(consumeResult);
    },
    setInspectResult(result) {
      inspectResult = result;
    },
    setConsumeResult(result) {
      consumeResult = result;
    },
    failConsumeAfter(n) {
      consumeSuccessBudget = n;
    },
    reset() {
      inspectCalls.length = 0;
      consumeCalls.length = 0;
      requestCalls.length = 0;
      decideCalls.length = 0;
      consumeSuccessBudget = null;
      inspectResult =
        options?.inspectResult ??
        defaultApprovedInspection(
          options?.status ? { status: options.status } : {},
        );
      consumeResult =
        options?.consumeResult ?? {
          outcome: "consumed",
          approval_id: APPROVAL_ID,
          status: "consumed",
          consumed_at: FIXED_NOW,
        };
    },
  };

  return service;
}
