import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveContext: vi.fn(),
  listProjects: vi.fn(),
  createProject: vi.fn(),
}));

vi.mock("@/lib/assistant-conversations/request-context", () => ({
  resolveAssistantConversationRequestContext: mocks.resolveContext,
}));
vi.mock("@/lib/assistant-projects", () => ({
  listConversationProjects: mocks.listProjects,
  createConversationProject: mocks.createProject,
}));

import { GET, POST } from "./route";

const CONTEXT = {
  supabase: { kind: "user-scoped" },
  user: { id: "user-a" },
  prestataire: { id: "prestataire-a" },
};

describe("/api/assistant/projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveContext.mockResolvedValue(CONTEXT);
  });

  it("liste avec le client et le prestataire résolus depuis la session", async () => {
    mocks.listProjects.mockResolvedValue([]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.listProjects).toHaveBeenCalledWith(
      CONTEXT.supabase,
      "prestataire-a",
    );
  });

  it("refuse un propriétaire fourni par le navigateur", async () => {
    const response = await POST(
      new Request("http://localhost/api/assistant/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Projet",
          icon: "folder",
          color: "sidian",
          prestataireId: "prestataire-b",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it("force le propriétaire authentifié lors de la création", async () => {
    mocks.createProject.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Projet",
      icon: "folder",
      color: "sidian",
    });

    const response = await POST(
      new Request("http://localhost/api/assistant/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Projet",
          icon: "folder",
          color: "sidian",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createProject).toHaveBeenCalledWith({
      supabase: CONTEXT.supabase,
      prestataireId: "prestataire-a",
      project: { name: "Projet", icon: "folder", color: "sidian" },
    });
  });
});
