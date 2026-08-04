import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConversationalWorkspace } from "./conversational-workspace";
import { BrandLockup } from "@/components/brand/brand-lockup";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { AuthPage } from "@/components/auth/auth-page";
import { WELCOME_COMPOSER_PLACEHOLDER } from "./composer";
import Link from "next/link";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/assistant",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("@/app/actions/auth", () => ({
  signOutAction: vi.fn(),
  signUpAction: vi.fn(),
  signInAction: vi.fn(),
}));

vi.mock("@/app/actions/clients-creances", () => ({
  createClientPayeurAction: vi.fn(async () => ({ ok: true })),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: () => [{ ok: true }, vi.fn()],
  };
});

describe("Assistant visual redesign gates", () => {
  it("atelier sombre premium sur l’espace Aujourd’hui", () => {
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="A"
        viewport="desktop"
      />,
    );

    expect(screen.getByTestId("assistant-shell")).toHaveAttribute(
      "data-appearance",
      "agent-dark",
    );
    expect(screen.getByTestId("conversational-workspace")).toHaveAttribute(
      "data-appearance",
      "agent-dark",
    );
    expect(screen.getByTestId("assistant-sidebar")).toHaveAttribute(
      "data-sidebar",
      "dark",
    );
    expect(screen.getByTestId("composer-input")).toHaveAttribute(
      "placeholder",
      WELCOME_COMPOSER_PLACEHOLDER,
    );
    expect(WELCOME_COMPOSER_PLACEHOLDER).toBe(
      "Dites-moi ce que vous voulez sécuriser, suivre ou préparer…",
    );
    expect(screen.getByTestId("welcome-greeting")).toHaveTextContent(
      "Bonjour Lucie",
    );
    expect(screen.getByTestId("welcome-greeting").textContent).not.toMatch(
      /voici|quoi de neuf/i,
    );
    expect(screen.getByTestId("welcome-eyebrow")).toHaveTextContent(
      "Votre agent IA",
    );
  });

  it("accueil : situation claire, composer lumineux, actions métier", () => {
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="A"
        viewport="desktop"
        welcomeDataState="due_calm"
        welcomeBriefCards={[
          {
            id: "expected",
            label: "Cette semaine",
            value: "3 650 €",
            hint: "3 paiements suivis",
          },
          {
            id: "active",
            label: "À traiter",
            value: "Rien",
          },
          {
            id: "next",
            label: "Prochain",
            value: "Dupont Conseil",
            hint: "2 450 €",
          },
        ]}
      />,
    );

    const welcome = screen.getByTestId("welcome-state");
    expect(welcome).toHaveAttribute("data-welcome-state", "due_calm");
    expect(screen.getByTestId("welcome-attention-line")).toHaveTextContent(
      "Tout est sous contrôle.",
    );
    expect(screen.getByTestId("welcome-greeting")).toHaveTextContent(
      "Bonjour Lucie",
    );
    expect(screen.queryByTestId("welcome-ask-line")).not.toBeInTheDocument();
    expect(screen.queryByText(/Votre agent est prêt/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("welcome-sidian-message")).toBeVisible();
    expect(screen.queryByTestId("welcome-brief-cards")).not.toBeInTheDocument();
    expect(screen.getByTestId("welcome-situation-detail")).toHaveTextContent(
      /3 paiements seront suivis cette semaine/,
    );
    expect(screen.getByTestId("composer-shortcuts")).toHaveAttribute(
      "data-variant",
      "welcome",
    );
    expect(
      screen.getByTestId("composer-shortcut-create-protection"),
    ).toHaveTextContent("Protéger une facture");
    expect(screen.getByTestId("composer-shortcut-add-invoice")).toHaveTextContent(
      "Analyser un document",
    );
    expect(screen.getByTestId("composer-shortcut-create-client")).toHaveTextContent(
      "Ajouter un client",
    );
    expect(
      screen.getByTestId("composer-shortcut-view-expected"),
    ).toHaveTextContent("Faire le point sur mes paiements");
    expect(
      screen.getByTestId("composer").compareDocumentPosition(
        screen.getByTestId("composer-shortcuts"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText(/Entrée pour envoyer/i)).not.toBeInTheDocument();
  });

  it("premier usage : phrase contextuelle sans cartes KPI", () => {
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="A"
        viewport="desktop"
        welcomeDataState="first_use"
        summaryLines={[
          "Créez une protection pour verrouiller le prochain paiement.",
        ]}
        welcomeBriefCards={[
          { id: "expected", label: "Cette semaine", value: "0 €" },
          { id: "active", label: "À traiter", value: "0" },
          { id: "next", label: "Prochain", value: "À préciser" },
        ]}
      />,
    );
    expect(screen.getByTestId("welcome-attention-line")).toHaveTextContent(
      "Sécurisons votre prochain règlement.",
    );
    expect(screen.getByTestId("welcome-greeting")).toHaveTextContent(
      "Bonjour Lucie",
    );
    expect(screen.getByTestId("welcome-greeting").textContent).not.toMatch(
      /voici|quoi de neuf/i,
    );
    expect(
      screen.queryByTestId("welcome-status-lines"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("welcome-brief-cards")).not.toBeInTheDocument();
    expect(screen.getByTestId("welcome-situation-detail")).toHaveTextContent(
      /protection/i,
    );
  });

  it("accueil sans tiret cadratin dans les textes visibles", () => {
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="A"
        viewport="desktop"
        welcomeDataState="first_use"
        summaryLines={[
          "Crée une protection pour verrouiller le prochain paiement.",
        ]}
      />,
    );
    const welcome = screen.getByTestId("welcome-state");
    expect(welcome.textContent).not.toMatch(/—/);
    expect(screen.getByTestId("composer-shortcuts").textContent).not.toMatch(/—/);
  });

  it("conversation : empty caché, fil visible", () => {
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
  });

  it("greeting sans username / email local-part", () => {
    render(
      <ConversationalWorkspace
        userFirstName={null}
        userDisplayName="Profil"
        demoState="A"
        viewport="desktop"
      />,
    );
    expect(screen.getByTestId("welcome-greeting")).toHaveTextContent("Bonjour");
    expect(screen.getByTestId("welcome-greeting").textContent).not.toMatch(
      /jcurtato|@/,
    );
  });

  it("assets brand : logo officiel PNG unique (pas de SVG / pas de texte)", () => {
    const root = join(process.cwd(), "public/brand");
    const logo = readFileSync(join(root, "sidian-logo.png"));
    expect(logo.length).toBeGreaterThan(0);
    // PNG signature
    expect(logo[0]).toBe(0x89);
    expect(logo[1]).toBe(0x50);

    render(<BrandLockup />);
    const img = document.querySelector('img[alt="Sidian"]') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src") ?? "").toMatch(/sidian-logo\.png/);
    // Pas de wordmark texte à côté
    expect(img?.parentElement?.textContent?.trim() ?? "").toBe("");
  });

  it("drawer mobile : hamburger ouvre, overlay au-dessus, fermeture propre", async () => {
    const user = userEvent.setup();
    const listeners = new Set<() => void>();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: (_: string, listener: () => void) => {
          listeners.add(listener);
        },
        removeEventListener: (_: string, listener: () => void) => {
          listeners.delete(listener);
        },
        addListener: (listener: () => void) => listeners.add(listener),
        removeListener: (listener: () => void) => listeners.delete(listener),
      }),
    });

    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="A"
        viewport="mobile"
      />,
    );

    await user.click(screen.getByTestId("assistant-mobile-nav"));
    expect(screen.getByTestId("assistant-shell")).toHaveAttribute(
      "data-mobile-nav",
      "open",
    );
    expect(screen.getByTestId("assistant-mobile-nav-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("assistant-sidebar")).toHaveAttribute(
      "data-sidebar",
      "dark",
    );
  });

  it("lien « Déjà inscrit » non dupliqué sur inscription", () => {
    render(
      <AuthPage
        title="Créer un compte"
        footer={
          <p>
            Déjà inscrit ?{" "}
            <Link href="/connexion">Se connecter</Link>
          </p>
        }
      >
        <SignUpForm />
      </AuthPage>,
    );

    const matches = screen.getAllByText(/Déjà inscrit/);
    expect(matches).toHaveLength(1);
    expect(screen.getByTestId("auth-footer").textContent).toMatch(/Déjà inscrit/);
  });

  it("AuthShell expose le logo officiel Sidian", () => {
    render(
      <AuthShell title="Connexion">
        <div>form</div>
      </AuthShell>,
    );
    const img = document.querySelector('img[alt="Sidian"]') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src") ?? "").toMatch(/sidian-logo\.png/);
  });
});
