import { describe, expect, it } from "vitest";

import { paymentCreateAttemptV1 } from "@/lib/agent/tools/definitions/payment.create_attempt.1.0.0";

import { PERMISSION_POLICY_VERSION } from "./policy";
import {
  createMemoryToolResolver,
  createPermissionService,
} from "./service";
import {
  FIXED_NOW,
  INVOICE_1,
  INVOICE_2,
  PARAMS_HASH_V1,
  PARAMS_HASH_V2,
  TENANT_A,
  TENANT_B,
  approvedOnlyDefinition,
  approvedValidation,
  baseReadRequest,
  baseWriteRequest,
  memoryDefinitions,
} from "./test-fixtures/requests";

const ctx = { now: FIXED_NOW };

function createService(
  defs = [...memoryDefinitions, approvedOnlyDefinition],
) {
  return createPermissionService({
    resolveToolDefinition: createMemoryToolResolver(defs),
  });
}

describe("Permission Service G1-C (déterministe, zéro I/O)", () => {
  it("refuse une requête invalide (INPUT_INVALID)", () => {
    const service = createService();
    const decision = service.authorize(
      { actor_id: "", actor_type: "human" },
      ctx,
    );
    expect(decision.decision).toBe("deny");
    expect(decision.reason_code).toBe("INPUT_INVALID");
    expect(decision.policy_version).toBe(PERMISSION_POLICY_VERSION);
  });

  it("refuse un champ inconnu lié au prompt (strict → INPUT_INVALID)", () => {
    const service = createService();
    const decision = service.authorize(
      {
        ...baseReadRequest(),
        prompt_says_allowed: true,
      },
      ctx,
    );
    expect(decision.decision).toBe("deny");
    expect(decision.reason_code).toBe("INPUT_INVALID");
    expect(decision.failed_check).toBe("request_schema");
  });

  it("refuse claimed_permission / llm_says_allowed / claimed_role", () => {
    const service = createService();
    for (const poison of [
      { llm_says_allowed: true },
      { claimed_permission: "invoice.read" },
      { claimed_role: "owner" },
    ]) {
      const decision = service.authorize(
        { ...baseReadRequest(), ...poison },
        ctx,
      );
      expect(decision.reason_code).toBe("INPUT_INVALID");
    }
  });

  it("refuse si grants absents (INPUT_INVALID)", () => {
    const service = createService();
    const { grants: _omit, ...withoutGrants } = baseReadRequest();
    const decision = service.authorize(withoutGrants, ctx);
    expect(decision.decision).toBe("deny");
    expect(decision.reason_code).toBe("INPUT_INVALID");
  });

  it("EVAL-MODE-008 / EVAL-TOOL-018: grants vides → PERMISSION_MISSING (≠ allow)", () => {
    const service = createService();
    const decision = service.authorize(
      baseReadRequest({ grants: [] }),
      ctx,
    );
    expect(decision.decision).toBe("deny");
    expect(decision.reason_code).toBe("PERMISSION_MISSING");
    expect(decision.error_code).toBe("PERMISSION_DENIED");
    expect(decision.error_code).not.toBe("VALIDATION_EXPIRED");
  });

  it("refuse permission absente (PERMISSION_MISSING)", () => {
    const service = createService();
    const decision = service.authorize(
      baseReadRequest({
        grants: [{ permission: "other.perm", tenant_id: TENANT_A }],
      }),
      ctx,
    );
    expect(decision.reason_code).toBe("PERMISSION_MISSING");
    expect(decision.error_code).toBe("PERMISSION_DENIED");
  });

  it("refuse mauvais tenant sur grant (TENANT_SCOPE_MISMATCH)", () => {
    const service = createService();
    const decision = service.authorize(
      baseReadRequest({
        grants: [{ permission: "invoice.read", tenant_id: TENANT_B }],
      }),
      ctx,
    );
    expect(decision.decision).toBe("deny");
    expect(decision.reason_code).toBe("TENANT_SCOPE_MISMATCH");
    expect(decision.error_code).toBe("PERMISSION_DENIED");
  });

  it("refuse mauvaise ressource scopée sur grant", () => {
    const service = createService();
    const decision = service.authorize(
      baseReadRequest({
        grants: [
          {
            permission: "invoice.read",
            tenant_id: TENANT_A,
            resource_id: INVOICE_2,
          },
        ],
      }),
      ctx,
    );
    expect(decision.reason_code).toBe("RESOURCE_SCOPE_MISMATCH");
  });

  it("refuse outil inconnu (TOOL_UNRESOLVED)", () => {
    const service = createService();
    const decision = service.authorize(
      baseReadRequest({ tool_id: "totally.unknown", tool_version: "1.0.0" }),
      ctx,
    );
    expect(decision.reason_code).toBe("TOOL_UNRESOLVED");
  });

  it("refuse outil non Production (TOOL_NOT_CALLABLE)", () => {
    const service = createService();
    const decision = service.authorize(
      baseWriteRequest({
        tool_id: "fixture.approved_only",
        tool_version: "1.0.0",
        human_validation: undefined,
        current_params_hash: undefined,
      }),
      ctx,
    );
    expect(decision.reason_code).toBe("TOOL_NOT_CALLABLE");
  });

  it("refuse version Deprecated (TOOL_NOT_CALLABLE)", () => {
    const service = createService();
    const decision = service.authorize(
      baseWriteRequest({
        tool_version: "0.9.0",
        human_validation: undefined,
      }),
      ctx,
    );
    expect(decision.reason_code).toBe("TOOL_NOT_CALLABLE");
  });

  it("refuse mode interdit (MODE_NOT_ALLOWED)", () => {
    const narrow: typeof paymentCreateAttemptV1 = {
      ...paymentCreateAttemptV1,
      tool_id: "fixture.mode_narrow",
      autonomy: {
        ...paymentCreateAttemptV1.autonomy,
        allowed_modes: ["conseiller"],
      },
    };
    const service2 = createPermissionService({
      resolveToolDefinition: createMemoryToolResolver([narrow]),
    });
    const decision = service2.authorize(
      baseWriteRequest({
        tool_id: "fixture.mode_narrow",
        mode: "agir",
        human_validation: undefined,
      }),
      ctx,
    );
    expect(decision.reason_code).toBe("MODE_NOT_ALLOWED");
  });

  it("refuse autonomie dépassée (AUTONOMY_EXCEEDED) — validation n’augmente pas le max", () => {
    const service = createService();
    const decision = service.authorize(
      baseReadRequest({ requested_autonomy_level: 3 }),
      ctx,
    );
    expect(decision.decision).toBe("deny");
    expect(decision.reason_code).toBe("AUTONOMY_EXCEEDED");
    expect(decision.autonomy.maximum).toBe(1);
    expect(decision.autonomy.requested).toBe(3);
  });

  it("validation absente → require_approval / VALIDATION_REQUIRED", () => {
    const service = createService();
    const decision = service.authorize(
      baseWriteRequest({
        human_validation: undefined,
        current_params_hash: PARAMS_HASH_V1,
      }),
      ctx,
    );
    expect(decision.decision).toBe("require_approval");
    expect(decision.reason_code).toBe("VALIDATION_REQUIRED");
    expect(decision.error_code).toBe("VALIDATION_REQUIRED");
    expect(decision.human_validation_required).toBe(true);
  });

  it("validation pending → require_approval / VALIDATION_PENDING", () => {
    const service = createService();
    const decision = service.authorize(
      baseWriteRequest({
        human_validation: approvedValidation({ status: "pending" }),
      }),
      ctx,
    );
    expect(decision.decision).toBe("require_approval");
    expect(decision.reason_code).toBe("VALIDATION_PENDING");
  });

  it("validation rejected → deny / VALIDATION_REJECTED", () => {
    const service = createService();
    const decision = service.authorize(
      baseWriteRequest({
        human_validation: approvedValidation({ status: "rejected" }),
      }),
      ctx,
    );
    expect(decision.decision).toBe("deny");
    expect(decision.reason_code).toBe("VALIDATION_REJECTED");
  });

  it("EVAL-TOOL-017: validation expired (status) → VALIDATION_EXPIRED", () => {
    const service = createService();
    const decision = service.authorize(
      baseWriteRequest({
        human_validation: approvedValidation({ status: "expired" }),
      }),
      ctx,
    );
    expect(decision.decision).toBe("deny");
    expect(decision.reason_code).toBe("VALIDATION_EXPIRED");
    expect(decision.error_code).toBe("VALIDATION_EXPIRED");
    expect(decision.error_code).not.toBe("PERMISSION_DENIED");
  });

  it("EVAL-TOOL-017: expires_at <= now injecté → VALIDATION_EXPIRED", () => {
    const service = createService();
    const decision = service.authorize(
      baseWriteRequest({
        human_validation: approvedValidation({
          expires_at: "2026-07-24T11:00:00.000Z",
        }),
      }),
      ctx,
    );
    expect(decision.reason_code).toBe("VALIDATION_EXPIRED");
  });

  it("EVAL-MODE-010: hash paramètres modifié → VALIDATION_EXPIRED", () => {
    const service = createService();
    const decision = service.authorize(
      baseWriteRequest({
        current_params_hash: PARAMS_HASH_V2,
        human_validation: approvedValidation({
          bound_params_hash: PARAMS_HASH_V1,
        }),
      }),
      ctx,
    );
    expect(decision.decision).toBe("deny");
    expect(decision.reason_code).toBe("VALIDATION_EXPIRED");
    expect(decision.error_code).toBe("VALIDATION_EXPIRED");
  });

  it("outil/version/tenant/mode/ressource incompatibles → VALIDATION_SCOPE_MISMATCH", () => {
    const service = createService();
    const cases = [
      approvedValidation({ bound_tenant_id: TENANT_B }),
      approvedValidation({ bound_tool_id: "invoice.get" }),
      approvedValidation({ bound_tool_version: "9.9.9" }),
      approvedValidation({ bound_mode: "conseiller" }),
      approvedValidation({
        bound_resource: {
          kind: "invoice",
          resource_id: INVOICE_2,
          tenant_id: TENANT_A,
        },
      }),
    ];
    for (const hv of cases) {
      const decision = service.authorize(
        baseWriteRequest({ human_validation: hv }),
        ctx,
      );
      expect(decision.reason_code).toBe("VALIDATION_SCOPE_MISMATCH");
      expect(decision.error_code).toBe("VALIDATION_SCOPE_MISMATCH");
    }
  });

  it("cas nominal read → allow", () => {
    const service = createService();
    const decision = service.authorize(baseReadRequest(), ctx);
    expect(decision.decision).toBe("allow");
    expect(decision.reason_code).toBe("ALLOW");
    expect(decision.error_code).toBeUndefined();
    expect(decision.human_validation_required).toBe(false);
    expect(decision.required_permissions).toEqual(["invoice.read"]);
    expect(decision.matching_grants.length).toBe(1);
    expect(decision.checks).toContain("grants");
    expect(decision.failed_check).toBeUndefined();
  });

  it("cas nominal write avec validation → allow", () => {
    const service = createService();
    const decision = service.authorize(baseWriteRequest(), ctx);
    expect(decision.decision).toBe("allow");
    expect(decision.reason_code).toBe("ALLOW");
    expect(decision.tool_id).toBe("payment.create_attempt");
    expect(decision.tool_version).toBe("1.0.0");
    expect(decision.mode).toBe("agir");
    expect(decision.scope).toEqual({
      tenant_id: TENANT_A,
      resource_id: INVOICE_1,
    });
  });

  it("déterminisme avec now injecté (pas d’horloge globale)", () => {
    const service = createService();
    const request = baseWriteRequest({
      human_validation: approvedValidation({
        expires_at: "2026-07-24T12:30:00.000Z",
      }),
    });
    const before = service.authorize(request, {
      now: "2026-07-24T12:00:00.000Z",
    });
    const after = service.authorize(request, {
      now: "2026-07-24T13:00:00.000Z",
    });
    expect(before.decision).toBe("allow");
    expect(after.reason_code).toBe("VALIDATION_EXPIRED");
  });

  it("n’altère pas les inputs (immutabilité)", () => {
    const service = createService();
    const request = baseWriteRequest();
    const snapshot = structuredClone(request);
    const context = { now: FIXED_NOW };
    const contextSnapshot = structuredClone(context);
    service.authorize(request, context);
    expect(request).toEqual(snapshot);
    expect(context).toEqual(contextSnapshot);
  });

  it("refus fermé sur erreur interne simulée (POLICY_EVALUATION_FAILED)", () => {
    const service = createPermissionService({
      resolveToolDefinition: () => {
        throw new Error("boom interne");
      },
    });
    const decision = service.authorize(baseReadRequest(), ctx);
    expect(decision.decision).toBe("deny");
    expect(decision.reason_code).toBe("POLICY_EVALUATION_FAILED");
    expect(decision.error_code).toBe("PERMISSION_EVALUATION_FAILED");
    const serialized = JSON.stringify(decision);
    expect(serialized).not.toContain("boom");
    expect(serialized).not.toContain("stack");
    expect(serialized).not.toContain("interne");
  });

  it("EVAL-TOOL-018: PERMISSION_DENIED distinct de VALIDATION_EXPIRED", () => {
    const service = createService();
    const denied = service.authorize(baseReadRequest({ grants: [] }), ctx);
    const expired = service.authorize(
      baseWriteRequest({
        human_validation: approvedValidation({ status: "expired" }),
      }),
      ctx,
    );
    expect(denied.error_code).toBe("PERMISSION_DENIED");
    expect(expired.error_code).toBe("VALIDATION_EXPIRED");
    expect(denied.error_code).not.toBe(expired.error_code);
  });

  it("refuse contexte sans now (INPUT_INVALID)", () => {
    const service = createService();
    const decision = service.authorize(baseReadRequest(), {});
    expect(decision.reason_code).toBe("INPUT_INVALID");
  });

  it("refuse resource absente quand le scope outil l’exige", () => {
    const service = createService();
    const decision = service.authorize(
      baseReadRequest({ resource: undefined }),
      ctx,
    );
    expect(decision.reason_code).toBe("RESOURCE_SCOPE_MISMATCH");
  });
});
