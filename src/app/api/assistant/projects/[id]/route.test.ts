import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveContext: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
}));

vi.mock("@/lib/assistant-conversations/request-context", () => ({
  resolveAssistantConversationRequestContext: mocks.resolveContext,
}));
vi.mock("@/lib/assistant-projects", () => ({
  updateConversationProject: mocks.updateProject,
  deleteConversationProject: mocks.deleteProject,
}));

import { DELETE, PATCH } from "./route";

const CONTEXT = {
  supabase: { kind: "user-scoped" },
  user: { id: "user-a" },
  prestataire: { id: "prestataire-a" },
};
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function routeContext(id = PROJECT_ID) {
  return { params: Promise.resolve({ id }) };
}

describe("/api/assistant/projects/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveContext.mockResolvedValue(CONTEXT);
  });

  it("scope la modification par le prestataire authentifié", async () => {
    mocks.updateProject.mockResolvedValue({
      id: PROJECT_ID,
      name: "Projet A",
      icon: "folder",
      color: "sidian",
    });

    const response = await PATCH(
      new Request(`http://localhost/api/assistant/projects/${PROJECT_ID}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Projet A",
          icon: "folder",
          color: "sidian",
        }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(mocks.updateProject).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase: CONTEXT.supabase,
        prestataireId: "prestataire-a",
        projectId: PROJECT_ID,
      }),
    );
  });

  it("répond introuvable lorsque le projet n'appartient pas au compte", async () => {
    mocks.deleteProject.mockResolvedValue(false);

    const response = await DELETE(
      new Request(`http://localhost/api/assistant/projects/${PROJECT_ID}`, {
        method: "DELETE",
      }),
      routeContext(),
    );

    expect(response.status).toBe(404);
    expect(mocks.deleteProject).toHaveBeenCalledWith({
      supabase: CONTEXT.supabase,
      prestataireId: "prestataire-a",
      projectId: PROJECT_ID,
    });
  });
});
