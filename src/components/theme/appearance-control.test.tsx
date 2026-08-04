import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppearanceControl } from "./appearance-control";
import { ThemeProvider } from "./theme-provider";

type MediaListener = (event: { matches: boolean }) => void;

let systemPrefersDark = false;
let listeners: MediaListener[] = [];

function installMatchMedia() {
  listeners = [];
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("dark") ? systemPrefersDark : false,
      media: query,
      addEventListener: (_: string, listener: MediaListener) => {
        listeners.push(listener);
      },
      removeEventListener: (_: string, listener: MediaListener) => {
        listeners = listeners.filter((l) => l !== listener);
      },
    }),
  });
}

/** Simule un changement du thème système pendant que la page est ouverte. */
function emitSystemChange(matches: boolean) {
  // `act` : la notification vient d'un système externe, React doit vider sa
  // file de rendu et ses effets avant que l'on observe le DOM.
  act(() => {
    systemPrefersDark = matches;
    for (const listener of [...listeners]) listener({ matches });
  });
}

beforeEach(() => {
  systemPrefersDark = false;
  installMatchMedia();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-preference");
  document.cookie = "sidian-theme=; Path=/; Max-Age=0";
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderControl(
  initial: "light" | "dark" | "system" = "light",
  onPersist?: (p: string) => void,
) {
  return render(
    <ThemeProvider initialPreference={initial} onPersist={onPersist}>
      <AppearanceControl />
    </ThemeProvider>,
  );
}

describe("AppearanceControl", () => {
  it("propose trois options exclusives, pas un interrupteur binaire", () => {
    renderControl();
    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(3);
    expect(screen.getByRole("radio", { name: /Clair/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Sombre/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Automatique/ })).not.toBeChecked();
  });

  it("applique le thème au document dès le clic, sans attendre le serveur", async () => {
    const user = userEvent.setup();
    renderControl();

    await user.click(screen.getByRole("radio", { name: /Sombre/ }));

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement).toHaveAttribute(
      "data-theme-preference",
      "dark",
    );
  });

  it("persiste la préférence sur le compte et dans le cookie de repli", async () => {
    const user = userEvent.setup();
    const onPersist = vi.fn();
    renderControl("light", onPersist);

    await user.click(screen.getByRole("radio", { name: /Sombre/ }));

    expect(onPersist).toHaveBeenCalledWith("dark");
    expect(document.cookie).toContain("sidian-theme=dark");
  });

  it("« Automatique » suit le réglage système, y compris s’il change en direct", async () => {
    const user = userEvent.setup();
    systemPrefersDark = true;
    renderControl();

    await user.click(screen.getByRole("radio", { name: /Automatique/ }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(screen.getByText(/mode sombre/i)).toBeInTheDocument();

    // Le système repasse en clair pendant que la page est ouverte.
    emitSystemChange(false);
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(screen.getByText(/mode clair/i)).toBeInTheDocument();
  });

  it("un choix explicite n’est jamais écrasé par le réglage système", async () => {
    const user = userEvent.setup();
    renderControl();

    await user.click(screen.getByRole("radio", { name: /Clair/ }));
    emitSystemChange(true);

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("un échec de persistance ne remet jamais l’apparence en arrière", async () => {
    const user = userEvent.setup();
    const onPersist = vi.fn().mockRejectedValue(new Error("réseau"));
    renderControl("light", onPersist);

    await user.click(screen.getByRole("radio", { name: /Sombre/ }));

    // Un choix d'affichage ne doit pas clignoter parce que le réseau a échoué.
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("radio", { name: /Sombre/ })).toBeChecked();
  });

  it("reprend la préférence du compte qui vient de se connecter", () => {
    const { rerender } = render(
      <ThemeProvider initialPreference="light">
        <AppearanceControl />
      </ThemeProvider>,
    );
    expect(screen.getByRole("radio", { name: /Clair/ })).toBeChecked();

    // Nouvelle session : le serveur renvoie la préférence de l'autre compte.
    rerender(
      <ThemeProvider initialPreference="dark">
        <AppearanceControl />
      </ThemeProvider>,
    );

    expect(screen.getByRole("radio", { name: /Sombre/ })).toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });
});
