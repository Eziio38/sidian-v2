import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveContext: vi.fn(),
  createAdmin: vi.fn(),
  loadMessages: vi.fn(),
  attachClient: vi.fn(),
  assignProject: vi.fn(),
  renameConversation: vi.fn(),
  persistConversationTurn: vi.fn(),
  deleteConversation: vi.fn(),
}));

vi.mock("@/lib/assistant-conversations/request-context", () => ({
  resolveAssistantConversationRequestContext: mocks.resolveContext,
}));
vi.mock("@/lib/assistant-conversations", () => ({
  loadConversationMessages: mocks.loadMessages,
  attachConversationToClient: mocks.attachClient,
  assignConversationToProject: mocks.assignProject,
  renameConversation: mocks.renameConversation,
  persistConversationTurn: mocks.persistConversationTurn,
  deleteConversation: mocks.deleteConversation,
}));
vi.mock("@/lib/agent/server/auth/service-role", () => ({
  createAgentPersistenceClient: mocks.createAdmin,
}));

import { GET, PATCH, POST } from "./route";

const CONTEXT = {
  supabase: { kind: "user-scoped" },
  user: { id: "user-a" },
  prestataire: { id: "prestataire-a" },
};
const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

function routeContext() {
  return { params: Promise.resolve({ id: CONVERSATION_ID }) };
}

describe("/api/assistant/conversations/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveContext.mockResolvedValue(CONTEXT);
    mocks.createAdmin.mockResolvedValue({ kind: "service-role" });
  });

  it("charge par id avec le prestataire authentifié et sans cache privé", async () => {
    mocks.loadMessages.mockResolvedValue([]);

    const response = await GET(
      new Request("http://localhost"),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.loadMessages).toHaveBeenCalledWith(
      CONTEXT.supabase,
      "prestataire-a",
      CONVERSATION_ID,
    );
  });

  it("rattache un projet uniquement via le contexte serveur", async () => {
    mocks.assignProject.mockResolvedValue({
      projectId: PROJECT_ID,
      projectName: "Projet A",
    });

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: PROJECT_ID }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(mocks.assignProject).toHaveBeenCalledWith({
      admin: { kind: "service-role" },
      prestataireId: "prestataire-a",
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
    });
  });

  it("renomme uniquement dans le périmètre du prestataire authentifié", async () => {
    mocks.renameConversation.mockResolvedValue({ title: "Factures juillet" });

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "  Factures juillet  " }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.renameConversation).toHaveBeenCalledWith({
      admin: { kind: "service-role" },
      prestataireId: "prestataire-a",
      conversationId: CONVERSATION_ID,
      title: "Factures juillet",
    });
    expect(await response.json()).toMatchObject({ title: "Factures juillet" });
  });

  it("persiste un tour déterministe sans accepter de propriétaire client", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userContent: "Voir les paiements",
          assistantContent: "Aucun paiement en attente.",
        }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.persistConversationTurn).toHaveBeenCalledWith({
      admin: { kind: "service-role" },
      prestataireId: "prestataire-a",
      conversationId: CONVERSATION_ID,
      userContent: "Voir les paiements",
      assistantContent: "Aucun paiement en attente.",
    });
  });

  it("refuse un propriétaire transmis avec un tour déterministe", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userContent: "Voir les paiements",
          assistantContent: "Aucun paiement en attente.",
          ownerId: "user-b",
        }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expect(mocks.persistConversationTurn).not.toHaveBeenCalled();
  });

  it("masque un rattachement cross-tenant derrière un 404", async () => {
    mocks.assignProject.mockRejectedValue(
      new Error("conversation_project_scope_invalid"),
    );

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: PROJECT_ID }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      message: "Discussion introuvable.",
    });
  });

  it("refuse tout prestataire arbitraire dans le body", async () => {
    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: PROJECT_ID,
          prestataireId: "prestataire-b",
        }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expect(mocks.assignProject).not.toHaveBeenCalled();
  });
});
