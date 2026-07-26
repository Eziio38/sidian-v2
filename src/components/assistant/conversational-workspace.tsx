"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  GeneratingIndicator,
  IncompleteProtectionNotice,
  OfflineBanner,
  PermissionDenied,
} from "@/components/feedback";
import { UX_COPY } from "@/lib/ux/microcopy";

import {
  callAgentTool,
  type AgentTransport,
} from "./agent-client";
import { AssistantShell } from "./assistant-shell";
import { Composer } from "./composer";
import { ComposerShortcuts } from "./composer-shortcuts";
import { ContextPanel } from "./context-panel";
import {
  asConfirmOutput,
  asConverseOutput,
  buildActiveContextFromConfirm,
  buildActiveContextFromConverse,
  buildAssistantMessageFromConfirm,
  buildAssistantMessageFromConverse,
} from "./converse-adapter";
import { getDemoWorkspaceState } from "./demo-states";
import { MessageThread } from "./message-thread";
import {
  CONSEQUENCE_COPY,
  ProtectionDraftClientError,
  protectionDraftApi,
} from "./protection-panel";
import {
  getComposerShortcuts,
  resolveShortcutPhase,
  shouldShowContextPanel,
  shouldShowWelcomeState,
} from "./shortcuts";
import type {
  ActiveContext,
  AssistantMessage,
  AssistantMessageAction,
  AssistantViewport,
  ComposerShortcut,
  ConversationalWorkspaceState,
  DemoStateId,
} from "./types";
import { FALLBACK_WELCOME_SUMMARY } from "./welcome-summary";
import { WelcomeState } from "./welcome-state";

const WELCOME_SUGGESTIONS = [
  {
    id: "create-protection",
    label: "Créer une protection",
    action: "create_protection",
  },
  {
    id: "view-expected",
    label: "Voir les paiements attendus",
    action: "view_expected_payments",
  },
  {
    id: "add-invoice",
    label: "Ajouter une facture",
    action: "add_invoice",
  },
] as const;

type DraftSession = {
  draftId: string | null;
  confirmationNonce: string | null;
};

type ConversationalWorkspaceProps = {
  userFirstName: string;
  userDisplayName: string;
  demoState?: DemoStateId;
  viewport?: AssistantViewport;
  summaryLines?: string[];
  onShortcutAction?: (action: string) => void;
  /** Transport injectable (tests). Défaut : POST /api/agent/tools. */
  agentTransport?: AgentTransport;
  /** Force le mode live même avec demoState (tests). */
  forceLiveAgent?: boolean;
};

function createMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createIdempotencyKey(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function viewportFromWidth(width: number): AssistantViewport {
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

function subscribeViewport(onStoreChange: () => void) {
  window.addEventListener("resize", onStoreChange);
  return () => window.removeEventListener("resize", onStoreChange);
}

function getViewportSnapshot(): AssistantViewport {
  return viewportFromWidth(window.innerWidth);
}

function getServerViewportSnapshot(): AssistantViewport {
  return "desktop";
}

function emptyWorkspace(): ConversationalWorkspaceState {
  return {
    messages: [],
    activeContext: null,
    isContextPanelOpen: false,
    isGenerating: false,
    dismissedContextId: null,
    shortcutPhase: "default",
  };
}

export function ConversationalWorkspace({
  userFirstName,
  userDisplayName,
  demoState,
  viewport: viewportProp,
  summaryLines = [...FALLBACK_WELCOME_SUMMARY],
  onShortcutAction,
  agentTransport = callAgentTool,
  forceLiveAgent = false,
}: ConversationalWorkspaceProps) {
  const router = useRouter();
  const measuredViewport = useSyncExternalStore(
    subscribeViewport,
    getViewportSnapshot,
    getServerViewportSnapshot,
  );
  const viewport = viewportProp ?? measuredViewport;
  const liveAgent = forceLiveAgent || !demoState;

  const [draft, setDraft] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [permissionNotice, setPermissionNotice] = useState(false);
  const [lastShortcutAction, setLastShortcutAction] = useState<string | null>(
    null,
  );
  const [workspace, setWorkspace] = useState<ConversationalWorkspaceState>(
    () => (demoState ? getDemoWorkspaceState(demoState) : emptyWorkspace()),
  );
  const [draftSession, setDraftSession] = useState<DraftSession>({
    draftId: null,
    confirmationNonce: null,
  });
  const [panelBusy, setPanelBusy] = useState(false);
  const [panelActionError, setPanelActionError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const showWelcome = shouldShowWelcomeState({
    messagesLength: workspace.messages.length,
    isGenerating: workspace.isGenerating,
    activeContext: workspace.activeContext,
  });

  const panelVisible = shouldShowContextPanel({
    activeContext: workspace.activeContext,
    isContextPanelOpen: workspace.isContextPanelOpen,
    viewport,
  });

  const shortcuts = useMemo(
    () =>
      getComposerShortcuts(workspace.shortcutPhase, {
        includeReopenPanel: Boolean(
          workspace.activeContext?.protection &&
            !workspace.isContextPanelOpen,
        ),
      }),
    [
      workspace.activeContext?.protection,
      workspace.isContextPanelOpen,
      workspace.shortcutPhase,
    ],
  );

  const dockRef = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(132);

  useEffect(() => {
    const element = dockRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    const updateHeight = () => {
      const next = Math.ceil(element.getBoundingClientRect().height);
      setDockHeight((current) => (current === next ? current : next));
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [shortcuts, workspace.isGenerating, draft, composerError]);

  const [keyboardOffset, setKeyboardOffset] = useState(0);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    if (!visualViewport) return;

    const updateKeyboardOffset = () => {
      const inset = Math.max(
        0,
        window.innerHeight - visualViewport.height - visualViewport.offsetTop,
      );
      setKeyboardOffset(inset);
    };

    updateKeyboardOffset();
    visualViewport.addEventListener("resize", updateKeyboardOffset);
    visualViewport.addEventListener("scroll", updateKeyboardOffset);
    return () => {
      visualViewport.removeEventListener("resize", updateKeyboardOffset);
      visualViewport.removeEventListener("scroll", updateKeyboardOffset);
    };
  }, []);

  useEffect(() => {
    if (showWelcome) return;
    const end = threadEndRef.current;
    if (!end || typeof end.scrollIntoView !== "function") return;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    end.scrollIntoView({
      block: "end",
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [workspace.messages, workspace.isGenerating, showWelcome]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const openContextIfNeeded = useCallback((context: ActiveContext) => {
    setWorkspace((current) => {
      if (!context) {
        return {
          ...current,
          activeContext: null,
          shortcutPhase: "default",
        };
      }

      const dismissedSame = current.dismissedContextId === context.id;
      const shouldOpen = !dismissedSame;
      return {
        ...current,
        activeContext: context,
        isContextPanelOpen: shouldOpen ? true : current.isContextPanelOpen,
        shortcutPhase: resolveShortcutPhase(context),
      };
    });
  }, []);

  const closeContextPanel = useCallback(() => {
    // Fermeture visuelle uniquement — le brouillon / contexte actif est conservé.
    setPanelActionError(null);
    setWorkspace((current) => ({
      ...current,
      isContextPanelOpen: false,
      dismissedContextId: current.activeContext?.id ?? current.dismissedContextId,
    }));
  }, []);

  const reopenContextPanel = useCallback(() => {
    setPanelActionError(null);
    setWorkspace((current) => {
      if (!current.activeContext?.protection) return current;
      return {
        ...current,
        isContextPanelOpen: true,
        dismissedContextId: null,
      };
    });
  }, []);

  const appendErrorMessage = useCallback(
    (params: { content: string; errorMessage: string; retryContent: string }) => {
      const errorMessage: AssistantMessage = {
        id: createMessageId("error"),
        role: "assistant",
        content: params.content,
        status: "error",
        errorMessage: params.errorMessage,
        retryContent: params.retryContent,
      };
      setWorkspace((current) => ({
        ...current,
        messages: [...current.messages, errorMessage],
        isGenerating: false,
      }));
    },
    [],
  );

  const runConverse = useCallback(
    async (userText: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const argumentsPayload: Record<string, unknown> = {
        message: userText,
      };
      if (draftSession.draftId) {
        argumentsPayload.draft_id = draftSession.draftId;
      }

      const result = await agentTransport(
        {
          tool_id: "protection.draft.converse",
          tool_version: "1.0.0",
          mode: "agir",
          requested_autonomy_level: 2,
          arguments: argumentsPayload,
          idempotency_key: createIdempotencyKey("converse"),
        },
        { signal: controller.signal },
      );

      if (!result.ok) {
        if (result.code === "ABORTED") return;
        if (
          result.code === "PERMISSION_DENIED" ||
          result.code === "TENANT_ACCESS_DENIED" ||
          result.code === "permission_denied"
        ) {
          setPermissionNotice(true);
          setComposerError(UX_COPY.permissionDenied.title);
          setWorkspace((current) => ({ ...current, isGenerating: false }));
          return;
        }
        setPermissionNotice(false);
        setComposerError(result.message);
        appendErrorMessage({
          content: UX_COPY.errorLoad.title,
          errorMessage: result.message,
          retryContent: userText,
        });
        return;
      }

      const rawOutput = result.output as Record<string, unknown>;
      if (!rawOutput || Object.keys(rawOutput).length === 0) {
        setComposerError("Réponse vide — réessaie dans un instant.");
        appendErrorMessage({
          content: "Sidian n’a rien renvoyé.",
          errorMessage: "Réponse vide — réessaie dans un instant.",
          retryContent: userText,
        });
        return;
      }

      const output = asConverseOutput(rawOutput);
      if (!output) {
        setComposerError("Le format de réponse est invalide.");
        appendErrorMessage({
          content: "Réponse inattendue du runtime.",
          errorMessage: "Le format de réponse est invalide.",
          retryContent: userText,
        });
        return;
      }

      setComposerError(null);
      setPermissionNotice(false);
      setDraftSession({
        draftId: output.draft_id,
        confirmationNonce: output.confirmation_nonce,
      });

      const assistantMessage = buildAssistantMessageFromConverse({
        messageId: createMessageId("assistant"),
        output,
      });

      if (!assistantMessage.content.trim()) {
        setComposerError("Réponse vide — réessaie dans un instant.");
        appendErrorMessage({
          content: "Sidian n’a rien renvoyé.",
          errorMessage: "Réponse vide — réessaie dans un instant.",
          retryContent: userText,
        });
        return;
      }

      const context = buildActiveContextFromConverse(output);

      setWorkspace((current) => ({
        ...current,
        messages: [...current.messages, assistantMessage],
        isGenerating: false,
        activeContext: context,
        isContextPanelOpen:
          current.dismissedContextId === context.id
            ? current.isContextPanelOpen
            : true,
        shortcutPhase: resolveShortcutPhase(context),
      }));
    },
    [agentTransport, appendErrorMessage, draftSession.draftId],
  );

  const runConfirm = useCallback(async () => {
    if (!draftSession.draftId || !draftSession.confirmationNonce) {
      appendErrorMessage({
        content: "Impossible de confirmer pour le moment.",
        errorMessage: "Le brouillon n’est pas prêt pour confirmation.",
        retryContent: "",
      });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setWorkspace((current) => ({
      ...current,
      isGenerating: true,
    }));

    const result = await agentTransport(
      {
        tool_id: "protection.draft.confirm",
        tool_version: "1.0.0",
        mode: "agir",
        requested_autonomy_level: 2,
        arguments: {
          draft_id: draftSession.draftId,
          explicit_confirmation: true,
          confirmation_nonce: draftSession.confirmationNonce,
        },
        idempotency_key: createIdempotencyKey("confirm"),
      },
      { signal: controller.signal },
    );

    if (!result.ok) {
      if (result.code === "ABORTED") return;
      if (
        result.code === "PERMISSION_DENIED" ||
        result.code === "TENANT_ACCESS_DENIED" ||
        result.code === "permission_denied"
      ) {
        setPermissionNotice(true);
        setComposerError(UX_COPY.permissionDenied.title);
        setWorkspace((current) => ({ ...current, isGenerating: false }));
        return;
      }
      setPermissionNotice(false);
      setComposerError(result.message);
      appendErrorMessage({
        content: UX_COPY.errorGeneric.title,
        errorMessage: result.message,
        retryContent: "",
      });
      return;
    }

    const output = asConfirmOutput(result.output as Record<string, unknown>);
    if (!output) {
      appendErrorMessage({
        content: "Confirmation reçue, mais illisible.",
        errorMessage: "Le format de réponse est invalide.",
        retryContent: "",
      });
      return;
    }

    const previousProtection = workspace.activeContext?.protection ?? null;
    const assistantMessage = buildAssistantMessageFromConfirm({
      messageId: createMessageId("assistant"),
      output,
      clientName: previousProtection?.clientName,
    });
    const context = buildActiveContextFromConfirm({
      output,
      previous: previousProtection,
    });

    setDraftSession({ draftId: null, confirmationNonce: null });
    setWorkspace((current) => ({
      ...current,
      messages: [...current.messages, assistantMessage],
      isGenerating: false,
      activeContext: context,
      isContextPanelOpen: true,
      dismissedContextId: null,
      shortcutPhase: resolveShortcutPhase(context),
    }));
  }, [
    agentTransport,
    appendErrorMessage,
    draftSession.confirmationNonce,
    draftSession.draftId,
    workspace.activeContext?.protection,
  ]);

  const handleSend = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || workspace.isGenerating) return;

      const userMessage: AssistantMessage = {
        id: createMessageId("user"),
        role: "user",
        content: trimmed,
        status: "sent",
      };

      setDraft("");
      setComposerError(null);
      setPermissionNotice(false);
      setWorkspace((current) => ({
        ...current,
        messages: [...current.messages, userMessage],
        isGenerating: true,
      }));

      if (!liveAgent) {
        window.setTimeout(() => {
          const assistantMessage: AssistantMessage = {
            id: createMessageId("assistant"),
            role: "assistant",
            content:
              "J’ai noté ta demande.\n\nJe prépare un brouillon — rien n’est créé tant que tu n’as pas confirmé.",
            status: "sent",
          };
          setWorkspace((current) => ({
            ...current,
            messages: [...current.messages, assistantMessage],
            isGenerating: false,
          }));
        }, 280);
        return;
      }

      void runConverse(trimmed);
    },
    [liveAgent, runConverse, workspace.isGenerating],
  );

  const handleShortcut = useCallback(
    (shortcut: ComposerShortcut) => {
      setLastShortcutAction(shortcut.action);
      onShortcutAction?.(shortcut.action);

      if (shortcut.action === "reopen_protection_panel") {
        reopenContextPanel();
        return;
      }

      if (shortcut.action === "view_expected_payments") {
        router.push("/app/paiements-a-recevoir");
        return;
      }

      if (shortcut.action === "view_protection") {
        const href = workspace.activeContext?.protection
          ? workspace.messages
              .slice()
              .reverse()
              .find((message) => message.protectionId)?.protectionId
          : null;
        if (href) {
          router.push(`/app/paiements-a-recevoir/${href}`);
          return;
        }
        router.push("/app/paiements-a-recevoir");
        return;
      }

      if (
        shortcut.action === "create_protection" ||
        shortcut.action === "add_invoice" ||
        shortcut.action === "add_another_invoice"
      ) {
        if (!liveAgent) {
          const context: ActiveContext = {
            id: `ctx-draft-${Date.now()}`,
            type: "protection_draft",
            protection: {
              clientName: "Nouveau client",
              statusLabel: "Brouillon",
              status: "draft",
              amountLabel: "—",
              subject: "À préciser",
              dueDateLabel: "À préciser",
              nextStepLabel: "Compléter le brouillon",
              consequenceLabel: CONSEQUENCE_COPY.draft,
              primaryActionLabel: "Créer la protection",
              secondaryActionLabel: "Annuler le brouillon",
            },
          };
          setWorkspace((current) => ({
            ...current,
            messages: [
              ...current.messages,
              {
                id: createMessageId("user"),
                role: "user",
                content: shortcut.label,
                status: "sent",
              },
              {
                id: createMessageId("assistant"),
                role: "assistant",
                content:
                  "On prépare une protection.\n\nJ’ai besoin de :\n• ton client\n• le montant\n• la date d’échéance",
                suggestions: ["Exemple Dupont Conseil", "Ajouter un client"],
                status: "sent",
              },
            ],
          }));
          openContextIfNeeded(context);
          return;
        }

        handleSend(
          shortcut.action === "create_protection"
            ? "Je veux créer une protection"
            : "Je veux ajouter une facture",
        );
        return;
      }

      if (
        shortcut.action === "edit_amount" ||
        shortcut.action === "change_due_date" ||
        shortcut.action === "add_contact"
      ) {
        const prompts: Record<string, string> = {
          edit_amount: "Je veux modifier le montant",
          change_due_date: "Je veux changer l’échéance",
          add_contact: "Je veux ajouter le contact client",
        };
        handleSend(prompts[shortcut.action] ?? shortcut.label);
        return;
      }

      handleSend(shortcut.label);
    },
    [
      handleSend,
      liveAgent,
      onShortcutAction,
      openContextIfNeeded,
      reopenContextPanel,
      router,
      workspace.activeContext?.protection,
      workspace.messages,
    ],
  );

  const handleWelcomeSuggestion = useCallback(
    (action: string) => {
      const match = WELCOME_SUGGESTIONS.find((item) => item.action === action);
      if (!match) return;
      handleShortcut({
        id: match.id,
        label: match.label,
        action: match.action,
        emphasis: match.id === "create-protection" ? "primary" : "default",
      });
    },
    [handleShortcut],
  );

  const handleMessageAction = useCallback(
    (action: AssistantMessageAction, message: AssistantMessage) => {
      if (action.kind === "retry") {
        const retryContent = message.retryContent?.trim();
        if (!retryContent) return;
        setWorkspace((current) => ({
          ...current,
          messages: current.messages.filter((item) => item.id !== message.id),
        }));
        handleSend(retryContent);
        return;
      }

      if (action.kind === "confirm_protection") {
        void runConfirm();
        return;
      }

      if (action.kind === "open_protection" && action.href) {
        router.push(action.href);
      }
    },
    [handleSend, router, runConfirm],
  );

  const handlePrimaryContextAction = useCallback(() => {
    setPanelActionError(null);
    if (workspace.activeContext?.type === "protection") {
      const protectionId = workspace.messages
        .slice()
        .reverse()
        .find((message) => message.protectionId)?.protectionId;
      router.push(
        protectionId
          ? `/app/paiements-a-recevoir/${protectionId}`
          : "/app/paiements-a-recevoir",
      );
      return;
    }

    if (
      workspace.activeContext?.type === "protection_draft" &&
      draftSession.confirmationNonce
    ) {
      void runConfirm();
    }
  }, [
    draftSession.confirmationNonce,
    router,
    runConfirm,
    workspace.activeContext?.type,
    workspace.messages,
  ]);

  const handleSecondaryContextAction = useCallback(async () => {
    const draftId =
      draftSession.draftId ??
      workspace.activeContext?.protection?.draftId ??
      null;
    if (!draftId || !liveAgent) {
      // Démo / sans brouillon backend : ferme le panneau mais conserve le contexte.
      closeContextPanel();
      return;
    }

    setPanelBusy(true);
    setPanelActionError(null);
    try {
      await protectionDraftApi.cancel(
        { draftId },
        { transport: agentTransport },
      );
      setDraftSession({ draftId: null, confirmationNonce: null });
      setWorkspace((current) => ({
        ...current,
        activeContext: null,
        isContextPanelOpen: false,
        dismissedContextId: null,
        shortcutPhase: "default",
      }));
    } catch (error) {
      const message =
        error instanceof ProtectionDraftClientError
          ? error.message
          : "Impossible d’annuler le brouillon pour le moment.";
      setPanelActionError(message);
    } finally {
      setPanelBusy(false);
    }
  }, [
    agentTransport,
    closeContextPanel,
    draftSession.draftId,
    liveAgent,
    workspace.activeContext?.protection?.draftId,
  ]);

  const contentMaxWidth = "min(100%, 820px)";
  const panelMode =
    viewport === "tablet" ? "overlay" : viewport === "mobile" ? "sheet" : "inline";

  const mobileSheetOpen =
    viewport === "mobile" &&
    workspace.isContextPanelOpen &&
    workspace.activeContext !== null;

  const welcomeSuggestions = WELCOME_SUGGESTIONS.slice(0, 3);

  const incompleteDraft =
    workspace.activeContext?.type === "protection_draft" &&
    workspace.activeContext.protection?.status === "draft";

  const panelProps = workspace.activeContext?.protection
    ? {
        open: true as const,
        protection: workspace.activeContext.protection,
        onClose: closeContextPanel,
        onPrimaryAction: handlePrimaryContextAction,
        onSecondaryAction: handleSecondaryContextAction,
        busy: panelBusy || workspace.isGenerating,
        actionError: panelActionError,
      }
    : null;

  return (
    <AssistantShell userDisplayName={userDisplayName}>
      <div
        data-testid="conversational-workspace"
        data-viewport={viewport}
        data-panel-open={panelVisible ? "true" : "false"}
        data-live-agent={liveAgent ? "true" : "false"}
        data-last-shortcut={lastShortcutAction ?? undefined}
        className="relative flex h-full min-h-0 bg-assistant-bg"
      >
        <section
          id="assistant-discussion"
          data-testid="discussion-pane"
          className="relative flex min-h-0 min-w-0 flex-1 flex-col"
          aria-label="Discussion"
        >
          <div className="hidden px-8 pb-0 pt-4 lg:block">
            <p className="text-[12px] text-assistant-muted">Assistant</p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div
              data-testid="conversation-content"
              className="mx-auto flex min-h-full w-full flex-col px-3 py-6 min-[320px]:px-4 sm:px-8 sm:py-8"
              style={{
                maxWidth: contentMaxWidth,
                paddingBottom: dockHeight + keyboardOffset + 24,
                paddingTop: "max(1.5rem, env(safe-area-inset-top, 0px))",
              }}
            >
              <div
                className={`flex flex-1 flex-col ${
                  showWelcome ? "justify-center" : "justify-start pt-4 max-md:pt-12"
                }`}
              >
                <WelcomeState
                  userFirstName={userFirstName}
                  summaryLines={summaryLines}
                  suggestions={[...welcomeSuggestions]}
                  onSuggestion={handleWelcomeSuggestion}
                  visible={showWelcome}
                />
                <MessageThread
                  messages={workspace.messages}
                  onSuggestionSelect={(suggestion) => handleSend(suggestion)}
                  onAction={handleMessageAction}
                />
                {workspace.isGenerating ? (
                  <GeneratingIndicator className="mt-6" />
                ) : null}
                <div ref={threadEndRef} aria-hidden className="h-px w-full" />
              </div>
            </div>
          </div>

          <div
            ref={dockRef}
            data-testid="assistant-composer-dock"
            className="assistant-composer-dock absolute left-1/2 z-20 flex w-[min(calc(100%-16px),820px)] min-[360px]:w-[min(calc(100%-32px),820px)] -translate-x-1/2 flex-col gap-2 bg-gradient-to-t from-assistant-bg via-assistant-bg to-assistant-bg/80 pt-4 pb-2"
            style={{
              bottom: `calc(${keyboardOffset}px + max(8px, env(safe-area-inset-bottom, 0px)))`,
            }}
          >
            <OfflineBanner surface="dark" />
            {permissionNotice ? <PermissionDenied surface="dark" /> : null}
            {incompleteDraft && !permissionNotice ? (
              <IncompleteProtectionNotice surface="dark" />
            ) : null}
            <Composer
              value={draft}
              onChange={(value) => {
                setDraft(value);
                if (composerError) setComposerError(null);
              }}
              onSubmit={() => handleSend(draft)}
              disabled={workspace.isGenerating}
              isLoading={workspace.isGenerating}
              error={composerError}
            />
            <ComposerShortcuts
              shortcuts={shortcuts}
              onSelect={handleShortcut}
              hidden={workspace.isGenerating}
            />
          </div>
        </section>

        {/* panelProps : callbacks stables — faux positif react-hooks/refs sur le spread */}
        {/* eslint-disable-next-line react-hooks/refs -- panelProps is plain state + callbacks, not a ref */}
        {panelVisible && panelProps ? (
          <ContextPanel
            {...panelProps}
            mode={panelMode === "overlay" ? "overlay" : "inline"}
          />
        ) : null}

        {/* eslint-disable-next-line react-hooks/refs -- same as above */}
        {mobileSheetOpen && panelProps ? (
          <>
            <button
              type="button"
              aria-label="Fermer le contexte"
              className="fixed inset-0 z-20 bg-black/50"
              onClick={closeContextPanel}
            />
            <ContextPanel {...panelProps} mode="sheet" />
          </>
        ) : null}
      </div>
    </AssistantShell>
  );
}
