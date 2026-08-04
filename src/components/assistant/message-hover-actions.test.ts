import { createElement } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MessageHoverActions,
  resolvePanelPlacement,
} from "./message-hover-actions";

function mockRect(
  el: HTMLElement,
  rect: Pick<DOMRect, "top" | "bottom" | "left" | "right" | "height" | "width">,
) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    x: rect.left,
    y: rect.top,
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    width: rect.width,
    height: rect.height,
    toJSON: () => ({}),
  } as DOMRect);
}

describe("resolvePanelPlacement", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("ouvre au-dessus quand le composer bloque le bas", () => {
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    Object.defineProperty(scroller, "scrollHeight", { value: 800 });
    Object.defineProperty(scroller, "clientHeight", { value: 600 });

    const anchor = document.createElement("div");
    const composer = document.createElement("div");
    composer.setAttribute("data-testid", "assistant-composer-dock");

    scroller.appendChild(anchor);
    document.body.append(scroller, composer);

    mockRect(scroller, {
      top: 80,
      bottom: 700,
      left: 0,
      right: 800,
      width: 800,
      height: 620,
    });
    mockRect(anchor, {
      top: 620,
      bottom: 652,
      left: 600,
      right: 720,
      width: 120,
      height: 32,
    });
    mockRect(composer, {
      top: 700,
      bottom: 860,
      left: 0,
      right: 800,
      width: 800,
      height: 160,
    });

    vi.spyOn(window, "innerHeight", "get").mockReturnValue(900);

    expect(resolvePanelPlacement(anchor, 260)).toBe("above");
  });

  it("ouvre en dessous quand il y a de la place sous l’ancre", () => {
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    const anchor = document.createElement("div");
    scroller.appendChild(anchor);
    document.body.appendChild(scroller);

    mockRect(scroller, {
      top: 80,
      bottom: 800,
      left: 0,
      right: 800,
      width: 800,
      height: 720,
    });
    mockRect(anchor, {
      top: 120,
      bottom: 152,
      left: 600,
      right: 720,
      width: 120,
      height: 32,
    });

    vi.spyOn(window, "innerHeight", "get").mockReturnValue(900);

    expect(resolvePanelPlacement(anchor, 260)).toBe("below");
  });
});

describe("MessageHoverActions", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("annonce un échec réel du presse-papiers", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) },
    });

    render(
      createElement(MessageHoverActions, {
        messageId: "message-1",
        content: "Contenu utile",
      }),
    );

    fireEvent.click(screen.getByTestId("message-copy-message-1"));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "La copie a échoué.",
      );
    });
  });

  it("copie une réponse assistant et annonce la réussite", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      createElement(MessageHoverActions, {
        messageId: "message-copy-success",
        content: "  Contenu utile  ",
      }),
    );

    fireEvent.click(screen.getByTestId("message-copy-message-copy-success"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("Contenu utile");
      expect(screen.getByRole("status")).toHaveTextContent("Contenu copié.");
    });
  });

  it("nettoie le timer de confirmation du presse-papiers au démontage", async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

    const { unmount } = render(
      createElement(MessageHoverActions, {
        messageId: "message-copy-cleanup",
        content: "Contenu utile",
      }),
    );

    await act(async () => {
      screen.getByTestId("message-copy-message-copy-cleanup").click();
      await Promise.resolve();
    });
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("ajoute immédiatement un feedback positif", () => {
    const onFeedback = vi.fn();

    render(
      createElement(MessageHoverActions, {
        messageId: "message-like",
        content: "Réponse",
        onFeedback,
      }),
    );

    const like = screen.getByTestId("message-like-message-like");
    expect(like).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(like);

    expect(onFeedback).toHaveBeenCalledTimes(1);
    expect(onFeedback).toHaveBeenCalledWith("like", "");
    expect(
      screen.queryByTestId("message-feedback-panel-message-like"),
    ).not.toBeInTheDocument();
  });

  it("retire le feedback actif et supprime son commentaire", () => {
    const onFeedback = vi.fn();

    render(
      createElement(MessageHoverActions, {
        messageId: "message-remove",
        content: "Réponse",
        feedback: "like",
        feedbackComment: "Réponse claire.",
        onFeedback,
      }),
    );

    const like = screen.getByTestId("message-like-message-remove");
    expect(like).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("message-dislike-message-remove")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(like);

    expect(onFeedback).toHaveBeenCalledTimes(1);
    expect(onFeedback).toHaveBeenCalledWith(null, "");
    expect(
      screen.queryByTestId("message-feedback-panel-message-remove"),
    ).not.toBeInTheDocument();
  });

  it("conserve le commentaire lors d’un changement immédiat de polarité", () => {
    const onFeedback = vi.fn();

    render(
      createElement(MessageHoverActions, {
        messageId: "message-switch",
        content: "Réponse",
        feedback: "like",
        feedbackComment: "Il manque le montant.",
        onFeedback,
      }),
    );

    fireEvent.click(screen.getByTestId("message-dislike-message-switch"));

    expect(onFeedback).toHaveBeenCalledWith("dislike", "Il manque le montant.");
    expect(
      screen.queryByTestId("message-feedback-panel-message-switch"),
    ).not.toBeInTheDocument();
  });

  it("propose d’ajouter un commentaire après la sélection", () => {
    render(
      createElement(MessageHoverActions, {
        messageId: "message-add-comment",
        content: "Réponse",
        feedback: "like",
        onFeedback: vi.fn(),
      }),
    );

    expect(
      screen.getByTestId("message-feedback-comment-message-add-comment"),
    ).toHaveAccessibleName("Ajouter un commentaire");
  });

  it("modifie le commentaire via une action distincte", () => {
    const onFeedback = vi.fn();

    render(
      createElement(MessageHoverActions, {
        messageId: "message-comment",
        content: "Réponse",
        feedback: "dislike",
        feedbackComment: "Il manque le montant.",
        onFeedback,
      }),
    );

    const commentAction = screen.getByTestId(
      "message-feedback-comment-message-comment",
    );
    expect(commentAction).toHaveAccessibleName("Modifier le commentaire");

    fireEvent.click(commentAction);
    const input = screen.getByTestId(
      "message-feedback-input-message-comment",
    );
    expect(input).toHaveValue("Il manque le montant.");
    fireEvent.change(input, {
      target: { value: "Il manque encore le montant exact." },
    });
    fireEvent.click(
      screen.getByTestId("message-feedback-submit-message-comment"),
    );

    expect(onFeedback).toHaveBeenCalledWith(
      "dislike",
      "Il manque encore le montant exact.",
    );
  });

  it("empêche un double choix local du feedback", () => {
    const onFeedback = vi.fn();

    render(
      createElement(MessageHoverActions, {
        messageId: "message-double-feedback",
        content: "Réponse",
        onFeedback,
      }),
    );

    const like = screen.getByTestId(
      "message-like-message-double-feedback",
    );

    act(() => {
      like.click();
      like.click();
    });

    expect(onFeedback).toHaveBeenCalledTimes(1);
  });

  it("empêche une double soumission locale du commentaire", () => {
    const onFeedback = vi.fn();

    render(
      createElement(MessageHoverActions, {
        messageId: "message-double-comment",
        content: "Réponse",
        feedback: "like",
        onFeedback,
      }),
    );

    fireEvent.click(
      screen.getByTestId("message-feedback-comment-message-double-comment"),
    );
    const submit = screen.getByTestId(
      "message-feedback-submit-message-double-comment",
    );

    act(() => {
      submit.click();
      submit.click();
    });

    expect(onFeedback).toHaveBeenCalledTimes(1);
  });

  it("n’affiche Réessayer que lorsque la relance existe et la bloque si occupé", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      createElement(MessageHoverActions, {
        messageId: "message-retry",
        content: "Réponse",
      }),
    );

    expect(
      screen.queryByTestId("message-retry"),
    ).not.toBeInTheDocument();

    rerender(
      createElement(MessageHoverActions, {
        messageId: "message-retry",
        content: "Réponse",
        canRetry: true,
        onRetry,
        busy: true,
      }),
    );
    expect(screen.getByTestId("message-retry")).toBeDisabled();

    rerender(
      createElement(MessageHoverActions, {
        messageId: "message-retry",
        content: "Réponse",
        canRetry: true,
        onRetry,
      }),
    );
    const retry = screen.getByTestId("message-retry");

    act(() => {
      retry.click();
      retry.click();
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
