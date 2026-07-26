import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COMPOSER_MAX_LENGTH, Composer } from "./composer";

describe("Composer", () => {
  it("envoie avec Entrée et garde Shift+Entrée pour une nouvelle ligne", () => {
    const onSubmit = vi.fn();

    render(
      <Composer
        value="Bonjour"
        onChange={() => undefined}
        onSubmit={onSubmit}
      />,
    );

    const input = screen.getByTestId("composer-input");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);

    onSubmit.mockClear();
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("désactive l’envoi à vide et en loading", () => {
    const { rerender } = render(
      <Composer
        value="   "
        onChange={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    expect(screen.getByTestId("composer-send")).toBeDisabled();

    rerender(
      <Composer
        value="Message"
        onChange={() => undefined}
        onSubmit={() => undefined}
        isLoading
      />,
    );
    expect(screen.getByTestId("composer-send")).toBeDisabled();
    expect(screen.getByTestId("composer")).toHaveAttribute(
      "data-loading",
      "true",
    );
    expect(screen.getByTestId("composer-input")).toBeDisabled();
  });

  it("affiche l’erreur inline et le compteur près de la limite", () => {
    const nearLimit = "a".repeat(Math.floor(COMPOSER_MAX_LENGTH * 0.9));

    render(
      <Composer
        value={nearLimit}
        onChange={() => undefined}
        onSubmit={() => undefined}
        error="Impossible d’envoyer. Réessaie."
      />,
    );

    expect(screen.getByTestId("composer-error")).toHaveTextContent(
      "Impossible d’envoyer. Réessaie.",
    );
    expect(screen.getByTestId("composer-char-count")).toHaveTextContent(
      `${nearLimit.length}/${COMPOSER_MAX_LENGTH}`,
    );
  });

  it("borne la saisie à maxLength", () => {
    const onChange = vi.fn();

    render(
      <Composer
        value="hello"
        onChange={onChange}
        onSubmit={() => undefined}
        maxLength={8}
      />,
    );

    fireEvent.change(screen.getByTestId("composer-input"), {
      target: { value: "hello world extra" },
    });
    expect(onChange).toHaveBeenCalledWith("hello wo");
  });
});
