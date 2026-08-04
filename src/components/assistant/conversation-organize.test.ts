import { describe, expect, it } from "vitest";

import { buildConversationOrganizeOptions } from "./conversation-organize";

describe("buildConversationOrganizeOptions", () => {
  it("ne propose que Général et les projets explicites", () => {
    const options = buildConversationOrganizeOptions({
      projects: [
        { id: "p1", name: "Michel" },
        { id: "p2", name: "  " },
      ],
    });

    expect(options).toEqual([
      {
        id: "general",
        label: "Général",
        kind: "general",
        clientId: null,
        clientName: null,
        projectId: null,
        projectName: null,
      },
      {
        id: "project-p1",
        label: "Michel",
        kind: "project",
        clientId: null,
        clientName: null,
        projectId: "p1",
        projectName: "Michel",
      },
    ]);
  });

  it("n’injecte plus les noms de clients comme projets", () => {
    // Ancienne API : knownClientNames / historyClients ne sont plus des sources.
    const options = buildConversationOrganizeOptions({
      projects: [],
    });
    expect(options).toHaveLength(1);
    expect(options[0]?.id).toBe("general");
  });
});
