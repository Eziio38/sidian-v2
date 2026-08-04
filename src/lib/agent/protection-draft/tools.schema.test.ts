/**
 * G1-M — schémas outils : refuse tenant/actor dans le body.
 */

import { describe, expect, it } from "vitest";

import {
  protectionDraftAdvanceInputSchema,
  protectionDraftConfirmInputSchema,
} from "@/lib/agent/tools/schemas/protection-draft";
import { loadProductionRegistry } from "@/lib/agent/tools/registry";

describe("G1-M tool schemas / registry", () => {
  it("enregistre les 5 outils protection.draft.* en Production", () => {
    const registry = loadProductionRegistry();
    for (const id of [
      "protection.draft.advance",
      "protection.draft.get",
      "protection.draft.cancel",
      "protection.draft.confirm",
      "protection.draft.converse",
    ]) {
      const def = registry.assertCallable(id, "1.0.0");
      expect(def.status).toBe("Production");
    }
  });

  it("refuse tenant_id / actor_id dans advance", () => {
    const parsed = protectionDraftAdvanceInputSchema.safeParse({
      intent: { kind: "message", text: "hello" },
      tenant_id: "11111111-1111-4111-8111-111111111111",
      actor_id: "evil",
    });
    expect(parsed.success).toBe(false);
  });

  it("refuse tenant_id dans confirm", () => {
    const parsed = protectionDraftConfirmInputSchema.safeParse({
      draft_id: "11111111-1111-4111-8111-111111111111",
      explicit_confirmation: true,
      confirmation_nonce: "nonce-12345678",
      tenant_id: "22222222-2222-4222-8222-222222222222",
    });
    expect(parsed.success).toBe(false);
  });

  it("exige explicit_confirmation=true", () => {
    const parsed = protectionDraftConfirmInputSchema.safeParse({
      draft_id: "11111111-1111-4111-8111-111111111111",
      explicit_confirmation: false,
      confirmation_nonce: "nonce-12345678",
    });
    expect(parsed.success).toBe(false);
  });
});
