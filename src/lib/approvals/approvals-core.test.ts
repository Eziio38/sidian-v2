import { describe, expect, it, vi } from "vitest";

import { decideApprovalRequest, presentApprovalRequest } from "./approvals-core";

describe("approbations", () => {
  it("présente un succès Stripe non rapproché sans exposer ses identifiants", () => {
    const presentation = presentApprovalRequest({
      id: "11111111-1111-4111-8111-111111111111",
      type: "autre",
      status: "pending",
      created_at: "2026-07-21T10:00:00.000Z",
      expires_at: null,
      payload: {
        reason: "payment_succeeded_tentative_unresolved",
        amount_received: 12500,
        stripe_payment_intent_id: "pi_secret",
      },
    });

    expect(presentation.title).toContain("rapprocher");
    expect(presentation.amount).toContain("125");
    expect(JSON.stringify(presentation)).not.toContain("pi_secret");
  });

  it("transmet uniquement l’identifiant et la décision à la RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { status: "approved" },
      error: null,
    });

    await expect(
      decideApprovalRequest(
        { rpc } as never,
        "11111111-1111-4111-8111-111111111111",
        "approved",
      ),
    ).resolves.toBe("approved");
    expect(rpc).toHaveBeenCalledWith("decide_current_approval_request", {
      p_approval_request_id: "11111111-1111-4111-8111-111111111111",
      p_decision: "approved",
    });
  });
});
