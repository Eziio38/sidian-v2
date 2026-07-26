import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentTransport } from "./agent-client";
import { ConversationalWorkspace } from "./conversational-workspace";

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/assistant",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
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
    expect(screen.getByTestId("protection-field-consequences")).toBeVisible();
    await user.click(screen.getByTestId("context-panel-close"));
    expect(screen.queryByTestId("context-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("conversational-workspace")).toHaveAttribute(
      "data-panel-open",
      "false",
    );
    // Brouillon conservé — raccourci de réouverture
    expect(
      screen.getByTestId("composer-shortcut-reopen-panel"),
    ).toBeVisible();

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

  it("rouvre le panneau sans perdre le brouillon après fermeture", async () => {
    const user = userEvent.setup();
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="C"
        viewport="desktop"
      />,
    );

    expect(screen.getByText("Dupont Conseil")).toBeVisible();
    await user.click(screen.getByTestId("context-panel-close"));
    expect(screen.queryByTestId("context-panel")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("composer-shortcut-reopen-panel"));
    expect(screen.getByTestId("context-panel")).toBeVisible();
    expect(screen.getByText("Dupont Conseil")).toBeVisible();
    expect(screen.getByTestId("protection-field-amount")).toHaveTextContent(
      "2 400",
    );
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

    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="A"
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
  }, 15_000);

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

describe("ConversationalWorkspace live agent", () => {
  it(
    "appelle protection.draft.converse et affiche la réponse",
    async () => {
      const user = userEvent.setup();
      const transport = vi.fn(async () => ({
        ok: true as const,
        request_id: "req-1",
        correlation_id: "corr-1",
        tool_id: "protection.draft.converse",
        tool_version: "1.0.0",
        output: {
          draft_id: "11111111-1111-4111-8111-111111111111",
          state: "QUESTION_CIBLEE",
          missing_fields: ["client_email"],
          pending_question: "Quelle est l’adresse e-mail du contact client ?",
          open_ambiguities: [],
          recap: {
            client_name: "Dupont Conseil",
            client_email: null,
            expected_amount_minor: 240000,
            currency: "EUR",
            due_date: "2026-09-12",
            libelle: null,
            reference_externe: null,
          },
          confirmation_nonce: null,
          summary: "Proposition de brouillon — Client : Dupont Conseil.",
        },
      }));

      render(
        <ConversationalWorkspace
          userFirstName="Lucie"
          userDisplayName="Lucie Martin"
          viewport="desktop"
          forceLiveAgent
          agentTransport={transport as AgentTransport}
        />,
      );

      await user.type(screen.getByTestId("composer-input"), "Protection Dupont");
      await user.click(screen.getByTestId("composer-send"));

      expect(await screen.findByText(/adresse e-mail/i)).toBeVisible();
      expect(transport).toHaveBeenCalledTimes(1);
      const firstCall = transport.mock.calls[0] as unknown as
        | [{ tool_id: string; tool_version: string; arguments: unknown }]
        | undefined;
      expect(firstCall?.[0]).toMatchObject({
        tool_id: "protection.draft.converse",
        tool_version: "1.0.0",
        arguments: { message: "Protection Dupont" },
      });
      expect(screen.getByTestId("conversational-workspace")).toHaveAttribute(
        "data-live-agent",
        "true",
      );
    },
    15_000,
  );

  it(
    "affiche une erreur récupérable si le runtime échoue",
    async () => {
      const user = userEvent.setup();
      const transport = vi.fn(async () => ({
        ok: false as const,
        code: "NETWORK_ERROR",
        message: "Le runtime conversationnel est indisponible.",
        httpStatus: 0,
        retryable: true,
      }));

      render(
        <ConversationalWorkspace
          userFirstName="Lucie"
          userDisplayName="Lucie Martin"
          viewport="desktop"
          forceLiveAgent
          agentTransport={transport as AgentTransport}
        />,
      );

      await user.type(screen.getByTestId("composer-input"), "Bonjour");
      await user.click(screen.getByTestId("composer-send"));

    expect(await screen.findByTestId("message-retry")).toBeVisible();
    expect(screen.getByTestId("composer-error")).toBeVisible();
    expect(
      screen.getAllByText(/runtime conversationnel est indisponible/i).length,
    ).toBeGreaterThan(0);
  },
  15_000,
);

  it(
    "signale une réponse vide comme erreur récupérable",
    async () => {
      const user = userEvent.setup();
      const transport = vi.fn(async () => ({
        ok: true as const,
        request_id: "req-empty",
        correlation_id: "corr-empty",
        tool_id: "protection.draft.converse",
        tool_version: "1.0.0",
        output: {},
      }));

      render(
        <ConversationalWorkspace
          userFirstName="Lucie"
          userDisplayName="Lucie Martin"
          viewport="desktop"
          forceLiveAgent
          agentTransport={transport as AgentTransport}
        />,
      );

      await user.type(screen.getByTestId("composer-input"), "Hello");
      await user.click(screen.getByTestId("composer-send"));

      expect(await screen.findByText(/n’a rien renvoyé/i)).toBeVisible();
      expect(screen.getByTestId("message-retry")).toBeVisible();
    },
    15_000,
  );
});
