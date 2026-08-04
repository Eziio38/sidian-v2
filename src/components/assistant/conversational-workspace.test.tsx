import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentToolResult, AgentTransport } from "./agent-client";
import { ConversationalWorkspace } from "./conversational-workspace";

/*
 * Téléversement des pièces jointes neutralisé pour cette suite.
 *
 * En jsdom, `persistDocumentAttachment` échoue faute de serveur et le composer
 * affiche — à juste titre — « ce fichier n'a pas pu être enregistré ». Ce
 * message légitime polluait des assertions qui ne portent pas sur la
 * persistance. La persistance elle-même est couverte par sa propre suite.
 */
vi.mock("@/lib/documents/client-upload", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/documents/client-upload")
  >();
  return {
    ...actual,
    persistDocumentAttachment: vi.fn(async (file: File) => ({
      ok: true as const,
      documentId: `doc-${file.name}`,
      status: "awaiting_processing" as const,
      storagePath: `tenant/doc-${file.name}`,
    })),
  };
});



const push = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/assistant",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push,
    replace,
    prefetch: vi.fn(),
  }),
}));

vi.mock("@/app/actions/auth", () => ({
  signOutAction: vi.fn(),
}));

vi.mock("@/app/actions/clients-creances", () => ({
  createClientPayeurAction: vi.fn(async () => ({ ok: true })),
}));

function successfulConverseResult(
  pendingQuestion = "Quel est votre client ?",
): AgentToolResult {
  return {
    ok: true,
    request_id: "request-success",
    correlation_id: "correlation-success",
    tool_id: "protection.draft.converse",
    tool_version: "1.0.0",
    output: {
      draft_id: "22222222-2222-4222-8222-222222222222",
      state: "QUESTION_CIBLEE",
      missing_fields: ["client_name"],
      pending_question: pendingQuestion,
      open_ambiguities: [],
      recap: {
        client_name: null,
        client_email: null,
        expected_amount_minor: null,
        currency: "EUR",
        due_date: null,
        libelle: null,
        reference_externe: null,
      },
      confirmation_nonce: null,
      summary: "Je prépare votre demande.",
    },
  };
}

describe("ConversationalWorkspace", () => {
  beforeEach(() => {
    vi.useRealTimers();
    push.mockClear();
    replace.mockClear();
  });

  it("affiche WelcomeState à l’état A (conversation vide, panneau fermé)", () => {
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="A"
        viewport="desktop"
      />,
    );

    expect(screen.getByTestId("welcome-state")).toBeVisible();
    expect(screen.getByTestId("welcome-greeting")).toHaveTextContent(
      "Bonjour Lucie",
    );
    expect(screen.queryByTestId("context-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("conversational-workspace")).toHaveAttribute(
      "data-panel-open",
      "false",
    );
    // Les intentions sont rattachées au composer, sans bloc CTA concurrent.
    expect(screen.getByTestId("composer-shortcuts")).toBeVisible();
    expect(
      screen.getByTestId("composer-shortcut-create-protection"),
    ).toBeVisible();
    expect(
      screen.getByTestId("composer-shortcut-create-protection"),
    ).toHaveTextContent("Protéger une facture");
  });

  it("Sidian et Demander à Sidian ouvrent le même état vide sans POST", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Aucun appel attendu"));

    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        viewport="desktop"
      />,
    );

    await user.click(screen.getByTestId("sidebar-new-conversation"));
    expect(screen.getByTestId("welcome-state")).toBeVisible();

    fireEvent.click(
      screen.getByRole("link", { name: "Accueil", hidden: true }),
    );
    expect(screen.getByTestId("welcome-state")).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("crée une seule discussion au premier double envoi", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (
          url === "/api/assistant/conversations" &&
          init?.method === "POST"
        ) {
          return Response.json(
            {
              conversation: {
                id: "11111111-1111-4111-8111-111111111111",
                clientId: null,
                clientName: null,
                title: "Nouvelle discussion",
                preview: null,
                updatedAt: "2026-07-30T12:00:00.000Z",
              },
            },
            { status: 201 },
          );
        }
        if (url === "/api/agent/tools" && init?.method === "POST") {
          return Response.json({
            status: "success",
            request_id: "request-1",
            correlation_id: "correlation-1",
            data: {
              tool_id: "protection.draft.converse",
              tool_version: "1.0.0",
              output: {
                draft_id: "22222222-2222-4222-8222-222222222222",
                state: "BROUILLON_INCOMPLET",
                summary: "Je prépare votre demande.",
                missing_fields: ["client_name"],
                confirmation_nonce: null,
                pending_question: "Quel est votre client ?",
                open_ambiguities: [],
                recap: {
                  client_name: null,
                  client_email: null,
                  expected_amount_minor: null,
                  currency: "EUR",
                  due_date: null,
                  libelle: null,
                  reference_externe: null,
                },
              },
            },
          });
        }
        if (
          url === "/api/assistant/conversations" &&
          (!init?.method || init.method === "GET")
        ) {
          return Response.json({ conversations: [] });
        }
        throw new Error(`Appel inattendu : ${url}`);
      });

    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        viewport="desktop"
      />,
    );

    await user.type(screen.getByTestId("composer-input"), "Prépare mon suivi");
    const initialSend = screen.getByTestId("composer-send");
    fireEvent.click(initialSend);
    fireEvent.click(initialSend);

    await screen.findByText("Quel est votre client ?");

    const createCalls = fetchSpy.mock.calls.filter(
      ([input, init]) =>
        String(input) === "/api/assistant/conversations" &&
        init?.method === "POST",
    );
    const agentCalls = fetchSpy.mock.calls.filter(
      ([input, init]) =>
        String(input) === "/api/agent/tools" && init?.method === "POST",
    );
    expect(createCalls).toHaveLength(1);
    expect(agentCalls).toHaveLength(1);
    await waitFor(() => {
      expect(screen.getByTestId("composer-input")).toHaveValue("");
    });

    fetchSpy.mockRestore();
  });

  it("initialise une protection depuis la route une seule fois", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (
          url === "/api/assistant/conversations" &&
          init?.method === "POST"
        ) {
          return Response.json(
            {
              conversation: {
                id: "11111111-1111-4111-8111-111111111111",
                clientId: null,
                clientName: null,
                title: "Nouvelle discussion",
                preview: null,
                updatedAt: "2026-07-30T12:00:00.000Z",
              },
            },
            { status: 201 },
          );
        }
        if (url === "/api/agent/tools" && init?.method === "POST") {
          return Response.json({
            status: "success",
            request_id: "request-initial",
            correlation_id: "correlation-initial",
            data: {
              tool_id: "protection.draft.converse",
              tool_version: "1.0.0",
              output: {
                draft_id: "22222222-2222-4222-8222-222222222222",
                state: "BROUILLON_INCOMPLET",
                summary: "Je prépare votre protection.",
                missing_fields: ["client_name"],
                confirmation_nonce: null,
                pending_question: "Qui doit vous payer ?",
                open_ambiguities: [],
                recap: {
                  client_name: null,
                  client_email: null,
                  expected_amount_minor: null,
                  currency: "EUR",
                  due_date: null,
                  libelle: null,
                  reference_externe: null,
                },
              },
            },
          });
        }
        if (
          url === "/api/assistant/conversations" &&
          (!init?.method || init.method === "GET")
        ) {
          return Response.json({ conversations: [] });
        }
        throw new Error(`Appel inattendu : ${url}`);
      });

    render(
      <StrictMode>
        <ConversationalWorkspace
          userFirstName="Lucie"
          userDisplayName="Lucie Martin"
          viewport="desktop"
          initialAction="create_protection"
        />
      </StrictMode>,
    );

    expect(await screen.findByText("Qui doit vous payer ?")).toBeVisible();
    expect(replace).toHaveBeenCalledWith("/app/assistant", { scroll: false });
    expect(
      fetchSpy.mock.calls.filter(
        ([input, init]) =>
          String(input) === "/api/assistant/conversations" &&
          init?.method === "POST",
      ),
    ).toHaveLength(1);
    expect(
      fetchSpy.mock.calls.filter(
        ([input, init]) =>
          String(input) === "/api/agent/tools" && init?.method === "POST",
      ),
    ).toHaveLength(1);

    fetchSpy.mockRestore();
  });

  it("crée l’historique local au premier message et restaure son snapshot", async () => {
    const user = userEvent.setup();
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="A"
        viewport="desktop"
      />,
    );

    const sidebar = screen.getByTestId("assistant-sidebar");
    expect(
      sidebar.querySelector('[data-testid^="assistant-conversation-"]'),
    ).toBeNull();

    await user.type(screen.getByTestId("composer-input"), "Bonjour Sidian");
    await user.click(screen.getByTestId("composer-send"));

    const conversation = await waitFor(() => {
      const item = sidebar.querySelector<HTMLElement>(
        '[data-testid^="assistant-conversation-"]',
      );
      expect(item).not.toBeNull();
      const trigger = item?.querySelector<HTMLButtonElement>("button");
      expect(trigger).not.toBeNull();
      return trigger!;
    });

    await user.click(screen.getByTestId("sidebar-new-conversation"));
    expect(screen.getByTestId("welcome-state")).toBeVisible();
    await user.click(conversation);
    expect(
      within(screen.getByTestId("message-thread")).getByText("Bonjour Sidian"),
    ).toBeVisible();
  });

  it("cache WelcomeState après le premier message (état B)", () => {
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
    expect(screen.queryByTestId("context-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("composer-shortcuts")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("sidebar-new-conversation"),
    ).toBeVisible();
  });

  it("ouvre le ContextPanel lorsqu’un contexte est actif (état C)", () => {
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="C"
        viewport="desktop"
      />,
    );

    expect(screen.getByTestId("context-panel")).toBeVisible();
    expect(screen.getByTestId("conversational-workspace")).toHaveAttribute(
      "data-panel-open",
      "true",
    );
    expect(
      within(screen.getByTestId("protection-field-client")).getByText(
        "Dupont Conseil",
      ),
    ).toBeVisible();
    expect(screen.getByTestId("message-card")).toBeVisible();
    expect(screen.queryByTestId("composer-shortcuts")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("sidebar-new-conversation"),
    ).toBeVisible();
  });

  it("permet de refermer le panneau et reprend la largeur (état D)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ConversationalWorkspace
        key="C"
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="C"
        viewport="desktop"
      />,
    );

    expect(screen.getByTestId("context-panel")).toBeVisible();
    expect(screen.getByTestId("protection-field-consequences")).toBeVisible();
    await user.click(screen.getByTestId("context-panel-close"));
    expect(screen.queryByTestId("context-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("conversational-workspace")).toHaveAttribute(
      "data-panel-open",
      "false",
    );
    // Hors empty state : pas de raccourcis au-dessus du composer (CTA sidebar).
    expect(screen.queryByTestId("composer-shortcuts")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("sidebar-new-conversation"),
    ).toBeVisible();

    rerender(
      <ConversationalWorkspace
        key="D"
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="D"
        viewport="desktop"
      />,
    );

    expect(screen.queryByTestId("context-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("message-thread")).toBeVisible();
  });

  it("rouvre le panneau sans perdre le brouillon après fermeture", async () => {
    const user = userEvent.setup();
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="C"
        viewport="desktop"
      />,
    );

    expect(
      within(screen.getByTestId("protection-field-client")).getByText(
        "Dupont Conseil",
      ),
    ).toBeVisible();
    await user.click(screen.getByTestId("context-panel-close"));
    expect(screen.queryByTestId("context-panel")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continuer" }));
    expect(screen.getByTestId("context-panel")).toBeVisible();
    expect(
      within(screen.getByTestId("protection-field-client")).getByText(
        "Dupont Conseil",
      ),
    ).toBeVisible();
    expect(screen.getByTestId("protection-field-amount")).toHaveTextContent(
      "2 400",
    );
  });

  it("n’affiche plus de raccourcis composer hors empty state (état E)", () => {
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="E"
        viewport="desktop"
      />,
    );

    expect(screen.getByTestId("context-panel")).toBeVisible();
    expect(screen.queryByTestId("composer-shortcuts")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("sidebar-new-conversation"),
    ).toBeVisible();
  });

  it("déclenche l’action du raccourci sélectionné", async () => {
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

    await user.click(screen.getByTestId("composer-shortcut-create-client"));
    expect(onShortcutAction).toHaveBeenCalledWith("create_client");
    expect(screen.getByTestId("conversational-workspace")).toHaveAttribute(
      "data-last-shortcut",
      "create_client",
    );
    expect(screen.getByText(/Quel est le nom du nouveau client/i)).toBeVisible();
    expect(screen.getByTestId("message-suggestions")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Saisir le nom du client" }));
    expect(screen.getByTestId("suggestion-client-name-input")).toBeVisible();
  });

  it("résume les paiements dans la conversation", async () => {
    const user = userEvent.setup();

    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="A"
        viewport="desktop"
        paymentSummary={{
          confirmedCount: 2,
          confirmedAmountLabel: "4 100 €",
          processingCount: 1,
          processingAmountLabel: "1 200 €",
          upcomingCount: 3,
          upcomingAmountLabel: "3 650 €",
          nextPaymentLabel: "Dupont Conseil · 2 450 €",
        }}
      />,
    );

    await user.click(screen.getByTestId("composer-shortcut-view-expected"));

    expect(screen.queryByTestId("welcome-state")).not.toBeInTheDocument();
    expect(screen.getByText("Voici la synthèse de tes paiements.")).toBeVisible();
    expect(screen.queryByTestId("message-card")).not.toBeInTheDocument();
    expect(screen.getByTestId("message-action-view-payments")).toHaveTextContent(
      "Consulter les paiements",
    );
    const threadCopy = screen.getByTestId("message-thread").textContent ?? "";
    expect(threadCopy).toMatch(/Validés\s*: 2 paiements · 4\s*100 €/);
    expect(threadCopy).toMatch(/En cours\s*: 1 paiement · 1\s*200 €/);
    expect(threadCopy).toMatch(/À venir\s*: 3 paiements · 3\s*650 €/);
    expect(threadCopy).toMatch(/Dupont Conseil · 2\s*450 €/);

    await user.click(screen.getByTestId("message-action-view-payments"));
    expect(push).toHaveBeenCalledWith("/app/paiements");
    expect(screen.queryByTestId("context-panel")).not.toBeInTheDocument();
  });

  it("traite un message libre comme l’action rapide « Créer une protection »", async () => {
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

    await user.type(
      screen.getByTestId("composer-input"),
      "Créer une protection",
    );
    await user.click(screen.getByTestId("composer-send"));

    expect(onShortcutAction).toHaveBeenCalledWith("create_protection");
    expect(screen.getByText(/Qui doit te payer/i)).toBeVisible();
    expect(
      screen.queryByText(/J’ai noté ta demande/i),
    ).not.toBeInTheDocument();
  });

  it("traite « Vérifier les paiements » comme voir les paiements", async () => {
    const user = userEvent.setup();

    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="A"
        viewport="desktop"
        paymentSummary={{
          confirmedCount: 1,
          confirmedAmountLabel: "1 000 €",
          processingCount: 0,
          processingAmountLabel: "0 €",
          upcomingCount: 1,
          upcomingAmountLabel: "500 €",
          nextPaymentLabel: "Dupont · 500 €",
        }}
      />,
    );

    await user.type(
      screen.getByTestId("composer-input"),
      "Vérifier les paiements",
    );
    await user.click(screen.getByTestId("composer-send"));

    expect(screen.getByText("Voici la synthèse de tes paiements.")).toBeVisible();
    expect(screen.queryByTestId("message-card")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/J’ai noté ta demande/i),
    ).not.toBeInTheDocument();
  });

  it("extrait client / montant / date d’un message libre", async () => {
    const user = userEvent.setup();
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
      "J'ai un nouveau client qui se nomme martin, facture de 350 avec une date au 31 juillet",
    );
    await user.click(screen.getByTestId("composer-send"));

    expect(
      await screen.findByText(/J’ai créé le client Martin/i),
    ).toBeVisible();
    expect(screen.getByTestId("context-panel")).toBeVisible();
    expect(
      within(screen.getByTestId("protection-field-client")).getByText("Martin"),
    ).toBeVisible();
    expect(screen.getByTestId("protection-field-amount")).toHaveTextContent(
      "350",
    );
    expect(screen.getByTestId("protection-field-due_date")).toHaveTextContent(
      /31 juillet/i,
    );
    expect(
      screen.queryByTestId("protection-field-missing"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("composer-shortcuts")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("sidebar-new-conversation"),
    ).toBeVisible();
  }, 15_000);

  it("cache WelcomeState après envoi du premier message", async () => {
    const user = userEvent.setup();

    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="A"
        viewport="desktop"
      />,
    );

    expect(screen.getByTestId("welcome-state")).toBeVisible();

    await user.type(
      screen.getByTestId("composer-input"),
      "Bonjour Sidian",
    );
    await user.click(screen.getByTestId("composer-send"));

    expect(screen.queryByTestId("welcome-state")).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("message-thread")).getByText("Bonjour Sidian"),
    ).toBeVisible();
  }, 15_000);

  it("conserve les fichiers joints sur le message après envoi", async () => {
    const user = userEvent.setup();
    const invoice = new File(["facture"], "facture-juillet.pdf", {
      type: "application/pdf",
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

    expect(
      screen.queryByTestId("conversation-resources-trigger"),
    ).not.toBeInTheDocument();

    await user.upload(screen.getByLabelText("Choisir des fichiers"), invoice);
    await user.type(
      screen.getByTestId("composer-input"),
      "Sécurise cette facture https://example.com/doc",
    );
    await user.click(screen.getByTestId("composer-send"));

    expect(
      await within(screen.getByTestId("message-thread")).findByText(
        "facture-juillet.pdf",
      ),
    ).toBeVisible();
    expect(screen.getByTestId("message-attachments")).toBeVisible();
    expect(screen.queryByTestId("composer-attachment")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Afficher l’aperçu de facture-juillet.pdf",
      }),
    );
    expect(screen.getByTestId("attachment-preview-dialog")).toBeVisible();
    expect(screen.getByTestId("pdf-document-preview")).toBeVisible();
    expect(
      screen.queryByTitle("Aperçu de facture-juillet.pdf"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Fermer l’aperçu" }));

    await user.click(screen.getByTestId("conversation-resources-trigger"));
    expect(screen.getByTestId("conversation-resources-panel")).toHaveTextContent(
      "facture-juillet.pdf",
    );
    expect(screen.getByTestId("conversation-resources-panel")).toHaveTextContent(
      "example.com/doc",
    );
  }, 15_000);

  it("aligne le composer conversation sur l’empty state (file + vocal + send)", () => {
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="B"
        viewport="desktop"
      />,
    );

    expect(screen.queryByLabelText("Ajouter des images")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Ajouter des fichiers")).toBeVisible();
    expect(screen.getByLabelText("Dicter une demande")).toBeVisible();
    expect(screen.queryByTestId("composer-shortcuts")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("sidebar-new-conversation"),
    ).toBeVisible();
  });

  it("ne rend pas de panneau permanent sur mobile", () => {
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="C"
        viewport="mobile"
      />,
    );

    expect(screen.getByTestId("conversational-workspace")).toHaveAttribute(
      "data-panel-open",
      "false",
    );
    expect(screen.getByTestId("conversational-workspace")).toHaveAttribute(
      "data-viewport",
      "mobile",
    );

    const panel = screen.getByTestId("context-panel");
    expect(panel).toHaveAttribute("data-mode", "sheet");
  });

  it("referme la feuille Protection en touchant hors de la feuille", async () => {
    const user = userEvent.setup();

    const { container } = render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="C"
        viewport="mobile"
      />,
    );

    expect(screen.getByTestId("context-panel")).toHaveAttribute(
      "data-mode",
      "sheet",
    );

    const backdrop = container.querySelector<HTMLElement>(
      '[data-testid="conversational-workspace"] > div[aria-hidden="true"]',
    );
    if (!backdrop) throw new Error("sheet_backdrop_missing");
    await user.click(backdrop);

    expect(screen.queryByTestId("context-panel")).not.toBeInTheDocument();
  });

  it("affiche le panneau Protection en overlay accessible sur tablette", () => {
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="C"
        viewport="tablet"
      />,
    );

    expect(screen.getByTestId("context-panel")).toHaveAttribute(
      "data-mode",
      "overlay",
    );
    expect(screen.getByTestId("context-panel")).toHaveAttribute(
      "aria-modal",
      "true",
    );
  });

  it(
    "appelle protection.draft.converse et affiche la réponse",
    async () => {
      const user = userEvent.setup();
      const transport = vi.fn(async () => ({
        ok: true as const,
        request_id: "req-1",
        correlation_id: "corr-1",
        tool_id: "protection.draft.converse",
        tool_version: "1.0.0",
        output: {
          draft_id: "11111111-1111-4111-8111-111111111111",
          state: "QUESTION_CIBLEE",
          missing_fields: ["client_email"],
          pending_question: "Quelle est l’adresse e-mail du contact client ?",
          open_ambiguities: [],
          recap: {
            client_name: "Dupont Conseil",
            client_email: null,
            expected_amount_minor: 240000,
            currency: "EUR",
            due_date: "2026-09-12",
            libelle: null,
            reference_externe: null,
          },
          confirmation_nonce: null,
          summary: "Proposition de brouillon — Client : Dupont Conseil.",
        },
      }));

      render(
        <ConversationalWorkspace
          userFirstName="Lucie"
          userDisplayName="Lucie Martin"
          viewport="desktop"
          forceLiveAgent
          agentTransport={transport as AgentTransport}
        />,
      );

      await user.type(screen.getByTestId("composer-input"), "Protection Dupont");
      await user.click(screen.getByTestId("composer-send"));

      expect(
        await screen.findByTestId("message-thread"),
      ).toBeVisible();
      expect(
        within(screen.getByTestId("message-thread")).getByText(/adresse e-mail/i),
      ).toBeVisible();
      expect(transport).toHaveBeenCalledTimes(1);
      const firstCall = transport.mock.calls[0] as unknown as
        | [{ tool_id: string; tool_version: string; arguments: unknown }]
        | undefined;
      expect(firstCall?.[0]).toMatchObject({
        tool_id: "protection.draft.converse",
        tool_version: "1.0.0",
        arguments: { message: "Protection Dupont" },
      });
      expect(screen.getByTestId("conversational-workspace")).toHaveAttribute(
        "data-live-agent",
        "true",
      );
    },
    15_000,
  );

  it(
    "interrompt réellement la génération, ignore le double clic et permet un nouvel envoi",
    async () => {
      const user = userEvent.setup();
      let firstSignal: AbortSignal | undefined;
      let settleFirst: (() => void) | undefined;
      let callCount = 0;
      const transport = vi.fn(
        (
          _input: Parameters<AgentTransport>[0],
          init?: Parameters<AgentTransport>[1],
        ) => {
          callCount += 1;
          if (callCount === 1) {
            firstSignal = init?.signal;
            return new Promise<AgentToolResult>((resolve) => {
              settleFirst = () =>
                resolve({
                  ok: false,
                  code: "ABORTED",
                  message: "Requête annulée.",
                  httpStatus: 0,
                  retryable: false,
                });
            });
          }
          return Promise.resolve(
            successfulConverseResult("Quel client souhaitez-vous protéger ?"),
          );
        },
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

      await user.type(screen.getByTestId("composer-input"), "Première demande");
      await user.click(screen.getByTestId("composer-send"));

      const stop = await screen.findByRole("button", {
        name: "Arrêter la génération",
      });
      expect(stop).toHaveAttribute("data-testid", "composer-stop");
      expect(firstSignal?.aborted).toBe(false);

      await user.click(stop);
      await user.click(stop);

      expect(firstSignal?.aborted).toBe(true);
      expect(stop).toBeDisabled();
      expect(transport).toHaveBeenCalledTimes(1);

      await act(async () => {
        settleFirst?.();
        await Promise.resolve();
      });

      expect(
        await screen.findByText("Génération interrompue."),
      ).toBeVisible();
      expect(
        screen.queryByText("La connexion a été interrompue."),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("composer-input")).toBeEnabled();

      await user.type(screen.getByTestId("composer-input"), "Deuxième demande");
      await user.click(screen.getByTestId("composer-send"));

      expect(
        await screen.findByText("Quel client souhaitez-vous protéger ?"),
      ).toBeVisible();
      expect(transport).toHaveBeenCalledTimes(2);
    },
    15_000,
  );

  it(
    "annule la requête quittée et ignore sa réponse tardive lors d’un changement de discussion",
    async () => {
      const user = userEvent.setup();
      let secondSignal: AbortSignal | undefined;
      let settleSecond: (() => void) | undefined;
      let callCount = 0;
      const transport = vi.fn(
        (
          _input: Parameters<AgentTransport>[0],
          init?: Parameters<AgentTransport>[1],
        ) => {
          callCount += 1;
          if (callCount === 1) {
            return Promise.resolve(
              successfulConverseResult("Réponse de la première discussion."),
            );
          }
          secondSignal = init?.signal;
          return new Promise<AgentToolResult>((resolve) => {
            settleSecond = () =>
              resolve(successfulConverseResult("Réponse tardive à ignorer."));
          });
        },
      );

      render(
        <ConversationalWorkspace
          userFirstName="Lucie"
          userDisplayName="Lucie Martin"
          demoState="A"
          viewport="desktop"
          forceLiveAgent
          agentTransport={transport as unknown as AgentTransport}
        />,
      );

      await user.type(
        screen.getByTestId("composer-input"),
        "Première discussion",
      );
      await user.click(screen.getByTestId("composer-send"));
      expect(
        await screen.findByText("Réponse de la première discussion."),
      ).toBeVisible();

      const firstConversationTitle = within(
        screen.getByTestId("assistant-sidebar"),
      ).getByText("Première discussion");
      const firstConversationRow = firstConversationTitle.closest<HTMLElement>(
        '[data-testid^="assistant-conversation-"]',
      );
      expect(firstConversationRow).not.toBeNull();
      const firstConversationTestId =
        firstConversationRow?.getAttribute("data-testid");
      expect(firstConversationTestId).toBeTruthy();

      await user.click(screen.getByTestId("sidebar-new-conversation"));
      expect(await screen.findByTestId("welcome-state")).toBeVisible();

      await user.type(screen.getByTestId("composer-input"), "Seconde discussion");
      await user.click(screen.getByTestId("composer-send"));
      await screen.findByTestId("composer-stop");

      const savedFirstRow = screen.getByTestId(firstConversationTestId!);
      await user.click(
        within(savedFirstRow).getAllByRole("button", { hidden: true })[0],
      );

      expect(secondSignal?.aborted).toBe(true);
      expect(
        await screen.findByText("Réponse de la première discussion."),
      ).toBeVisible();

      await act(async () => {
        settleSecond?.();
        await Promise.resolve();
      });
      expect(
        screen.queryByText("Réponse tardive à ignorer."),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Génération interrompue."),
      ).not.toBeInTheDocument();
    },
    15_000,
  );

  it("annule la génération au démontage sans produire d’erreur UI", async () => {
    const user = userEvent.setup();
    let signal: AbortSignal | undefined;
    const transport = vi.fn(
      (
        _input: Parameters<AgentTransport>[0],
        init?: Parameters<AgentTransport>[1],
      ) => {
        signal = init?.signal;
        return new Promise<AgentToolResult>(() => undefined);
      },
    );

    const view = render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        viewport="desktop"
        forceLiveAgent
        agentTransport={transport as unknown as AgentTransport}
      />,
    );

    await user.type(screen.getByTestId("composer-input"), "Demande en cours");
    await user.click(screen.getByTestId("composer-send"));
    await screen.findByTestId("composer-stop");

    view.unmount();

    expect(signal?.aborted).toBe(true);
  });

  it.each([
    ["une session expirée", "AUTHENTICATION_INVALID", /session a expiré/i],
    [
      "une dépendance IA absente",
      "AGENT_DEPENDENCY_UNAVAILABLE",
      /pas pu analyser/i,
    ],
  ])(
    "masque Réessayer pour %s et ne nomme aucun fournisseur",
    async (_label, code, expectedCopy) => {
      const user = userEvent.setup();
      const transport = vi.fn(async () => ({
        ok: false as const,
        code,
        message: "Détail interne masqué.",
        httpStatus: code === "AUTHENTICATION_INVALID" ? 401 : 503,
        retryable: true,
      }));

      render(
        <ConversationalWorkspace
          userFirstName="Lucie"
          userDisplayName="Lucie Martin"
          viewport="desktop"
          forceLiveAgent
          agentTransport={transport as unknown as AgentTransport}
        />,
      );

      await user.type(screen.getByTestId("composer-input"), "Analyse ma demande");
      await user.click(screen.getByTestId("composer-send"));

      expect((await screen.findAllByText(expectedCopy)).length).toBeGreaterThan(
        0,
      );
      expect(screen.queryByTestId("message-retry")).not.toBeInTheDocument();
      expect(
        screen.queryByText(/OpenAI|Anthropic/i),
      ).not.toBeInTheDocument();
    },
    15_000,
  );

  it(
    "affiche une erreur récupérable si le runtime échoue",
    async () => {
      const user = userEvent.setup();
      const transport = vi.fn(async () => ({
        ok: false as const,
        code: "NETWORK_ERROR",
        message: "Le runtime conversationnel est indisponible.",
        httpStatus: 0,
        retryable: true,
      }));

      render(
        <ConversationalWorkspace
          userFirstName="Lucie"
          userDisplayName="Lucie Martin"
          viewport="desktop"
          forceLiveAgent
          agentTransport={transport as AgentTransport}
        />,
      );

      await user.type(screen.getByTestId("composer-input"), "Bonjour");
      await user.click(screen.getByTestId("composer-send"));

    expect(await screen.findByTestId("message-retry")).toBeVisible();
    expect(screen.getByTestId("composer-error")).toBeVisible();
    expect(
      screen.getAllByText(/La connexion a été interrompue/i).length,
    ).toBeGreaterThan(0);
  },
  15_000,
);

  it(
    "signale une réponse vide comme erreur récupérable",
    async () => {
      const user = userEvent.setup();
      const transport = vi.fn(async () => ({
        ok: true as const,
        request_id: "req-empty",
        correlation_id: "corr-empty",
        tool_id: "protection.draft.converse",
        tool_version: "1.0.0",
        output: {},
      }));

      render(
        <ConversationalWorkspace
          userFirstName="Lucie"
          userDisplayName="Lucie Martin"
          viewport="desktop"
          forceLiveAgent
          agentTransport={transport as AgentTransport}
        />,
      );

      await user.type(screen.getByTestId("composer-input"), "Hello");
      await user.click(screen.getByTestId("composer-send"));

      expect(
        (
          await screen.findAllByText(
            /Je n’ai pas pu enregistrer ta demande/i,
          )
        ).length,
      ).toBeGreaterThan(0);
      expect(screen.getByTestId("message-retry")).toBeVisible();
    },
    15_000,
  );

  it("n’enregistre pas un client comme projet tant que l’espace n’est pas accepté", async () => {
    const user = userEvent.setup();

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
      "Thibault client Chiant",
    );
    await user.click(screen.getByTestId("composer-send"));

    expect(
      await screen.findByText(/Créer l’espace « Thibault »/i),
    ).toBeVisible();

    // Sidebar : pas de section projet pour le client tant que non accepté
    // (le titre de discussion peut reprendre le nom du client).
    const sidebar = screen.getByTestId("assistant-sidebar");
    expect(within(sidebar).queryByText("Général")).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByText((_, element) => {
        return (
          element?.tagName === "P" &&
          (element.className.includes("historyGroupLabel") ?? false) &&
          element.textContent === "Thibault"
        );
      }),
    ).toBeNull();
    expect(
      within(sidebar).queryByText((_, element) => {
        return (
          element?.tagName === "P" &&
          (element.className.includes("historyGroupLabel") ?? false) &&
          element.textContent === "Chiant"
        );
      }),
    ).toBeNull();
    expect(within(sidebar).queryByText("Chiant")).toBeNull();

    await user.click(await screen.findByTestId("conversation-organize-trigger"));
    const panel = screen.getByTestId("conversation-organize-panel");
    expect(panel).toBeVisible();
    expect(
      within(panel).getByTestId("conversation-organize-option-general"),
    ).toBeVisible();
    expect(
      within(panel).queryByTestId(/conversation-organize-option-project/),
    ).toBeNull();
    expect(within(panel).queryByText("Thibault")).toBeNull();
    expect(within(panel).queryByText("Chiant")).toBeNull();

    expect(screen.queryByTestId("assistant-new-conversation")).toBeNull();
    expect(
      screen.getByTestId("sidebar-new-conversation"),
    ).toBeVisible();
    expect(screen.queryByTestId("composer-shortcuts")).not.toBeInTheDocument();
  }, 15_000);

  it("classe une discussion via le bouton Organiser", async () => {
    const user = userEvent.setup();

    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="A"
        viewport="desktop"
      />,
    );

    await user.type(screen.getByTestId("composer-input"), "analyse");
    await user.click(screen.getByTestId("composer-send"));

    await user.click(await screen.findByTestId("conversation-organize-trigger"));
    expect(screen.getByTestId("conversation-organize-panel")).toBeVisible();
    await user.click(
      screen.getByTestId("conversation-organize-option-general"),
    );
    expect(
      screen.queryByTestId("conversation-organize-panel"),
    ).not.toBeInTheDocument();
  }, 15_000);

  it("analyse une PJ générale sans afficher de raccourcis immédiats", async () => {
    const user = userEvent.setup();
    const capture = new File(["img"], "Capture d’écran 2026.png", {
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

    await user.upload(screen.getByLabelText("Choisir des fichiers"), capture);
    await user.click(screen.getByTestId("composer-send"));

    expect(
      await within(screen.getByTestId("message-thread")).findByText(
        /L’analyse visuelle sera bientôt disponible/i,
      ),
    ).toBeVisible();
    expect(
      within(screen.getByTestId("message-thread")).getByText(
        /Indiquez-moi ce que vous souhaitez en faire/i,
      ),
    ).toBeVisible();
    expect(
      screen.queryByTestId("message-suggestions"),
    ).not.toBeInTheDocument();
  }, 15_000);

  it("regroupe plusieurs documents dans une seule réponse", async () => {
    const user = userEvent.setup();
    const files = [
      new File(["a"], "contrat.pdf", {
        type: "application/pdf",
        lastModified: 1,
      }),
      new File(["b"], "conditions.pdf", {
        type: "application/pdf",
        lastModified: 2,
      }),
    ];

    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="A"
        viewport="desktop"
      />,
    );

    await user.upload(screen.getByLabelText("Choisir des fichiers"), files);
    await user.click(screen.getByTestId("composer-send"));

    const thread = screen.getByTestId("message-thread");
    expect(
      await within(thread).findByText(
        /J’ai bien reçu vos 2 fichiers : 2 documents PDF/i,
      ),
    ).toBeVisible();
    expect(
      within(thread).getAllByText(
        /J’ai bien reçu vos 2 fichiers : 2 documents PDF/i,
      ),
    ).toHaveLength(1);
  }, 15_000);

  it("recommande la suite en texte sans bouton immédiat après un dépôt", async () => {
    const user = userEvent.setup();
    const invoice = new File(["pdf"], "facture-juillet.pdf", {
      type: "application/pdf",
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

    await user.upload(screen.getByLabelText("Choisir des fichiers"), invoice);
    await user.click(screen.getByTestId("composer-send"));

    expect(
      await within(screen.getByTestId("message-thread")).findByText(
        /Je peux déjà préparer sa protection/i,
      ),
    ).toBeVisible();
    expect(screen.queryByTestId("message-suggestions")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Importer une facture"),
    ).not.toBeInTheDocument();
  }, 15_000);

  it("résout « Protège-les » sur le dernier groupe sans appeler de fournisseur IA", async () => {
    const user = userEvent.setup();
    const transport = vi.fn();
    const invoices = [
      new File(["a"], "facture-a.pdf", {
        type: "application/pdf",
        lastModified: 1,
      }),
      new File(["b"], "facture-b.pdf", {
        type: "application/pdf",
        lastModified: 2,
      }),
    ];

    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="A"
        viewport="desktop"
        forceLiveAgent
        agentTransport={transport as AgentTransport}
      />,
    );

    await user.upload(screen.getByLabelText("Choisir des fichiers"), invoices);
    await user.click(screen.getByTestId("composer-send"));
    expect(
      await screen.findByText(/J’ai bien reçu ces 2 factures/i),
    ).toBeVisible();

    await user.type(screen.getByTestId("composer-input"), "Protège-les");
    await user.click(screen.getByTestId("composer-send"));

    expect(
      await screen.findByText(/J’ai retrouvé les 2 documents concernés/i),
    ).toBeVisible();
    expect(transport).not.toHaveBeenCalled();
  }, 15_000);

  it("affiche la limite de fichiers en toast, pas dans le composer", async () => {
    const user = userEvent.setup();
    const files = Array.from({ length: 7 }, (_, index) =>
      new File([`f-${index}`], `fichier-${index}.pdf`, {
        type: "application/pdf",
        lastModified: index + 1,
      }),
    );

    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="A"
        viewport="desktop"
      />,
    );

    await user.upload(screen.getByLabelText("Choisir des fichiers"), files);
    expect(await screen.findByTestId("workspace-toast")).toHaveTextContent(
      /6 fichiers/i,
    );
    expect(screen.queryByTestId("composer-error")).not.toBeInTheDocument();
  }, 15_000);

  it("édite un message via le composer avec un tag Modification", async () => {
    const user = userEvent.setup();
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="B"
        viewport="desktop"
      />,
    );

    await user.click(screen.getByTestId("message-edit-m-user-1"));

    expect(screen.getByTestId("composer-edit-banner")).toBeVisible();
    expect(screen.getByTestId("composer-edit-banner")).toHaveTextContent(
      "Modification",
    );
    expect(screen.getByTestId("composer-input")).toHaveValue(
      "Je dois recevoir 2 400 € de Dupont Conseil le 12 septembre. Le contact est jean@dupont.fr.",
    );

    fireEvent.input(screen.getByTestId("composer-input"), {
      target: { value: "Message corrigé pour Dupont" },
    });
    expect(screen.getByTestId("composer-input")).toHaveValue(
      "Message corrigé pour Dupont",
    );
    await user.click(screen.getByTestId("composer-send"));

    expect(
      await screen.findByText("Message corrigé pour Dupont"),
    ).toBeVisible();
    expect(
      screen.queryByTestId("composer-edit-banner"),
    ).not.toBeInTheDocument();
  }, 15_000);

  it("annule une modification via le tag du composer", async () => {
    const user = userEvent.setup();
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="B"
        viewport="desktop"
      />,
    );

    await user.click(screen.getByTestId("message-edit-m-user-1"));
    expect(screen.getByTestId("composer-edit-banner")).toBeVisible();

    await user.click(screen.getByTestId("composer-edit-cancel"));

    expect(
      screen.queryByTestId("composer-edit-banner"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("composer-input")).toHaveValue("");
    expect(
      screen.getByText(
        /Je dois recevoir 2 400 € de Dupont Conseil le 12 septembre/i,
      ),
    ).toBeVisible();
  });

  it("crée un projet personnalisé depuis le drawer de la sidebar", async () => {
    const user = userEvent.setup();
    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="B"
        viewport="desktop"
      />,
    );

    await user.click(screen.getByTestId("assistant-create-project"));
    const drawer = screen.getByTestId("project-creation-drawer");
    expect(drawer).toBeVisible();
    expect(screen.queryByTestId("workspace-name-dialog")).not.toBeInTheDocument();
    expect(within(drawer).queryByText(/aperçu/i)).not.toBeInTheDocument();
    expect(
      within(drawer).getByRole("button", { name: "Annuler" }),
    ).toBeVisible();
    expect(
      ["Bleu Sidian", "Violet", "Vert", "Ambre", "Orange", "Rouge corail"].map(
        (label) =>
          within(drawer).getByRole("button", { name: label }),
      ),
    ).toHaveLength(6);
    expect(
      within(drawer).queryByRole("button", { name: "Bleu ciel" }),
    ).not.toBeInTheDocument();

    await user.type(
      within(drawer).getByRole("textbox", { name: /Nom du projet/i }),
      "Alpha Projet",
    );
    await user.click(within(drawer).getByRole("button", { name: "Protection" }));
    await user.click(
      within(drawer).getByRole("button", { name: "Bleu Sidian" }),
    );
    await user.click(screen.getByTestId("project-creation-submit"));

    expect(
      screen.getByTestId("project-creation-drawer-overlay"),
    ).toHaveAttribute("data-open", "false");
    const projectRow = screen
      .getByTestId("assistant-sidebar")
      .querySelector<HTMLButtonElement>(
        '[data-testid^="assistant-project-toggle-project-"]',
      );
    expect(projectRow).not.toBeNull();
    if (!projectRow) throw new Error("project_row_missing");
    expect(projectRow).toHaveTextContent("Alpha Projet");
    const projectIcon = projectRow.querySelector(".lucide-shield-check");
    expect(projectIcon).not.toBeNull();
    expect(
      projectIcon?.parentElement?.style.getPropertyValue("--project-accent"),
    ).toBe("#4f76e8");
    expect(projectRow.querySelector("[style]")).toBe(
      projectIcon?.parentElement,
    );
    const projectGroup = projectRow.closest<HTMLElement>(
      "[data-project-menu-root]",
    );
    if (!projectGroup) throw new Error("project_group_missing");
    expect(
      projectGroup.querySelector('[data-testid^="assistant-conversation-"]'),
    ).toBeNull();
    const discussionsSection = screen
      .getByTestId("assistant-sidebar")
      .querySelector<HTMLElement>(
        'section[aria-label="Historique des discussions"]',
      );
    if (!discussionsSection) {
      throw new Error("discussions_section_missing");
    }
    expect(
      discussionsSection.querySelector(
        '[data-testid^="assistant-conversation-"]',
      ),
    ).not.toBeNull();

    await user.click(screen.getByTestId("conversation-organize-trigger"));
    const organizePanel = screen.getByTestId("conversation-organize-panel");
    const projectOption = organizePanel.querySelector<HTMLButtonElement>(
      '[data-testid^="conversation-organize-option-project-"]',
    );
    if (!projectOption) throw new Error("project_option_missing");
    await user.click(projectOption);
    expect(
      projectGroup.querySelector('[data-testid^="assistant-conversation-"]'),
    ).not.toBeNull();
    expect(
      discussionsSection.querySelector(
        '[data-testid^="assistant-conversation-"]',
      ),
    ).toBeNull();

    const projectMenuTrigger = screen.getByLabelText(
      "Actions pour « Alpha Projet »",
    );
    const projectChevron = projectMenuTrigger.nextElementSibling;
    expect(projectChevron?.getAttribute("data-testid")).toMatch(
      /^assistant-project-chevron-project-/,
    );
    const projectMenu = screen.getByRole("menu", {
      name: "Actions du projet « Alpha Projet »",
      hidden: true,
    });

    expect(projectRow).toHaveAttribute("aria-expanded", "true");
    await user.click(projectMenuTrigger);
    expect(projectRow).toHaveAttribute("aria-expanded", "true");
    expect(projectMenuTrigger).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByTestId("composer-input"));
    expect(projectMenuTrigger).toHaveAttribute("aria-expanded", "false");

    await user.click(projectMenuTrigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(projectMenuTrigger).toHaveAttribute("aria-expanded", "false");
    expect(projectMenuTrigger).toHaveFocus();

    await user.click(projectRow);
    expect(projectRow).toHaveAttribute("aria-expanded", "false");

    if (!projectChevron) throw new Error("project_chevron_missing");
    await user.click(projectChevron);
    expect(projectRow).toHaveAttribute("aria-expanded", "true");

    await user.click(projectMenuTrigger);
    await user.click(
      screen.getByRole("menuitem", { name: "Modifier", hidden: true }),
    );
    expect(projectMenu).toHaveAttribute("data-open", "false");

    const editDrawer = screen.getByTestId("project-creation-drawer");
    const projectNameInput = within(editDrawer).getByRole("textbox", {
      name: /Nom du projet/i,
    });
    expect(projectNameInput).toHaveValue("Alpha Projet");
    expect(
      within(editDrawer).queryByRole("button", { name: "Annuler" }),
    ).not.toBeInTheDocument();
    expect(
      within(editDrawer).getByRole("button", {
        name: "Enregistrer les modifications",
      }),
    ).toBeVisible();

    await user.clear(projectNameInput);
    await user.type(projectNameInput, "Beta Projet");
    await user.click(
      within(editDrawer).getByRole("button", {
        name: "Enregistrer les modifications",
      }),
    );
    expect(projectRow).toHaveTextContent("Beta Projet");

    await user.click(
      screen.getByLabelText("Actions pour « Beta Projet »"),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Dupliquer", hidden: true }),
    );
    expect(
      screen.getByRole("menu", {
        name: "Actions du projet « Beta Projet »",
        hidden: true,
      }),
    ).toHaveAttribute("data-open", "false");
    expect(screen.getByText("Beta Projet — copie")).toBeVisible();
    const duplicateProjectToggle = screen
      .getByText("Beta Projet — copie")
      .closest<HTMLButtonElement>("button");
    if (!duplicateProjectToggle) {
      throw new Error("duplicate_project_toggle_missing");
    }
    const duplicateProjectGroup = duplicateProjectToggle.closest<HTMLElement>(
      "[data-project-menu-root]",
    );
    if (!duplicateProjectGroup) {
      throw new Error("duplicate_project_group_missing");
    }
    expect(
      duplicateProjectGroup.querySelector(
        '[data-testid^="assistant-conversation-"]',
      ),
    ).toBeNull();
    const duplicateProjectIcon = duplicateProjectToggle.querySelector(
      ".lucide-shield-check",
    );
    expect(duplicateProjectIcon).not.toBeNull();
    expect(
      duplicateProjectIcon?.parentElement?.style.getPropertyValue(
        "--project-accent",
      ),
    ).toBe("#4f76e8");
    expect(
      projectGroup.querySelector('[data-testid^="assistant-conversation-"]'),
    ).not.toBeNull();

    await user.click(
      screen.getByLabelText("Actions pour « Beta Projet »"),
    );
    await user.click(
      within(
        screen.getByRole("menu", {
          name: "Actions du projet « Beta Projet »",
          hidden: true,
        }),
      ).getByRole("menuitem", { name: "Supprimer", hidden: true }),
    );
    expect(screen.getByTestId("workspace-confirm-dialog")).toHaveTextContent(
      "1 discussion sera déplacée vers Discussions",
    );
    expect(
      screen.getByLabelText("Actions pour « Beta Projet »"),
    ).toBeInTheDocument();
    expect(
      projectGroup.querySelector('[data-testid^="assistant-conversation-"]'),
    ).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(
      screen.queryByTestId("workspace-confirm-dialog"),
    ).not.toBeInTheDocument();
    expect(
      projectGroup.querySelector('[data-testid^="assistant-conversation-"]'),
    ).not.toBeNull();

    await user.click(
      screen.getByLabelText("Actions pour « Beta Projet »"),
    );
    await user.click(
      within(
        screen.getByRole("menu", {
          name: "Actions du projet « Beta Projet »",
          hidden: true,
        }),
      ).getByRole("menuitem", { name: "Supprimer", hidden: true }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Déplacer les discussions vers Discussions",
      }),
    );
    expect(
      screen.queryByLabelText("Actions pour « Beta Projet »"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Beta Projet — copie")).toBeVisible();
    expect(
      discussionsSection.querySelector(
        '[data-testid^="assistant-conversation-"]',
      ),
    ).not.toBeNull();
    expect(screen.getByTestId("message-thread")).toHaveTextContent(
      /Je dois recevoir 2 400 € de Dupont Conseil/i,
    );

    await user.click(
      screen.getByLabelText("Actions pour « Beta Projet — copie »"),
    );
    await user.click(
      within(
        screen.getByRole("menu", {
          name: "Actions du projet « Beta Projet — copie »",
          hidden: true,
        }),
      ).getByRole("menuitem", { name: "Supprimer", hidden: true }),
    );
    expect(screen.getByTestId("workspace-confirm-dialog")).toHaveTextContent(
      "Ce projet est vide",
    );
    await user.click(
      screen.getByRole("button", { name: "Supprimer le projet" }),
    );
    expect(screen.queryByText("Beta Projet — copie")).not.toBeInTheDocument();
  });

  it("confirme la suppression d’une discussion via un dialogue Sidian", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");

    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        demoState="B"
        viewport="desktop"
        initialConversationHistory={[
          {
            id: "conv-delete-1",
            clientId: null,
            clientName: null,
            projectId: null,
            projectName: null,
            title: "Discussion à supprimer",
            preview: "Aperçu",
            updatedAt: new Date().toISOString(),
          },
        ]}
      />,
    );

    await user.click(
      screen.getByTestId("assistant-conversation-delete-conv-delete-1"),
    );

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("workspace-confirm-dialog")).toBeVisible();
    expect(
      screen.getByText(/Supprimer « Discussion à supprimer »/i),
    ).toBeVisible();

    await user.click(screen.getByTestId("workspace-confirm-dialog-submit"));

    expect(
      screen.queryByTestId("workspace-confirm-dialog"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("assistant-conversation-delete-conv-delete-1"),
    ).not.toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("refuse un projet portant un nom déjà utilisé", async () => {
    const user = userEvent.setup();

    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        viewport="desktop"
        initialConversationProjects={[
          { id: "77777777-7777-4777-8777-777777777777", name: "Alpha Projet" },
        ]}
      />,
    );

    await user.click(screen.getByTestId("assistant-create-project"));
    await user.type(
      screen.getByLabelText("Nom du projet"),
      "  alpha projet  ",
    );
    await user.click(screen.getByTestId("project-creation-submit"));

    expect(screen.getByTestId("workspace-toast")).toHaveTextContent(
      "Un projet « Alpha Projet » existe déjà.",
    );
    // Le tiroir reste ouvert : la saisie n’est pas perdue.
    expect(screen.getByTestId("project-creation-drawer-overlay")).toHaveAttribute(
      "data-open",
      "true",
    );
  });

  it("n’emporte ni brouillon ni parcours client d’une discussion à l’autre", async () => {
    const user = userEvent.setup();
    const otherConversationId = "33333333-3333-4333-8333-333333333333";
    const otherConversation = {
      id: otherConversationId,
      clientId: null,
      clientName: null,
      projectId: null,
      projectName: null,
      title: "Autre discussion",
      preview: "Aperçu",
      updatedAt: new Date().toISOString(),
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (
          url === "/api/assistant/conversations" &&
          init?.method === "POST"
        ) {
          return Response.json(
            {
              conversation: {
                id: "44444444-4444-4444-8444-444444444444",
                clientId: null,
                clientName: null,
                title: "Nouvelle discussion",
                preview: null,
                updatedAt: "2026-07-30T12:00:00.000Z",
              },
            },
            { status: 201 },
          );
        }
        if (url.startsWith(`/api/assistant/conversations/${otherConversationId}`)) {
          if (init?.method === "POST") {
            return new Response(null, { status: 204 });
          }
          return Response.json({ id: otherConversationId, messages: [] });
        }
        if (url.startsWith("/api/assistant/conversations/")) {
          return new Response(null, { status: 204 });
        }
        if (url === "/api/assistant/conversations") {
          return Response.json({ conversations: [otherConversation] });
        }
        if (url === "/api/agent/tools" && init?.method === "POST") {
          return Response.json({
            status: "success",
            request_id: "request-switch",
            correlation_id: "correlation-switch",
            data: {
              tool_id: "protection.draft.converse",
              tool_version: "1.0.0",
              output: {
                draft_id: "55555555-5555-4555-8555-555555555555",
                state: "BROUILLON_INCOMPLET",
                summary: "Réponse de l’agent après changement de discussion.",
                missing_fields: ["client_name"],
                confirmation_nonce: null,
                pending_question: null,
                open_ambiguities: [],
                recap: {
                  client_name: null,
                  client_email: null,
                  expected_amount_minor: null,
                  currency: "EUR",
                  due_date: null,
                  libelle: null,
                  reference_externe: null,
                },
              },
            },
          });
        }
        throw new Error(`Appel inattendu : ${url}`);
      });

    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        viewport="desktop"
        initialConversationHistory={[otherConversation]}
      />,
    );

    await user.click(screen.getByTestId("composer-shortcut-create-client"));
    expect(screen.getByTestId("message-thread")).toHaveTextContent(
      "Quel est le nom du nouveau client ?",
    );
    await user.type(screen.getByTestId("composer-input"), "Brouillon en cours");

    await user.click(
      screen.getByTestId(`assistant-conversation-${otherConversationId}`)
        .querySelector("button")!,
    );

    await waitFor(() => {
      expect(screen.getByTestId("composer-input")).toHaveValue("");
    });

    await user.type(screen.getByTestId("composer-input"), "Bonjour");
    await user.click(screen.getByTestId("composer-send"));

    expect(
      await screen.findByText(
        "Réponse de l’agent après changement de discussion.",
      ),
    ).toBeVisible();
    expect(screen.getByTestId("message-thread")).not.toHaveTextContent(
      "Quel est l’email de Bonjour",
    );

    fetchSpy.mockRestore();
  }, 20_000);

  it("garde le titre saisi d’une discussion encore non persistée", async () => {
    const user = userEvent.setup();
    const invoice = new File(["facture"], "facture-juillet.pdf", {
      type: "application/pdf",
      lastModified: 7,
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Aucun appel attendu"));

    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        viewport="desktop"
      />,
    );

    await user.upload(screen.getByLabelText("Choisir des fichiers"), invoice);
    await user.click(screen.getByTestId("composer-send"));

    expect(await screen.findByTestId("conversation-title-bar")).toBeVisible();

    await user.click(screen.getByTestId("conversation-title-button"));
    const titleInput = screen.getByTestId("conversation-title-input");
    await user.clear(titleInput);
    await user.type(titleInput, "Factures de juillet{Enter}");

    expect(screen.getByTestId("conversation-title-button")).toHaveTextContent(
      "Factures de juillet",
    );
    // Rien à renommer côté serveur : aucune discussion n’y a été créée.
    expect(
      fetchSpy.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
      ),
    ).toHaveLength(0);

    fetchSpy.mockRestore();
  }, 20_000);

  it("ne supprime qu’une fois un projet malgré un double clic de confirmation", async () => {
    const user = userEvent.setup();
    const projectId = "66666666-6666-4666-8666-666666666666";
    const pendingDelete = { release: () => {} };
    const deleteCalls: string[] = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (
          url === `/api/assistant/projects/${projectId}` &&
          init?.method === "DELETE"
        ) {
          deleteCalls.push(url);
          await new Promise<void>((resolve) => {
            pendingDelete.release = resolve;
          });
          return new Response(null, { status: 204 });
        }
        if (url === "/api/assistant/conversations") {
          return Response.json({ conversations: [] });
        }
        throw new Error(`Appel inattendu : ${url}`);
      });

    render(
      <ConversationalWorkspace
        userFirstName="Lucie"
        userDisplayName="Lucie Martin"
        viewport="desktop"
        initialConversationProjects={[{ id: projectId, name: "Alpha Projet" }]}
      />,
    );

    await user.click(screen.getByLabelText("Actions pour « Alpha Projet »"));
    await user.click(
      within(
        screen.getByRole("menu", {
          name: "Actions du projet « Alpha Projet »",
          hidden: true,
        }),
      ).getByRole("menuitem", { name: "Supprimer", hidden: true }),
    );

    const confirm = screen.getByTestId("workspace-confirm-dialog-submit");
    await user.click(confirm);
    await waitFor(() => expect(deleteCalls).toHaveLength(1));

    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(deleteCalls).toHaveLength(1);

    pendingDelete.release();
    await waitFor(() => {
      expect(screen.queryByText("Alpha Projet")).not.toBeInTheDocument();
    });

    fetchSpy.mockRestore();
  }, 20_000);
});
