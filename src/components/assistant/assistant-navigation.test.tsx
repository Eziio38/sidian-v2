import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/app/app-shell";
import { AppSidebar } from "@/components/app/app-sidebar";

const usePathname = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("@/app/actions/auth", () => ({
  signOutAction: vi.fn(),
}));

function stubMatchMedia(matchesLg: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    matches: matchesLg,
    media: "(min-width: 1024px)",
    addEventListener: (
      _event: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => {
      listeners.add(listener);
    },
    removeEventListener: (
      _event: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => {
      listeners.delete(listener);
    },
    addListener: (listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeListener: (listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
    setMatches(next: boolean) {
      media.matches = next;
      const event = { matches: next } as MediaQueryListEvent;
      for (const listener of listeners) listener(event);
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

describe("AppSidebar", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/app/assistant");
    stubMatchMedia(true);
  });

  afterEach(() => {
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
    document.body.style.touchAction = "";
  });

  it("affiche logo, nav métier light, état actif et profil", () => {
    render(
      <AppSidebar
        userDisplayName="Lucie Martin"
        userPlan="Early Access"
      />,
    );

    const sidebar = screen.getByTestId("assistant-sidebar");
    expect(sidebar).toHaveAttribute("data-sidebar", "light");
    expect(sidebar.querySelector('img[alt="Sidian"]')).not.toBeNull();
    expect(sidebar.textContent).toContain("Sidian");
    expect(sidebar.textContent).toContain("Dossiers");
    expect(sidebar.textContent).toContain("Paiements");
    expect(sidebar.textContent).toContain("Clients");
    expect(sidebar.textContent).not.toContain("Historique");
    expect(sidebar.textContent).not.toContain("Agent Sidian");
    expect(sidebar.textContent).not.toContain("Dashboard");
    expect(sidebar.textContent).toContain("Activité");
    expect(
      screen.getByTestId("app-navigation").textContent,
    ).not.toContain("Paramètres");

    expect(
      sidebar.querySelector('[aria-current="page"]')?.textContent,
    ).toContain("Sidian");
    expect(screen.getByTestId("assistant-sidebar-profile").textContent).toContain(
      "Lucie Martin",
    );
    expect(screen.getByTestId("assistant-sidebar-profile").textContent).toContain(
      "Early Access",
    );
  });

  it("garde la largeur compacte issue du Design System", () => {
    render(<AppSidebar userDisplayName="Lucie Martin" />);
    expect(
      screen.getByTestId("assistant-sidebar").parentElement,
    ).toHaveAttribute("data-sidebar-width", "compact");
  });
});

describe("AppShell mobile drawer", () => {
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
      <AppShell variant="workspace" userDisplayName="Lucie Martin">
        <div>contenu</div>
      </AppShell>,
    );

    expect(screen.getByTestId("assistant-shell")).toHaveAttribute(
      "data-mobile-nav",
      "closed",
    );
    await user.click(screen.getByTestId("assistant-mobile-nav"));
    expect(screen.getByTestId("assistant-shell")).toHaveAttribute(
      "data-mobile-nav",
      "open",
    );
    expect(screen.getByTestId("assistant-mobile-nav-overlay")).toBeInTheDocument();
    await user.click(screen.getByTestId("assistant-mobile-nav-close"));
    expect(screen.getByTestId("assistant-shell")).toHaveAttribute(
      "data-mobile-nav",
      "closed",
    );
  });

  it("piège le focus dans le drawer et restaure le focus à la fermeture", async () => {
    const user = userEvent.setup();
    render(
      <AppShell variant="workspace" userDisplayName="Lucie Martin">
        <button type="button">dans le main</button>
      </AppShell>,
    );

    await user.click(screen.getByTestId("assistant-mobile-nav"));
    expect(screen.getByTestId("assistant-mobile-nav-close")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("assistant-mobile-nav")).toHaveFocus();
  });

  it("referme le drawer au passage desktop sans le rouvrir au retour mobile", async () => {
    const user = userEvent.setup();
    const media = stubMatchMedia(false);
    render(
      <AppShell variant="workspace" userDisplayName="Lucie Martin">
        <div>contenu</div>
      </AppShell>,
    );

    await user.click(screen.getByTestId("assistant-mobile-nav"));
    expect(screen.getByTestId("assistant-shell")).toHaveAttribute(
      "data-mobile-nav",
      "open",
    );

    act(() => media.setMatches(true));
    expect(screen.getByTestId("assistant-shell")).toHaveAttribute(
      "data-mobile-nav",
      "closed",
    );

    act(() => media.setMatches(false));
    expect(screen.getByTestId("assistant-shell")).toHaveAttribute(
      "data-mobile-nav",
      "closed",
    );
  });

  it("bloque le contenu principal (pas de click-through) quand le drawer est ouvert", async () => {
    const user = userEvent.setup();
    render(
      <AppShell variant="workspace" userDisplayName="Lucie Martin">
        <a href="/app/assistant">lien main</a>
      </AppShell>,
    );

    await user.click(screen.getByTestId("assistant-mobile-nav"));
    expect(screen.getByTestId("assistant-main")).toHaveAttribute("inert", "");
    expect(
      screen.getByTestId("assistant-sidebar").querySelector('a[href="/app/assistant"]'),
    ).not.toBeNull();
  });

  it("utilise le shell App unifié (pas de sidebar sombre)", () => {
    render(
      <AppShell variant="workspace" userDisplayName="Lucie Martin">
        <div>ok</div>
      </AppShell>,
    );
    expect(screen.getByTestId("assistant-shell")).toHaveAttribute(
      "data-shell",
      "app",
    );
    expect(screen.getByTestId("assistant-shell")).toHaveAttribute(
      "data-appearance",
      "assistant-light",
    );
    expect(screen.getByTestId("assistant-sidebar")).toHaveAttribute(
      "data-sidebar",
      "light",
    );
  });
});
