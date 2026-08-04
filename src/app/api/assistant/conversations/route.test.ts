import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveContext: vi.fn(),
  createConversation: vi.fn(),
  listConversationHistory: vi.fn(),
  createAdmin: vi.fn(),
}));

vi.mock("@/lib/assistant-conversations/request-context", () => ({
  resolveAssistantConversationRequestContext: mocks.resolveContext,
}));

vi.mock("@/lib/assistant-conversations", () => ({
  createConversation: mocks.createConversation,
  listConversationHistory: mocks.listConversationHistory,
}));

vi.mock("@/lib/agent/server/auth/service-role", () => ({
  createAgentPersistenceClient: mocks.createAdmin,
}));

import { GET, POST } from "./route";

const CONTEXT = {
  supabase: { kind: "user-scoped" },
  user: { id: "user_1" },
  prestataire: { id: "prestataire_1" },
};

describe("/api/assistant/conversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveContext.mockResolvedValue(CONTEXT);
    mocks.createAdmin.mockResolvedValue({ kind: "service-role" });
  });

  it("liste uniquement via le contexte user-scopé résolu côté serveur", async () => {
    mocks.listConversationHistory.mockResolvedValue([
      {
        id: "22222222-2222-4222-8222-222222222222",
        clientId: null,
        clientName: null,
        title: "Nouvelle discussion",
        preview: null,
        updatedAt: "2026-07-27T10:00:00.000Z",
      },
    ]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.listConversationHistory).toHaveBeenCalledWith(
      CONTEXT.supabase,
      "prestataire_1",
    );
  });

  it("ignore toute tentative du body de choisir le prestataire", async () => {
    const response = await POST(
      new Request("http://localhost/api/assistant/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId: null,
          prestataireId: "prestataire_attaquant",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createConversation).not.toHaveBeenCalled();
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it("crée avec le prestataire trusted, jamais depuis le body", async () => {
    const conversation = {
      id: "22222222-2222-4222-8222-222222222222",
      clientId: null,
      clientName: null,
      title: "Nouvelle discussion",
      preview: null,
      updatedAt: "2026-07-27T10:00:00.000Z",
    };
    mocks.createConversation.mockResolvedValue(conversation);

    const response = await POST(
      new Request("http://localhost/api/assistant/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: null }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createConversation).toHaveBeenCalledWith({
      admin: { kind: "service-role" },
      prestataireId: "prestataire_1",
      clientId: null,
    });
  });
});
