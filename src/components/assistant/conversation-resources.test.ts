import { describe, expect, it } from "vitest";

import { extractConversationLinks } from "./conversation-resources";

describe("extractConversationLinks", () => {
  it("détecte les URLs avec schéma et les domaines nus", () => {
    expect(
      extractConversationLinks(["vois https://sidian.so/app et sidian.so"]),
    ).toEqual([
      {
        id: "link-1",
        url: "https://sidian.so/app",
        label: "sidian.so/app",
      },
      {
        id: "link-2",
        url: "https://sidian.so",
        label: "sidian.so",
      },
    ]);
  });

  it("ignore les extensions de fichiers dans les noms", () => {
    expect(
      extractConversationLinks([
        "Capture d’écran 2026-07-27 à 18.40.20.png",
      ]),
    ).toEqual([]);
  });
});
