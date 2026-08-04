import { describe, expect, it } from "vitest";

import {
  getComposerShortcuts,
  resolveShortcutPhase,
  shouldShowContextPanel,
  shouldShowWelcomeState,
} from "./shortcuts";
import type { ActiveContextData } from "./types";

const draftContext: ActiveContextData = {
  id: "ctx-1",
  type: "protection_draft",
  protection: {
    clientName: "Dupont Conseil",
    statusLabel: "Brouillon",
    status: "draft",
    amountLabel: "2 400 €",
  },
};

describe("assistant shortcuts helpers", () => {
  it("montre WelcomeState seulement à conversation vide sans contexte", () => {
    expect(
      shouldShowWelcomeState({
        messagesLength: 0,
        isGenerating: false,
        activeContext: null,
      }),
    ).toBe(true);

    expect(
      shouldShowWelcomeState({
        messagesLength: 1,
        isGenerating: false,
        activeContext: null,
      }),
    ).toBe(false);

    expect(
      shouldShowWelcomeState({
        messagesLength: 0,
        isGenerating: true,
        activeContext: null,
      }),
    ).toBe(false);
  });

  it("masque le ContextPanel par défaut et sur mobile permanent", () => {
    expect(
      shouldShowContextPanel({
        activeContext: null,
        isContextPanelOpen: false,
        viewport: "desktop",
      }),
    ).toBe(false);

    expect(
      shouldShowContextPanel({
        activeContext: draftContext,
        isContextPanelOpen: true,
        viewport: "mobile",
      }),
    ).toBe(false);

    expect(
      shouldShowContextPanel({
        activeContext: draftContext,
        isContextPanelOpen: true,
        viewport: "desktop",
      }),
    ).toBe(true);
  });

  it("adapte les raccourcis selon la phase", () => {
    expect(resolveShortcutPhase(null)).toBe("default");
    expect(resolveShortcutPhase(draftContext)).toBe("draft");
    expect(
      resolveShortcutPhase({
        id: "ctx-2",
        type: "protection",
      }),
    ).toBe("created");

    expect(getComposerShortcuts("default").map((s) => s.id)).toEqual([
      "create-protection",
      "add-invoice",
      "create-client",
      "view-expected",
    ]);
    expect(getComposerShortcuts("draft").map((s) => s.action)).toContain(
      "edit_amount",
    );
    expect(getComposerShortcuts("created").map((s) => s.action)).toContain(
      "view_protection",
    );
    expect(
      getComposerShortcuts("draft", { includeReopenPanel: true }).map(
        (s) => s.action,
      ),
    ).toContain("reopen_protection_panel");
  });
});
