import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationalWorkspace } from "./conversational-workspace";

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/assistant",
}));

describe("ConversationalWorkspace", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("affiche WelcomeState à l’état A (conversation vide, panneau fermé)", () => {
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="A"
        viewport="desktop"
      />,
    );

    expect(screen.getByTestId("welcome-state")).toBeVisible();
    expect(screen.getByText("Bonjour Lucie")).toBeVisible();
    expect(screen.queryByTestId("context-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("conversational-workspace")).toHaveAttribute(
      "data-panel-open",
      "false",
    );
    expect(screen.getByTestId("composer-shortcuts")).toBeVisible();
    expect(
      screen.getByTestId("composer-shortcut-create-protection"),
    ).toBeVisible();
  });

  it("cache WelcomeState après le premier message (état B)", () => {
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="B"
        viewport="desktop"
      />,
    );

    expect(screen.queryByTestId("welcome-state")).not.toBeInTheDocument();
    expect(screen.getByTestId("message-thread")).toBeVisible();
    expect(screen.queryByTestId("context-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("composer-shortcuts")).toBeVisible();
  });

  it("ouvre le ContextPanel lorsqu’un contexte est actif (état C)", () => {
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="C"
        viewport="desktop"
      />,
    );

    expect(screen.getByTestId("context-panel")).toBeVisible();
    expect(screen.getByTestId("conversational-workspace")).toHaveAttribute(
      "data-panel-open",
      "true",
    );
    expect(screen.getByText("Dupont Conseil")).toBeVisible();
    expect(
      screen.getByTestId("composer-shortcut-edit-amount"),
    ).toBeVisible();
  });

  it("permet de refermer le panneau et reprend la largeur (état D)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ConversationalWorkspace
        key="C"
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="C"
        viewport="desktop"
      />,
    );

    expect(screen.getByTestId("context-panel")).toBeVisible();
    await user.click(screen.getByTestId("context-panel-close"));
    expect(screen.queryByTestId("context-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("conversational-workspace")).toHaveAttribute(
      "data-panel-open",
      "false",
    );

    rerender(
      <ConversationalWorkspace
        key="D"
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="D"
        viewport="desktop"
      />,
    );

    expect(screen.queryByTestId("context-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("message-thread")).toBeVisible();
  });

  it("adapte les raccourcis après création (état E)", () => {
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="E"
        viewport="desktop"
      />,
    );

    expect(screen.getByTestId("context-panel")).toBeVisible();
    expect(
      screen.getByTestId("composer-shortcut-view-protection"),
    ).toBeVisible();
    expect(
      screen.getByTestId("composer-shortcut-mark-paid"),
    ).toBeVisible();
  });

  it("déclenche l’action du raccourci sélectionné", async () => {
    const user = userEvent.setup();
    const onShortcutAction = vi.fn();

    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="A"
        viewport="desktop"
        onShortcutAction={onShortcutAction}
      />,
    );

    await user.click(screen.getByTestId("composer-shortcut-view-expected"));
    expect(onShortcutAction).toHaveBeenCalledWith("view_expected_payments");
    expect(screen.getByTestId("conversational-workspace")).toHaveAttribute(
      "data-last-shortcut",
      "view_expected_payments",
    );
  });

  it("cache WelcomeState après envoi du premier message", async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        viewport="desktop"
      />,
    );

    expect(screen.getByTestId("welcome-state")).toBeVisible();

    await user.type(
      screen.getByTestId("composer-input"),
      "Bonjour Sidian",
    );
    await user.click(screen.getByTestId("composer-send"));

    expect(screen.queryByTestId("welcome-state")).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("message-thread")).getByText("Bonjour Sidian"),
    ).toBeVisible();

    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("ne rend pas de panneau permanent sur mobile", () => {
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="C"
        viewport="mobile"
      />,
    );

    expect(screen.getByTestId("conversational-workspace")).toHaveAttribute(
      "data-panel-open",
      "false",
    );
    expect(screen.getByTestId("conversational-workspace")).toHaveAttribute(
      "data-viewport",
      "mobile",
    );

    const panel = screen.getByTestId("context-panel");
    expect(panel).toHaveAttribute("data-mode", "sheet");
  });
});
