import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireConfirmedUser: vi.fn(),
  decideApprovalRequest: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/session", () => ({
  requireConfirmedUser: mocks.requireConfirmedUser,
}));
vi.mock("@/lib/approvals/approvals", () => ({
  decideApprovalRequest: mocks.decideApprovalRequest,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { decideApprovalAction } from "./approvals";

describe("decideApprovalAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireConfirmedUser.mockResolvedValue({ id: "user" });
    mocks.createClient.mockResolvedValue({});
    mocks.decideApprovalRequest.mockResolvedValue("approved");
  });

  it("rejette toute décision ou tout identifiant hors contrat", async () => {
    const form = new FormData();
    form.set("id", "not-an-id");
    form.set("decision", "execute");

    const result = await decideApprovalAction(undefined, form);

    expect(result.ok).toBe(false);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("ne transmet à la RPC que l’intention humaine bornée", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const form = new FormData();
    form.set("id", id);
    form.set("decision", "rejected");
    form.set("prestataireId", "tenant-injecte");
    form.set("approvedBy", "user-injecte");
    mocks.decideApprovalRequest.mockResolvedValueOnce("rejected");

    await expect(decideApprovalAction(undefined, form)).resolves.toEqual({
      ok: true,
      message: "Demande refusée.",
    });
    expect(mocks.decideApprovalRequest).toHaveBeenCalledWith({}, id, "rejected");
  });

  it("rend l’expiration durable visible comme une erreur récupérable", async () => {
    const form = new FormData();
    form.set("id", "11111111-1111-4111-8111-111111111111");
    form.set("decision", "approved");
    mocks.decideApprovalRequest.mockResolvedValueOnce("expired");

    const result = await decideApprovalAction(undefined, form);

    expect(result).toEqual({
      ok: false,
      message: "Cette demande a expiré avant la décision. La liste a été actualisée.",
    });
  });
});
