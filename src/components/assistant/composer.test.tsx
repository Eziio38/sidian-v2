import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  COMPOSER_MAX_LENGTH,
  Composer,
  DICTATION_ERROR_MESSAGE,
} from "./composer";

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
    expect(screen.getByTestId("composer-send")).toHaveAttribute(
      "data-ready",
      "false",
    );

    rerender(
      <Composer
        value="Message"
        onChange={() => undefined}
        onSubmit={() => undefined}
        isLoading
      />,
    );
    expect(screen.getByTestId("composer-send")).toBeDisabled();
    expect(screen.getByTestId("composer-send")).toHaveAttribute(
      "data-ready",
      "false",
    );
    expect(screen.getByTestId("composer")).toHaveAttribute(
      "data-loading",
      "true",
    );
    expect(screen.getByTestId("composer-input")).toBeDisabled();
  });

  it("remplace l’envoi par un bouton d’arrêt accessible pendant la génération", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    const { rerender } = render(
      <Composer
        value="Message déjà envoyé"
        onChange={() => undefined}
        onSubmit={() => undefined}
        onStop={onStop}
        isLoading
      />,
    );

    const stop = screen.getByRole("button", {
      name: "Arrêter la génération",
    });
    expect(stop).toBe(screen.getByTestId("composer-stop"));
    expect(stop).toHaveAttribute("type", "button");
    expect(stop).toBeEnabled();
    expect(screen.queryByTestId("composer-send")).not.toBeInTheDocument();
    expect(screen.getByTestId("composer-input")).toBeDisabled();

    stop.focus();
    await user.keyboard("{Enter}");
    expect(onStop).toHaveBeenCalledTimes(1);

    rerender(
      <Composer
        value="Message déjà envoyé"
        onChange={() => undefined}
        onSubmit={() => undefined}
        onStop={onStop}
        isLoading
        isStopping
      />,
    );

    expect(screen.getByTestId("composer-stop")).toBeDisabled();
    fireEvent.click(screen.getByTestId("composer-stop"));
    expect(onStop).toHaveBeenCalledTimes(1);
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

    fireEvent.input(screen.getByTestId("composer-input"), {
      target: { value: "hello world extra" },
    });
    expect(onChange).toHaveBeenCalledWith("hello wo");
  });

  it("accepte plusieurs fichiers et permet de les retirer", () => {
    const onAddFiles = vi.fn();
    const onRemoveFile = vi.fn();
    const invoice = new File(["facture"], "facture-juillet.pdf", {
      type: "application/pdf",
      lastModified: 1,
    });
    const capture = new File(["image"], "capture.png", {
      type: "image/png",
      lastModified: 2,
    });

    const { rerender } = render(
      <Composer
        value=""
        onChange={() => undefined}
        onSubmit={() => undefined}
        onAddFiles={onAddFiles}
      />,
    );

    fireEvent.change(screen.getByLabelText("Choisir des fichiers"), {
      target: { files: [invoice, capture] },
    });
    expect(onAddFiles).toHaveBeenCalledWith([invoice, capture]);

    rerender(
      <Composer
        value=""
        onChange={() => undefined}
        onSubmit={() => undefined}
        files={[invoice]}
        onRemoveFile={onRemoveFile}
      />,
    );
    expect(screen.getByText("facture-juillet.pdf")).toBeVisible();
    expect(screen.getByTestId("composer-send")).toBeEnabled();
    expect(screen.getByTestId("composer-send")).toHaveAttribute(
      "data-ready",
      "true",
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Afficher l’aperçu de facture-juillet.pdf",
      }),
    );
    expect(screen.getByTestId("attachment-preview-dialog")).toBeVisible();
    expect(screen.getByTestId("pdf-document-preview")).toBeVisible();
    expect(
      screen.queryByTitle("Aperçu de facture-juillet.pdf"),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByTestId("attachment-preview-dialog"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retirer facture-juillet.pdf" }));
    expect(onRemoveFile).toHaveBeenCalledWith(invoice);
  });

  it("libère chaque URL blob de vignette au remplacement et au démontage", () => {
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:premiere")
      .mockReturnValueOnce("blob:seconde");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const first = new File(["1"], "premiere.png", {
      type: "image/png",
      lastModified: 1,
    });
    const second = new File(["2"], "seconde.png", {
      type: "image/png",
      lastModified: 2,
    });

    const view = render(
      <Composer
        value=""
        onChange={() => undefined}
        onSubmit={() => undefined}
        files={[first]}
      />,
    );
    expect(createObjectURL).toHaveBeenCalledWith(first);

    view.rerender(
      <Composer
        value=""
        onChange={() => undefined}
        onSubmit={() => undefined}
        files={[second]}
      />,
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:premiere");
    expect(createObjectURL).toHaveBeenCalledWith(second);

    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:seconde");
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it("affiche un overlay global pendant un dépôt de fichiers", () => {
    const invoice = new File(["facture"], "facture-juillet.pdf", {
      type: "application/pdf",
      lastModified: 4,
    });
    const onAddFiles = vi.fn();
    const dataTransfer = {
      types: ["Files"],
      files: [invoice],
      dropEffect: "none",
    };

    render(
      <Composer
        value=""
        onChange={() => undefined}
        onSubmit={() => undefined}
        onAddFiles={onAddFiles}
      />,
    );

    fireEvent.dragEnter(window, { dataTransfer });
    expect(screen.getByTestId("composer-drop-overlay")).toHaveTextContent(
      "Déposez vos documents ici",
    );
    fireEvent.drop(window, { dataTransfer });
    expect(onAddFiles).toHaveBeenCalledWith([invoice]);
    expect(
      screen.queryByTestId("composer-drop-overlay"),
    ).not.toBeInTheDocument();
  });

  it("récupère une capture collée dans le textarea", () => {
    const onAddFiles = vi.fn();
    const capture = new File(["image"], "capture-collee.png", {
      type: "image/png",
      lastModified: 3,
    });

    render(
      <Composer
        value=""
        onChange={() => undefined}
        onSubmit={() => undefined}
        onAddFiles={onAddFiles}
      />,
    );

    fireEvent.paste(screen.getByTestId("composer-input"), {
      clipboardData: { files: [capture] },
    });
    expect(onAddFiles).toHaveBeenCalledWith([capture]);
  });

  it("signale la limite quand plus de 6 fichiers sont sélectionnés", () => {
    const onAddFiles = vi.fn();
    const onFileLimitReached = vi.fn();
    const files = Array.from({ length: 7 }, (_, index) =>
      new File([`doc-${index}`], `doc-${index}.pdf`, {
        type: "application/pdf",
        lastModified: index + 1,
      }),
    );

    render(
      <Composer
        value=""
        onChange={() => undefined}
        onSubmit={() => undefined}
        onAddFiles={onAddFiles}
        onFileLimitReached={onFileLimitReached}
      />,
    );

    fireEvent.change(screen.getByLabelText("Choisir des fichiers"), {
      target: { files },
    });

    expect(onAddFiles).toHaveBeenCalledTimes(1);
    expect(onAddFiles.mock.calls[0]?.[0]).toHaveLength(6);
    expect(onFileLimitReached).toHaveBeenCalledWith(6, 7);
  });

  it("n’envoie pas pendant une composition clavier", () => {
    const onSubmit = vi.fn();

    render(
      <Composer value="Écheance" onChange={() => undefined} onSubmit={onSubmit} />,
    );

    const input = screen.getByTestId("composer-input");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("annule le mode modification avec Échap", () => {
    const onCancelEdit = vi.fn();

    render(
      <Composer
        value="Message à corriger"
        onChange={() => undefined}
        onSubmit={() => undefined}
        editing
        onCancelEdit={onCancelEdit}
      />,
    );

    fireEvent.keyDown(screen.getByTestId("composer-input"), { key: "Escape" });
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it("explique l’échec de la dictée au lieu de rester muet", () => {
    const start = vi.fn(() => {
      throw new Error("not-allowed");
    });
    class FailingRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onresult = null;
      onerror = null;
      onend = null;
      start = start;
      stop = vi.fn();
    }
    vi.stubGlobal("SpeechRecognition", FailingRecognition);

    try {
      render(
        <Composer value="" onChange={() => undefined} onSubmit={() => undefined} />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Dicter une demande" }));

      expect(start).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("composer-error")).toHaveTextContent(
        DICTATION_ERROR_MESSAGE,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("arrête une dictée active au démontage", () => {
    const stop = vi.fn();
    class Recognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onresult = null;
      onerror = null;
      onend = null;
      start = vi.fn();
      stop = stop;
    }
    vi.stubGlobal("SpeechRecognition", Recognition);

    try {
      const view = render(
        <Composer value="" onChange={() => undefined} onSubmit={() => undefined} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Dicter une demande" }));
      view.unmount();
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
