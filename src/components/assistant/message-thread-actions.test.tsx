import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MessageThread } from "./message-thread";
import type { AssistantMessage } from "./types";

const errorMessage: AssistantMessage = {
  id: "assistant-error",
  role: "assistant",
  content: "Je n’ai pas pu analyser ta demande.",
  status: "error",
  errorMessage: "Tes informations sont conservées.",
  retryContent: "Protéger la facture Dupont",
  retryable: true,
};

const assistantMessage: AssistantMessage = {
  id: "assistant-answer",
  role: "assistant",
  content: "Le règlement Dupont est attendu vendredi.",
  status: "sent",
};

describe("MessageThread actions", () => {
  it("affiche la barre légère sur une réponse assistant terminée", () => {
    render(<MessageThread messages={[assistantMessage]} />);

    const article = screen.getByTestId("message-assistant-assistant-answer");
    const actions = within(article).getByTestId(
      "message-hover-actions-assistant-answer",
    );

    expect(actions).toBeInTheDocument();
    expect(
      within(actions).getByRole("button", { name: "Copier" }),
    ).toBeVisible();
    expect(
      within(actions).getByRole("button", { name: "Utile" }),
    ).toBeVisible();
    expect(
      within(actions).getByRole("button", { name: "Pas utile" }),
    ).toBeVisible();
    expect(
      within(actions).queryByRole("button", { name: "Modifier" }),
    ).not.toBeInTheDocument();
  });

  it("conserve la barre d’actions des messages utilisateur", () => {
    const userMessage: AssistantMessage = {
      id: "user-question",
      role: "user",
      content: "Quand arrive le règlement ?",
      status: "sent",
    };

    render(<MessageThread messages={[userMessage, assistantMessage]} />);

    expect(
      within(screen.getByTestId("message-user-user-question")).getByTestId(
        "message-hover-actions-user-question",
      ),
    ).toBeInTheDocument();
  });

  it("garde le feedback dans le fil local ciblé, sans toucher un autre utilisateur", async () => {
    const user = userEvent.setup();
    const onFeedbackA = vi.fn();
    const onFeedbackB = vi.fn();
    const messageA = { ...assistantMessage, id: "assistant-user-a" };
    const messageB = { ...assistantMessage, id: "assistant-user-b" };

    render(
      <>
        <section aria-label="Espace utilisateur A">
          <MessageThread
            messages={[messageA]}
            onMessageFeedback={onFeedbackA}
          />
        </section>
        <section aria-label="Espace utilisateur B">
          <MessageThread
            messages={[messageB]}
            onMessageFeedback={onFeedbackB}
          />
        </section>
      </>,
    );

    await user.click(
      within(screen.getByRole("region", { name: "Espace utilisateur A" }))
        .getByRole("button", { name: "Utile" }),
    );

    expect(onFeedbackA).toHaveBeenCalledWith(
      "assistant-user-a",
      "like",
      "",
    );
    expect(onFeedbackB).not.toHaveBeenCalled();
  });

  it("ne rend aucune barre pendant une réponse streaming ou pending", () => {
    const streaming: AssistantMessage = {
      ...assistantMessage,
      id: "assistant-streaming",
      status: "streaming",
    };
    const pending: AssistantMessage = {
      ...assistantMessage,
      id: "assistant-pending",
      status: "pending",
    };

    render(<MessageThread messages={[streaming, pending]} />);

    expect(
      screen.queryByTestId("message-hover-actions-assistant-streaming"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("message-hover-actions-assistant-pending"),
    ).not.toBeInTheDocument();
  });

  it("relaie Réessayer depuis la barre hover lorsque la relance est réelle", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();

    render(<MessageThread messages={[errorMessage]} onAction={onAction} />);

    const retry = screen.getByTestId("message-retry");
    retry.focus();
    await user.keyboard("{Enter}");

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "retry" }),
      errorMessage,
    );
    expect(screen.queryByTestId("message-actions")).not.toBeInTheDocument();
  });

  it("masque Réessayer sans capacité réelle ou sans callback", () => {
    const nonRetryable: AssistantMessage = {
      ...errorMessage,
      id: "assistant-non-retryable",
      retryable: false,
    };

    const { rerender } = render(
      <MessageThread messages={[nonRetryable]} onAction={vi.fn()} />,
    );

    expect(
      screen.queryByTestId("message-retry"),
    ).not.toBeInTheDocument();

    rerender(<MessageThread messages={[errorMessage]} />);
    expect(
      screen.queryByTestId("message-retry"),
    ).not.toBeInTheDocument();
  });

  it("bloque Réessayer pendant une génération en cours", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();

    render(
      <MessageThread messages={[errorMessage]} busy onAction={onAction} />,
    );

    const retry = screen.getByTestId("message-retry");
    expect(retry).toBeDisabled();

    await user.click(retry);
    expect(onAction).not.toHaveBeenCalled();
    expect(
      screen.getByText("Je n’ai pas pu analyser ta demande."),
    ).toBeVisible();
  });

  it("garde les actions métier existantes séparées de la barre de message", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const message: AssistantMessage = {
      ...assistantMessage,
      actions: [
        {
          id: "open-protection",
          label: "Ouvrir le dossier",
          kind: "open_protection",
          href: "/app/dossiers/dossier-1",
        },
      ],
    };

    render(<MessageThread messages={[message]} onAction={onAction} />);

    await user.click(
      screen.getByTestId("message-action-open-protection"),
    );

    expect(onAction).toHaveBeenCalledWith(message.actions?.[0], message);
    expect(
      screen.getByTestId("message-hover-actions-assistant-answer"),
    ).toBeInTheDocument();
  });

  it("reste contenu dans le message à largeur mobile et accessible par Tab", async () => {
    const user = userEvent.setup();

    render(
      <div style={{ width: 320, maxWidth: "100%" }}>
        <MessageThread messages={[assistantMessage]} />
      </div>,
    );

    const article = screen.getByTestId("message-assistant-assistant-answer");
    const actions = within(article).getByTestId(
      "message-hover-actions-assistant-answer",
    );

    await user.tab();
    expect(
      within(actions).getByRole("button", { name: "Utile" }),
    ).toHaveFocus();
    expect(article).toContainElement(actions);
  });
});
