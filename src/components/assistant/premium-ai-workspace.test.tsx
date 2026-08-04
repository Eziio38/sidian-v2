import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ConversationalWorkspace } from "./conversational-workspace";
import { WELCOME_COMPOSER_PLACEHOLDER } from "./composer";
import { APP_NAV, LEGACY_NAV_LABELS } from "@/components/app/app-nav-config";
import { ErrorState } from "@/components/feedback";
import { UX_COPY } from "@/lib/ux/microcopy";

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
}));

vi.mock("@/app/actions/clients-creances", () => ({
  createClientPayeurAction: vi.fn(async () => ({ ok: true })),
}));

describe("Premium AI Workspace gates", () => {
  it("composer unique + placeholder + pas de hint clavier", () => {
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="A"
        viewport="desktop"
      />,
    );
    expect(screen.getAllByTestId("composer")).toHaveLength(1);
    expect(screen.getByTestId("composer-input")).toHaveAttribute(
      "placeholder",
      WELCOME_COMPOSER_PLACEHOLDER,
    );
    expect(screen.queryByText(/Entrée pour envoyer/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Maj\+Entrée/i)).not.toBeInTheDocument();
  });

  it("les intentions d’empty state restent sous le composer", () => {
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="A"
        viewport="desktop"
      />,
    );
    expect(screen.queryByTestId("welcome-actions")).not.toBeInTheDocument();
    expect(screen.getByTestId("composer-shortcuts")).toBeInTheDocument();
    expect(screen.queryByText("Suggestions")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("composer").compareDocumentPosition(
        screen.getByTestId("composer-shortcuts"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByLabelText("Ajouter des images")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Ajouter des fichiers")).toBeVisible();
    expect(screen.getByLabelText("Dicter une demande")).toBeVisible();
  });

  it("erreurs techniques absentes de la microcopie UX", () => {
    const microcopyPath = join(process.cwd(), "src/lib/ux/microcopy.ts");
    const source = readFileSync(microcopyPath, "utf8");
    for (const banned of [
      "RPC",
      "Supabase",
      "audit_log",
      "webhook",
      "idempotence",
      "outbox",
    ]) {
      // Le commentaire d’interdiction peut citer les termes — le contenu exporté non.
      expect(UX_COPY.errorGeneric.description).not.toMatch(
        new RegExp(banned, "i"),
      );
      expect(UX_COPY.errorLoad.description).not.toMatch(new RegExp(banned, "i"));
    }
    expect(source).toMatch(/Interdit dans l’UI/);

    render(
      <ErrorState
        title={UX_COPY.errorGeneric.title}
        description={UX_COPY.errorGeneric.description}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeVisible();
    expect(screen.queryByText(/RPC|Supabase|audit/i)).not.toBeInTheDocument();
  });

  it("nav config n’inclut aucun libellé hérité", () => {
    const labels = APP_NAV.map((item) => item.label);
    for (const legacy of LEGACY_NAV_LABELS) {
      expect(labels).not.toContain(legacy);
    }
  });

  it("sidebar sombre cohérente dans l’atelier Aujourd’hui", () => {
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="A"
        viewport="desktop"
      />,
    );
    expect(screen.getByTestId("assistant-sidebar")).toHaveAttribute(
      "data-sidebar",
      "dark",
    );
    expect(screen.getByTestId("assistant-shell")).toHaveAttribute(
      "data-shell",
      "app",
    );
    expect(screen.getByTestId("assistant-shell")).toHaveAttribute(
      "data-appearance",
      "agent-dark",
    );
  });
});
