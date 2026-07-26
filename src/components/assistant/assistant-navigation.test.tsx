import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantShell } from "./assistant-shell";
import { AssistantSidebar } from "./assistant-sidebar";

const usePathname = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
}));

function stubMatchMedia(matchesLg: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: matchesLg,
    media: "(min-width: 1024px)",
    addEventListener: (_event: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_event: string, listener: () => void) => {
      listeners.delete(listener);
    },
    addListener: (listener: () => void) => {
      listeners.add(listener);
    },
    removeListener: (listener: () => void) => {
      listeners.delete(listener);
    },
  };

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      media.media = query;
      return media;
    },
  });

  return media;
}

describe("AssistantSidebar", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/app/assistant");
    stubMatchMedia(true);
  });

  afterEach(() => {
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
    document.body.style.touchAction = "";
  });

  it("affiche logo, nav métier, état actif et profil", () => {
    render(<AssistantSidebar userDisplayName="Lucie Martin" />);

    const sidebar = screen.getByTestId("assistant-sidebar");
    expect(sidebar.textContent).toContain("Sidian");
    expect(sidebar.textContent).toContain("Assistant");
    expect(sidebar.textContent).toContain("Paiements à recevoir");
    expect(sidebar.textContent).toContain("Clients");
    expect(sidebar.textContent).not.toContain("Historique");
    expect(sidebar.textContent).toContain("Activité");
    expect(sidebar.textContent).toContain("Paramètres");

    expect(
      sidebar.querySelector('[aria-current="page"]')?.textContent,
    ).toContain("Assistant");
    expect(screen.getByTestId("assistant-sidebar-profile").textContent).toContain(
      "Lucie Martin",
    );
    expect(screen.getByTestId("assistant-sidebar-profile").textContent).toContain(
      "Profil",
    );
  });

  it("garde une largeur stable via le wrapper w-56", () => {
    const { container } = render(
      <AssistantSidebar userDisplayName="Lucie Martin" />,
    );
    expect(container.querySelector(".w-56")).not.toBeNull();
  });
});

describe("AssistantShell mobile drawer", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/app/assistant");
    stubMatchMedia(false);
  });

  afterEach(() => {
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
    document.body.style.touchAction = "";
  });

  it("ouvre avec hamburger, ferme avec chevron, overlay et Escape", async () => {
    const user = userEvent.setup();

    render(
      <AssistantShell userDisplayName="Lucie Martin">
        <button type="button">Contenu</button>
      </AssistantShell>,
    );

    const openButton = screen.getByTestId("assistant-mobile-nav");
    expect(openButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("assistant-mobile-nav-overlay")).toBeNull();

    await user.click(openButton);

    expect(screen.getByTestId("assistant-shell")).toHaveAttribute(
      "data-mobile-nav",
      "open",
    );
    expect(openButton).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByTestId("assistant-mobile-nav-overlay"),
    ).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");

    const closeButton = screen.getByTestId("assistant-mobile-nav-close");
    expect(closeButton).toHaveAttribute("aria-label", "Replier la navigation");
    expect(closeButton).toHaveFocus();

    await user.click(screen.getByTestId("assistant-mobile-nav-overlay"));
    expect(screen.getByTestId("assistant-shell")).toHaveAttribute(
      "data-mobile-nav",
      "closed",
    );
    expect(openButton).toHaveFocus();
    expect(document.body.style.overflow).toBe("");

    await user.click(openButton);
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("assistant-shell")).toHaveAttribute(
      "data-mobile-nav",
      "closed",
    );
    expect(openButton).toHaveFocus();
  });

  it("piège le focus dans le drawer et restaure le focus à la fermeture", async () => {
    const user = userEvent.setup();

    render(
      <AssistantShell userDisplayName="Lucie Martin">
        <button type="button">Contenu</button>
      </AssistantShell>,
    );

    const openButton = screen.getByTestId("assistant-mobile-nav");
    await user.click(openButton);

    const closeButton = screen.getByTestId("assistant-mobile-nav-close");
    expect(closeButton).toHaveFocus();

    await user.tab();
    expect(
      screen.getByTestId("assistant-sidebar").querySelector('a[href="/app/assistant"]'),
    ).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(openButton).toHaveFocus();
  });

  it("bloque le contenu principal (pas de click-through) quand le drawer est ouvert", async () => {
    const user = userEvent.setup();
    const onContentClick = vi.fn();

    render(
      <AssistantShell userDisplayName="Lucie Martin">
        <button type="button" onClick={onContentClick}>
          Contenu
        </button>
      </AssistantShell>,
    );

    await user.click(screen.getByTestId("assistant-mobile-nav"));

    const main = screen.getByTestId("assistant-main");
    expect(main).toHaveAttribute("aria-hidden", "true");
    expect(main).toHaveAttribute("inert");

    expect(
      screen.queryByRole("button", { name: "Contenu" }),
    ).not.toBeInTheDocument();
    expect(onContentClick).not.toHaveBeenCalled();
  });
});
