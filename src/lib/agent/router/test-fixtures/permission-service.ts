/**
 * Permission Service fake déterministe pour G1-D.
 * Aucune I/O — décision pilotée par le test.
 */

import type {
  PermissionDecision,
  PermissionService,
} from "@/lib/agent/permissions/types";

import type { CallLog } from "./call-log";

export type FakePermissionMode =
  | "allow"
  | "deny"
  | "require_approval"
  | "passthrough";

export type FakePermissionService = PermissionService & {
  authorizeCalls: Array<{ request: unknown; context: unknown }>;
  setMode: (mode: FakePermissionMode) => void;
  setDecision: (decision: PermissionDecision) => void;
  reset: () => void;
};

const baseDecision = (
  overrides: Partial<PermissionDecision> = {},
): PermissionDecision => ({
  decision: "allow",
  reason_code: "ALLOW",
  policy_version: "fixture.permission.v1",
  scope: { tenant_id: "tenant_a" },
  checks: ["fixture"],
  required_permissions: [],
  matching_grants: [],
  tool_id: null,
  tool_version: null,
  mode: null,
  autonomy: { requested: null, maximum: null },
  human_validation_required: false,
  ...overrides,
});

export function createFakePermissionService(options?: {
  mode?: FakePermissionMode;
  callLog?: CallLog;
  /** Décision fixe (prioritaire sur mode si fournie au constructeur puis via setDecision). */
  decision?: PermissionDecision;
}): FakePermissionService {
  let mode: FakePermissionMode = options?.mode ?? "allow";
  let fixed: PermissionDecision | null = options?.decision ?? null;
  const authorizeCalls: FakePermissionService["authorizeCalls"] = [];
  const callLog = options?.callLog;

  const resolve = (): PermissionDecision => {
    if (fixed) return structuredClone(fixed);
    switch (mode) {
      case "deny":
        return baseDecision({
          decision: "deny",
          reason_code: "PERMISSION_MISSING",
          error_code: "PERMISSION_DENIED",
          failed_check: "grants",
        });
      case "require_approval":
        return baseDecision({
          decision: "require_approval",
          reason_code: "VALIDATION_REQUIRED",
          error_code: "VALIDATION_REQUIRED",
          human_validation_required: true,
          failed_check: "human_validation",
        });
      case "allow":
      case "passthrough":
      default:
        return baseDecision({
          decision: "allow",
          reason_code: "ALLOW",
        });
    }
  };

  const service: FakePermissionService = {
    authorizeCalls,
    authorize(request: unknown, context: unknown): PermissionDecision {
      authorizeCalls.push({ request, context });
      callLog?.recordPermission();
      return resolve();
    },
    setMode(next: FakePermissionMode) {
      mode = next;
      fixed = null;
    },
    setDecision(decision: PermissionDecision) {
      fixed = decision;
    },
    reset() {
      authorizeCalls.length = 0;
      mode = options?.mode ?? "allow";
      fixed = options?.decision ?? null;
    },
  };

  return service;
}

export { baseDecision as fakePermissionDecision };
