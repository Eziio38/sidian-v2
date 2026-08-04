import { describe, expect, it } from "vitest";

import { parseToolDefinition } from "./definition-schema";
import {
  approveRefundToolAttempt,
  decideToolAttempt,
  godToolAttempt,
  incompleteToolFiche,
} from "./test-fixtures/invalid-definitions";
import { paymentCreateAttemptV1 } from "./definitions/payment.create_attempt.1.0.0";

describe("tool definition schema (G1-B)", () => {
  it("EVAL-DOC-008: refuse une fiche incomplète (id/type/autonomie/idempotence)", () => {
    expect(() => parseToolDefinition(incompleteToolFiche)).toThrow();
  });

  it("accepte une fiche Production normative payment.create_attempt", () => {
    const parsed = parseToolDefinition(paymentCreateAttemptV1);
    expect(parsed.tool_id).toBe("payment.create_attempt");
    expect(parsed.effect_family).toBe("create_payment_attempt");
    expect(parsed.status).toBe("Production");
  });

  it("EVAL-TOOL-001: refuse une famille hors allowlist (lecture+paiement+email)", () => {
    expect(() => parseToolDefinition(godToolAttempt)).toThrow(
      /effect_family hors allowlist|effect_family interdite/,
    );
  });

  it("EVAL-TOOL-027: refuse structurellement approve/decide/arbitrate", () => {
    expect(() => parseToolDefinition(approveRefundToolAttempt)).toThrow(
      /effect_family interdite/,
    );
    expect(() => parseToolDefinition(decideToolAttempt)).toThrow(
      /effect_family interdite/,
    );
  });
});
