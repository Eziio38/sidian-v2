import { describe, expect, it } from "vitest";

import { paymentCreateAttemptV1 } from "./definitions/payment.create_attempt.1.0.0";
import { notificationGenerateDraftV1 } from "./definitions/notification.generate_draft.1.0.0";
import { ToolRegistryError } from "./errors";
import { validateToolCallArguments } from "./validate-arguments";

function baseEnvelope(args: Record<string, unknown>) {
  return {
    tool_id: "payment.create_attempt",
    tool_version: "1.0.0",
    correlation_id: "corr_1",
    actor_id: "usr_1",
    account_id: "acc_1",
    object_id: "inv_1",
    human_validation_id: "val_1",
    arguments: args,
  };
}

describe("tool argument validation (G1-B)", () => {
  it("EVAL-TOOL-005: refuse un montant obligatoire manquant", () => {
    const result = validateToolCallArguments(
      paymentCreateAttemptV1,
      baseEnvelope({ invoice_id: "inv_1", currency: "EUR" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ToolRegistryError);
      expect(result.error.code).toBe("INVALID_ARGUMENT");
    }
  });

  it("EVAL-TOOL-006: refuse un montant au type invalide (string ambiguë)", () => {
    const result = validateToolCallArguments(
      paymentCreateAttemptV1,
      baseEnvelope({
        invoice_id: "inv_1",
        amount_cents: "12000",
        currency: "EUR",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_ARGUMENT");
    }
  });

  it("EVAL-TOOL-007: refuse une devise absente sans default sensible", () => {
    const result = validateToolCallArguments(
      paymentCreateAttemptV1,
      baseEnvelope({ invoice_id: "inv_1", amount_cents: 12000 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_ARGUMENT");
    }
  });

  it("accepte un contrat payment.create_attempt valide", () => {
    const result = validateToolCallArguments(
      paymentCreateAttemptV1,
      baseEnvelope({
        invoice_id: "inv_1",
        amount_cents: 12000,
        currency: "EUR",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("refuse human_validation_id dans les arguments métier", () => {
    const result = validateToolCallArguments(
      paymentCreateAttemptV1,
      baseEnvelope({
        invoice_id: "inv_1",
        amount_cents: 12000,
        currency: "EUR",
        human_validation_id: "smuggled",
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("EVAL-TOOL-023: refuse un payload notification avec données comptables", () => {
    const result = validateToolCallArguments(notificationGenerateDraftV1, {
      tool_id: "notification.generate_draft",
      tool_version: "1.0.0",
      correlation_id: "corr_2",
      actor_id: "usr_1",
      account_id: "acc_1",
      arguments: {
        invoice_id: "inv_1",
        template_id: "tpl_reminder",
        ledger_entries: [{ debit: 1 }],
        full_accounting: true,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PAYLOAD_NOT_MINIMAL");
    }
  });

  it("accepte un brouillon notification minimal", () => {
    const result = validateToolCallArguments(notificationGenerateDraftV1, {
      tool_id: "notification.generate_draft",
      tool_version: "1.0.0",
      correlation_id: "corr_2",
      actor_id: "usr_1",
      account_id: "acc_1",
      arguments: {
        invoice_id: "inv_1",
        template_id: "tpl_reminder",
      },
    });
    expect(result.ok).toBe(true);
  });
});
