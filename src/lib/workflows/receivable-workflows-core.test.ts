import { describe, expect, it, vi } from "vitest";

import {
  cancelPaymentReceivable,
  ensureFollowUpCase,
  updateFollowUpCase,
} from "./receivable-workflows-core";

const row = {
  id: "22222222-2222-4222-8222-222222222222",
  creance_id: "11111111-1111-4111-8111-111111111111",
  etat: "PREVENTION" as const,
  next_action_at: null,
  escalation_reason: null,
  clos_at: null,
  created_at: "2026-07-21T10:00:00.000Z",
  updated_at: "2026-07-21T10:00:00.000Z",
  last_agent_action_at: null,
  last_client_activity_at: null,
};

describe("commandes dossier et annulation", () => {
  it("crée le dossier par la RPC tenant-safe", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: row, error: null });
    await expect(
      ensureFollowUpCase(
        { rpc } as never,
        "11111111-1111-4111-8111-111111111111",
      ),
    ).resolves.toMatchObject({ state: "PREVENTION" });
    expect(rpc).toHaveBeenCalledWith("ensure_current_dossier_suivi", {
      p_creance_id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("transmet les valeurs nulles à SQL sans inventer de planification", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: row, error: null });
    await updateFollowUpCase({ rpc } as never, {
      receivableId: "11111111-1111-4111-8111-111111111111",
      targetState: "PREVENTION",
      nextActionAt: null,
      escalationReason: null,
    });
    expect(rpc).toHaveBeenCalledWith("update_current_dossier_suivi", {
      p_creance_id: "11111111-1111-4111-8111-111111111111",
      p_target_state: "PREVENTION",
      p_next_action_at: null,
      p_escalation_reason: null,
    });
  });

  it("préserve le code métier sûr d’une tentative encore en cours", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "payment_receivable_payment_in_progress" },
    });
    await expect(
      cancelPaymentReceivable(
        { rpc } as never,
        "11111111-1111-4111-8111-111111111111",
      ),
    ).rejects.toThrow("payment_receivable_payment_in_progress");
  });

  it("masque une erreur brute inconnue", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "database secret detail" },
    });
    await expect(
      cancelPaymentReceivable(
        { rpc } as never,
        "11111111-1111-4111-8111-111111111111",
      ),
    ).rejects.toThrow("receivable_workflow_failed");
  });
});
