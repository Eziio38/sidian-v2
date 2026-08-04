import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppNavigation } from "./app-navigation";
import { AppShell } from "./app-shell";
import { AppSidebar } from "./app-sidebar";
import { LEGACY_NAV_LABELS } from "./app-nav-config";

const usePathname = vi.fn(() => "/app/assistant");
const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
  useRouter: () => ({
    push: routerPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/actions/auth", () => ({
  signOutAction: vi.fn(),
}));

describe("Premium AI Workspace — AppShell unique", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/app/assistant");
    routerPush.mockReset();
    window.localStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("64rem") || query.includes("1024"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("nav unique : Accueil · Dossiers · Paiements · Clients · Activité", () => {
    render(<AppNavigation />);
    expect(screen.getByRole("link", { name: "Accueil" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Dossiers" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Paiements" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Clients" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Activité" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Paramètres" })).toBeNull();
  });

  it("n’expose plus les libellés hérités (Dashboard, Bien démarrer, etc.)", () => {
    render(<AppNavigation />);
    for (const label of LEGACY_NAV_LABELS) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it("AppShell page et workspace partagent la même sidebar claire", () => {
    const { unmount } = render(
      <AppShell variant="page" title="Clients" userDisplayName="Lucie Martin">
        <p>Contenu</p>
      </AppShell>,
    );
    expect(screen.getByTestId("assistant-sidebar")).toHaveAttribute(
      "data-sidebar",
      "light",
    );
    expect(
      screen.getByTestId("sidebar-new-conversation"),
    ).toBeVisible();
    unmount();

    render(
      <AppShell variant="workspace" userDisplayName="Lucie Martin">
        <p>Workspace</p>
      </AppShell>,
    );
    expect(screen.getByTestId("assistant-sidebar")).toHaveAttribute(
      "data-sidebar",
      "light",
    );
    expect(
      screen.getByTestId("sidebar-new-conversation"),
    ).toBeVisible();
  });

  it("sidebar : logo officiel, profil compact, largeur compacte 224px", async () => {
    const user = userEvent.setup();
    render(
      <AppSidebar
        userDisplayName="Lucie Martin"
        userEmail="lucie@atelier.fr"
        userPlan="Early Access"
      />,
    );
    const sidebar = screen.getByTestId("assistant-sidebar");
    expect(sidebar.querySelector('img[alt="Sidian"]')).not.toBeNull();
    const img = sidebar.querySelector('img[alt="Sidian"]') as HTMLImageElement;
    expect(img.getAttribute("src") ?? "").toMatch(/sidian-logo\.png/);
    expect(screen.getByTestId("assistant-sidebar-profile").textContent).toContain(
      "Lucie Martin",
    );
    expect(screen.getByTestId("assistant-sidebar-profile")).toHaveTextContent(
      "Early Access",
    );
    expect(screen.queryByText("Compte Sidian")).not.toBeInTheDocument();
    expect(sidebar.parentElement).toHaveAttribute(
      "data-sidebar-width",
      "compact",
    );
    expect(
      screen.getByTestId("sidebar-new-conversation"),
    ).toBeVisible();
    expect(
      sidebar.querySelector('[aria-label="Menu utilisateur"]'),
    ).toHaveAttribute("aria-hidden", "true");
    await user.click(screen.getByTestId("assistant-sidebar-profile"));
    const profileMenu = screen.getByLabelText("Menu utilisateur");
    expect(within(profileMenu).getByText("lucie@atelier.fr")).toBeVisible();
    expect(screen.getByText("Paramètres")).toBeVisible();
    expect(screen.getByText("Gérer mon abonnement")).toBeVisible();
    expect(screen.getByText("Se déconnecter")).toBeVisible();
    expect(screen.getByText("Paramètres").closest("a")?.querySelector("svg"))
      .not.toBeNull();
    expect(
      screen.getByText("Gérer mon abonnement").closest("a")?.querySelector("svg"),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Se déconnecter" })
        .querySelector("svg"),
    ).not.toBeNull();
  });

  it("conserve le masquage de Bien démarrer sans ajouter de carte Plan", async () => {
    const user = userEvent.setup();
    const props = {
      userDisplayName: "Lucie Martin",
      userEmail: "lucie@atelier.fr",
      userPlan: "Early Access",
      appearance: "agent-dark" as const,
      sidebarOnboardingFacts: {
        hasClient: false,
        hasImportedInvoice: false,
        hasDossier: false,
      },
    };
    const firstRender = render(<AppSidebar {...props} />);

    expect(await screen.findByTestId("sidebar-onboarding")).toHaveTextContent(
      "0 / 3",
    );
    expect(screen.getByText("Ajouter un premier client")).toBeVisible();
    expect(screen.getByText("Importer une première facture")).toBeVisible();
    expect(screen.getByText("Créer un premier dossier")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Masquer Bien démarrer" }));
    expect(screen.queryByTestId("sidebar-onboarding")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-plan")).not.toBeInTheDocument();
    expect(screen.getByTestId("assistant-sidebar-profile")).toHaveTextContent(
      "Early Access",
    );
    await user.click(screen.getByTestId("assistant-sidebar-profile"));
    expect(
      screen.getByRole("link", { name: "Gérer mon abonnement" }),
    ).toBeVisible();

    firstRender.unmount();
    render(<AppSidebar {...props} />);
    expect(screen.queryByTestId("sidebar-plan")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-onboarding")).not.toBeInTheDocument();
  });

  it("ouvre Paramètres avec ⌘ , hors des champs de saisie", () => {
    render(
      <>
        <AppSidebar userDisplayName="Lucie Martin" />
        <input aria-label="Champ de test" />
      </>,
    );

    fireEvent.keyDown(document, { key: ",", metaKey: true });
    expect(routerPush).toHaveBeenCalledWith("/app/parametres");

    routerPush.mockClear();
    fireEvent.keyDown(screen.getByLabelText("Champ de test"), {
      key: ",",
      metaKey: true,
    });
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("active Sidian uniquement lorsque la discussion est vide", () => {
    const { rerender } = render(
      <AppSidebar
        userDisplayName="Lucie Martin"
        appearance="agent-dark"
        activeConversationId={null}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Accueil" }),
    ).toHaveAttribute("aria-current", "page");

    rerender(
      <AppSidebar
        userDisplayName="Lucie Martin"
        appearance="agent-dark"
        activeConversationId="conversation-active"
        conversationHistory={[
          {
            id: "conversation-active",
            clientId: null,
            clientName: null,
            title: "Préparer le règlement Dupont",
            preview: null,
            updatedAt: new Date().toISOString(),
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Accueil" }),
    ).not.toHaveAttribute("aria-current");
    expect(
      screen.getByRole("button", { name: "Préparer le règlement Dupont" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("conserve le repli d’un projet pendant la navigation locale", async () => {
    const user = userEvent.setup();
    const props = {
      userDisplayName: "Lucie Martin",
      appearance: "agent-dark" as const,
      conversationProjects: [{ id: "proj-persist", name: "Projet persistant" }],
      conversationHistory: [
        {
          id: "conversation-persist",
          clientId: null,
          clientName: null,
          projectId: "proj-persist",
          projectName: "Projet persistant",
          title: "Discussion persistante",
          preview: null,
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    const firstRender = render(<AppSidebar {...props} />);

    await user.click(
      screen.getByTestId("assistant-project-toggle-proj-persist"),
    );
    expect(
      screen.getByTestId("assistant-project-toggle-proj-persist"),
    ).toHaveAttribute("aria-expanded", "false");

    firstRender.unmount();
    render(<AppSidebar {...props} />);
    expect(
      screen.getByTestId("assistant-project-toggle-proj-persist"),
    ).toHaveAttribute("aria-expanded", "false");

    await user.click(
      screen.getByTestId("assistant-project-toggle-proj-persist"),
    );
  });

  it("sidebar Agent : projets repliables avant les discussions", async () => {
    const user = userEvent.setup();
    const onNewConversation = vi.fn();
    const onSelectConversation = vi.fn();
    const onDeleteConversation = vi.fn();
    render(
      <AppSidebar
        userDisplayName="Lucie Martin"
        appearance="agent-dark"
        activeConversationId="22222222-2222-4222-8222-222222222222"
        onNewConversation={onNewConversation}
        onSelectConversation={onSelectConversation}
        onDeleteConversation={onDeleteConversation}
        conversationProjects={[{ id: "proj-1", name: "Michel" }]}
        conversationHistory={[
          {
            id: "22222222-2222-4222-8222-222222222222",
            clientId: "11111111-1111-4111-8111-111111111111",
            clientName: "Dupont Conseil",
            projectId: "proj-1",
            projectName: "Michel",
            title: "Sécuriser la facture de juillet",
            preview: "Quelle est l’échéance ?",
            updatedAt: new Date(Date.now() - 86_400_000).toISOString(),
          },
          {
            id: "33333333-3333-4333-8333-333333333333",
            clientId: null,
            clientName: null,
            title: "Voir les paiements",
            preview: null,
            updatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
          },
        ]}
      />,
    );

    await user.click(screen.getByTestId("sidebar-new-conversation"));
    expect(onNewConversation).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("link", { name: "Accueil" }));
    expect(onNewConversation).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Général")).not.toBeInTheDocument();
    expect(screen.queryByText("Aujourd’hui")).not.toBeInTheDocument();
    expect(screen.queryByText("Hier")).not.toBeInTheDocument();
    expect(screen.queryByText("Cette semaine")).not.toBeInTheDocument();
    expect(screen.queryByText("Plus anciennes")).not.toBeInTheDocument();
    expect(screen.getByText("Michel")).toBeVisible();
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((heading) =>
        heading.textContent,
      ),
    ).toEqual(["Projets", "Discussions"]);
    expect(screen.queryByText("Dupont Conseil")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Sécuriser la facture de juillet",
      }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByTestId(
        "assistant-conversation-22222222-2222-4222-8222-222222222222",
      ),
    ).toHaveAttribute("data-active", "true");
    expect(
      screen.getByRole("link", { name: "Accueil" }),
    ).not.toHaveAttribute("aria-current");

    const projectToggle = screen.getByTestId(
      "assistant-project-toggle-proj-1",
    );
    expect(projectToggle).toHaveAttribute("aria-expanded", "true");
    await user.click(projectToggle);
    expect(projectToggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", {
        name: "Sécuriser la facture de juillet",
      }),
    ).not.toBeInTheDocument();

    await user.click(projectToggle);
    expect(projectToggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", {
        name: "Sécuriser la facture de juillet",
      }),
    ).toBeVisible();

    screen
      .getByTestId(
        "assistant-conversation-delete-33333333-3333-4333-8333-333333333333",
      )
      .click();
    expect(onDeleteConversation).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333",
    );
  });

  it("marque Accueil actif sur /app/assistant", () => {
    usePathname.mockReturnValue("/app/assistant");
    render(<AppNavigation />);
    expect(
      screen.getByRole("link", { name: "Accueil" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("link", { name: "Activité" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("marque Dossiers actif sur /app/paiements-a-recevoir", () => {
    usePathname.mockReturnValue("/app/paiements-a-recevoir");
    render(<AppNavigation />);
    expect(
      screen.getByRole("link", { name: "Dossiers" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("expose un landmark principal dans les deux variantes", () => {
    const { unmount } = render(
      <AppShell variant="page" title="Clients">
        <p>Contenu page</p>
      </AppShell>,
    );
    expect(screen.getByRole("main")).toHaveAttribute("id", "contenu-principal");
    unmount();

    render(
      <AppShell variant="workspace">
        <p>Contenu workspace</p>
      </AppShell>,
    );
    const workspaceMain = screen.getByRole("main");
    expect(workspaceMain).toHaveAttribute("id", "contenu-principal");
    expect(workspaceMain).toHaveTextContent("Contenu workspace");
  });

  it("le lien d’évitement cible le landmark principal", () => {
    const { unmount } = render(
      <AppShell variant="page" title="Clients">
        <p>Contenu page</p>
      </AppShell>,
    );
    expect(
      screen.getByRole("link", { name: "Aller au contenu principal" }),
    ).toHaveAttribute("href", "#contenu-principal");
    unmount();

    render(
      <AppShell variant="workspace">
        <p>Contenu workspace</p>
      </AppShell>,
    );
    expect(
      screen.getByRole("link", { name: "Aller à l’espace de travail" }),
    ).toHaveAttribute("href", "#contenu-principal");
  });
});
