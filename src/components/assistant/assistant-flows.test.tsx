import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/app/app-shell";

import type { AgentToolResult, AgentTransport } from "./agent-client";
import { ConversationalWorkspace } from "./conversational-workspace";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/assistant",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push,
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

function asTransport(
  impl: (
    input: Parameters<AgentTransport>[0],
    init?: Parameters<AgentTransport>[1],
  ) => Promise<AgentToolResult>,
): AgentTransport {
  return impl as AgentTransport;
}

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
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => {
      if (
        query.includes("min-width: 1024px") ||
        query.includes("min-width:1024px")
      ) {
        return media;
      }
      return {
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  });

  return media;
}

function okConverse(overrides: Record<string, unknown> = {}) {
  const base = {
    draft_id: "draft-1",
    state: "BROUILLON_INCOMPLET",
    summary: "Donne-moi le client et le montant.",
    missing_fields: ["client_name", "amount_cents"],
    confirmation_nonce: null as string | null,
    pending_question: "Qui est ton client ?",
    open_ambiguities: [],
    recap: {
      client_name: null as string | null,
      client_email: null as string | null,
      expected_amount_minor: null as number | null,
      currency: "EUR",
      due_date: null as string | null,
      libelle: null as string | null,
      reference_externe: null as string | null,
    },
  };
  return {
    ok: true as const,
    request_id: "req-1",
    correlation_id: "corr-1",
    tool_id: "protection.draft.converse",
    tool_version: "1.0.0",
    output: {
      ...base,
      ...overrides,
      recap: {
        ...base.recap,
        ...((overrides.recap as Record<string, unknown> | undefined) ?? {}),
      },
    },
  };
}

function okConfirm() {
  return {
    ok: true as const,
    request_id: "req-2",
    correlation_id: "corr-2",
    tool_id: "protection.draft.confirm",
    tool_version: "1.0.0",
    output: {
      draft_id: "draft-1",
      state: "TERMINE",
      outcome: "created",
      client_payeur_id: "client-1",
      creance_id: "prot-42",
    },
  };
}

describe("Assistant flows (component e2e)", () => {
  beforeEach(() => {
    stubMatchMedia(true);
    push.mockReset();
  });

  afterEach(() => {
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
    document.body.style.touchAction = "";
  });

  it(
    "ouvre l’assistant (welcome + composer)",
    () => {
      render(
        <ConversationalWorkspace
          userFirstName="Lucie"
          userDisplayName="Lucie Martin"
          viewport="desktop"
          forceLiveAgent={false}
          demoState="A"
        />,
      );

      expect(screen.getByTestId("assistant-shell")).toBeVisible();
      expect(screen.getByTestId("welcome-state")).toBeVisible();
      expect(screen.getByTestId("composer")).toBeVisible();
      expect(screen.getByTestId("composer-input")).toHaveAccessibleName(
        "Instruction pour Sidian",
      );
    },
    15_000,
  );

  it(
    "pose une question via le composer (live agent)",
    async () => {
      const user = userEvent.setup();
      const transport = vi.fn(
        asTransport(async () => okConverse() as AgentToolResult),
      );

      render(
        <ConversationalWorkspace
          userFirstName="Lucie"
          userDisplayName="Lucie Martin"
          viewport="desktop"
          forceLiveAgent
          agentTransport={transport as unknown as AgentTransport}
        />,
      );

      await user.type(
        screen.getByTestId("composer-input"),
        "Combien dois-je recevoir ?",
      );
      await user.click(screen.getByTestId("composer-send"));

      expect(
        within(screen.getByTestId("message-thread")).getByText(
          "Combien dois-je recevoir ?",
        ),
      ).toBeVisible();

      await waitFor(() => {
        expect(transport).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(screen.getByText("Qui est ton client ?")).toBeVisible();
      });
    },
    20_000,
  );

  it(
    "crée une protection (raccourci → conversation + carte, panneau fermé)",
    async () => {
      const user = userEvent.setup();
      const onShortcutAction = vi.fn();

      render(
        <ConversationalWorkspace
          userFirstName="Lucie"
          userDisplayName="Lucie Martin"
          demoState="A"
          viewport="desktop"
          onShortcutAction={onShortcutAction}
        />,
      );

      await user.click(
        screen.getByTestId("composer-shortcut-create-protection"),
      );

      expect(onShortcutAction).toHaveBeenCalledWith("create_protection");
      expect(screen.queryByTestId("context-panel")).not.toBeInTheDocument();
      expect(screen.getByTestId("conversational-workspace")).toHaveAttribute(
        "data-panel-open",
        "false",
      );
      expect(screen.queryByTestId("message-card")).not.toBeInTheDocument();
      expect(screen.queryByText(/La protection n’est pas encore complète/i)).not.toBeInTheDocument();
      expect(screen.getByText(/Créons cette protection ensemble/i)).toBeVisible();
      expect(screen.getByText(/Qui doit te payer/i)).toBeVisible();
      expect(screen.getByTestId("message-suggestions")).toBeVisible();
      expect(screen.getByRole("button", { name: "Dupont Conseil" })).toBeVisible();

      await user.click(screen.getByRole("button", { name: "Dupont Conseil" }));

      await waitFor(() => {
        expect(
          screen.getByText(/Créer l’espace « Dupont Conseil »/i),
        ).toBeVisible();
      });
      await user.click(screen.getByRole("button", { name: "Rester dans Général" }));

      await waitFor(() => {
        expect(screen.getByText(/Quel montant veux-tu sécuriser/i)).toBeVisible();
      });
      expect(screen.queryByTestId("message-card")).not.toBeInTheDocument();
      expect(screen.getByTestId("message-suggestions")).toBeVisible();
      expect(screen.getByRole("button", { name: "1 000 €" })).toBeVisible();
      expect(screen.getByRole("button", { name: "2 500 €" })).toBeVisible();
    },
    15_000,
  );

  it(
    "ouvre le sélecteur de fichiers via le trombone",
    async () => {
      const user = userEvent.setup();

      render(
        <ConversationalWorkspace
          userFirstName="Lucie"
          userDisplayName="Lucie Martin"
          demoState="A"
          viewport="desktop"
        />,
      );

      const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click");

      await user.click(
        screen.getByRole("button", { name: "Ajouter des fichiers" }),
      );

      await waitFor(() => {
        expect(clickSpy).toHaveBeenCalled();
      });

      clickSpy.mockRestore();
      expect(screen.getByTestId("composer-file-input")).toBeInTheDocument();
    },
    10_000,
  );

  it(
    "refuse une capture d’écran comme facture",
    async () => {
      const user = userEvent.setup();
      const screenshot = new File(["pixels"], "Capture d’écran 2026-07-27.png", {
        type: "image/png",
        lastModified: 1,
      });

      render(
        <ConversationalWorkspace
          userFirstName="Lucie"
          userDisplayName="Lucie Martin"
          demoState="A"
          viewport="desktop"
        />,
      );

      await user.type(
        screen.getByTestId("composer-input"),
        "Importer un document",
      );
      await user.click(screen.getByTestId("composer-send"));
      expect(
        screen.getByText(/Importe ta facture avec le sélecteur de fichiers/i),
      ).toBeVisible();

      await user.upload(screen.getByLabelText("Choisir des fichiers"), screenshot);
      await user.click(screen.getByTestId("composer-send"));

      expect(
        await screen.findByText(/L’analyse visuelle sera bientôt disponible/i),
      ).toBeVisible();
      expect(
        screen.queryByText(/Quel est le nom du client/i),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("message-suggestion-Importer une facture"),
      ).not.toBeInTheDocument();
    },
    10_000,
  );

  it(
    "demande une confirmation et reste honnête dans l’aperçu local",
    async () => {
      const user = userEvent.setup();

      render(
        <ConversationalWorkspace
          userFirstName="Lucie"
          userDisplayName="Lucie Martin"
          demoState="A"
          viewport="desktop"
        />,
      );

      await user.click(screen.getByTestId("composer-shortcut-create-client"));
      expect(screen.getByText(/Quel est le nom du nouveau client/i)).toBeVisible();

      await user.click(
        screen.getByRole("button", { name: "Saisir le nom du client" }),
      );
      await user.type(screen.getByTestId("suggestion-client-name-input"), "test");
      await user.click(screen.getByTestId("suggestion-client-name-submit"));

      await waitFor(() => {
        expect(screen.getByText(/Quel est l’email de test/i)).toBeVisible();
      });
      await waitFor(() => {
        expect(screen.getByTestId("suggestion-email-input")).toBeVisible();
      });
      await user.type(screen.getByTestId("suggestion-email-input"), "test@test.test");
      await user.click(screen.getByTestId("suggestion-email-submit"));

      await waitFor(() => {
        expect(screen.getByText(/récapitulatif avant création/i)).toBeVisible();
      });
      await user.click(
        screen.getByTestId(
          "message-suggestion-Confirmer la création du client",
        ),
      );

      await waitFor(() => {
        expect(
          screen.getByText(/n’est pas disponible dans cet aperçu/i),
        ).toBeVisible();
      });
      expect(screen.queryByText(/Client prêt : test/i)).not.toBeInTheDocument();
    },
    25_000,
  );

  it(
    "propose aussi le client issu d’un message libre (ex. client X)",
    async () => {
      const user = userEvent.setup();

      render(
        <ConversationalWorkspace
          userFirstName="Lucie"
          userDisplayName="Lucie Martin"
          demoState="A"
          viewport="desktop"
        />,
      );

      const input = screen.getByTestId("composer-input");
      await user.type(
        input,
        "Nouveau client X, facture de 350 le 31 juillet",
      );
      await user.click(screen.getByTestId("composer-send"));

      await waitFor(() => {
        expect(
          screen.getByText(/J’ai créé le client X et préparé la protection/i),
        ).toBeVisible();
      });

      await user.click(
        screen.getByTestId("sidebar-new-conversation"),
      );
      await user.click(screen.getByTestId("composer-shortcut-create-protection"));

      await waitFor(() => {
        expect(screen.getByText(/Qui doit te payer/i)).toBeVisible();
        expect(screen.getByTestId("message-suggestion-X")).toBeVisible();
      });
      expect(
        screen.getByTestId("message-suggestion-Dupont Conseil"),
      ).toBeVisible();
    },
    15_000,
  );

  it(
    "valide une protection (confirm live)",
    async () => {
      const user = userEvent.setup();
      const transport = vi.fn(
        asTransport(async (input) => {
          if (input.tool_id === "protection.draft.confirm") {
            return okConfirm() as AgentToolResult;
          }
          return okConverse({
            state: "RECAPITULATIF",
            missing_fields: [],
            confirmation_nonce: "nonce-1",
            pending_question: null,
            summary: "Prêt à confirmer pour Dupont Conseil.",
            recap: {
              client_name: "Dupont Conseil",
              client_email: null,
              expected_amount_minor: 120000,
              currency: "EUR",
              due_date: "2026-08-01",
              libelle: "Mission juillet",
              reference_externe: null,
            },
          }) as AgentToolResult;
        }),
      );

      render(
        <ConversationalWorkspace
          userFirstName="Lucie"
          userDisplayName="Lucie Martin"
          viewport="desktop"
          forceLiveAgent
          agentTransport={transport as unknown as AgentTransport}
        />,
      );

      await user.type(
        screen.getByTestId("composer-input"),
        "Protection Dupont 1200 euros",
      );
      await user.click(screen.getByTestId("composer-send"));

      await waitFor(() => {
        expect(screen.getByTestId("context-panel")).toBeVisible();
      });

      await user.click(screen.getByTestId("context-panel-primary"));

      await waitFor(() => {
        expect(transport).toHaveBeenCalledWith(
          expect.objectContaining({ tool_id: "protection.draft.confirm" }),
          expect.anything(),
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId("context-panel")).toHaveAttribute(
          "data-status",
          "active",
        );
      });
    },
    25_000,
  );

  it(
    "affiche un échec réseau et permet de réessayer",
    async () => {
      const user = userEvent.setup();
      let calls = 0;
      const transport = vi.fn(
        asTransport(async () => {
          calls += 1;
          if (calls === 1) {
            return {
              ok: false,
              code: "NETWORK_ERROR",
              message: "Impossible de joindre Sidian. Vérifie ta connexion.",
              httpStatus: 0,
              retryable: true,
            };
          }
          return okConverse() as AgentToolResult;
        }),
      );

      render(
        <ConversationalWorkspace
          userFirstName="Lucie"
          userDisplayName="Lucie Martin"
          viewport="desktop"
          forceLiveAgent
          agentTransport={transport as unknown as AgentTransport}
        />,
      );

      await user.type(screen.getByTestId("composer-input"), "Bonjour");
      await user.click(screen.getByTestId("composer-send"));

      await waitFor(() => {
        expect(screen.getByTestId("message-retry")).toBeVisible();
      });

      expect(
        screen.getAllByText("La connexion a été interrompue.").length,
      ).toBeGreaterThan(0);
      expect(
        screen.getByText(/Ton message est conservé/i),
      ).toBeVisible();
      expect(screen.getByTestId("composer-input")).toHaveValue("Bonjour");

      await user.click(screen.getByTestId("message-retry"));

      await waitFor(() => {
        expect(calls).toBe(2);
      });

      await waitFor(() => {
        expect(screen.getByText("Qui est ton client ?")).toBeVisible();
      });
      expect(
        within(screen.getByTestId("message-thread")).getAllByText("Bonjour"),
      ).toHaveLength(1);
    },
    25_000,
  );

  it(
    "utilise le drawer mobile (ouvrir / fermer / trap)",
    async () => {
      const user = userEvent.setup();
      stubMatchMedia(false);

      render(
        <AppShell variant="workspace" userDisplayName="Lucie Martin">
          <p>Contenu</p>
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
      expect(screen.getByTestId("assistant-sidebar")).toHaveAttribute(
        "role",
        "dialog",
      );
      expect(screen.getByTestId("assistant-mobile-nav-close")).toHaveFocus();

      await user.keyboard("{Escape}");
      expect(screen.getByTestId("assistant-shell")).toHaveAttribute(
        "data-mobile-nav",
        "closed",
      );
    },
    15_000,
  );

  it(
    "affiche le panneau protection en sheet sur mobile",
    () => {
      render(
        <ConversationalWorkspace
          userFirstName="Lucie"
          userDisplayName="Lucie Martin"
          demoState="C"
          viewport="mobile"
        />,
      );

      const panel = screen.getByTestId("context-panel");
      expect(panel).toHaveAttribute("data-mode", "sheet");
      expect(panel).toHaveAttribute("role", "dialog");
    },
    15_000,
  );
});
