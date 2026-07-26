"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { AssistantShell } from "./assistant-shell";
import { Composer } from "./composer";
import { ComposerShortcuts } from "./composer-shortcuts";
import { ContextPanel } from "./context-panel";
import { getDemoWorkspaceState } from "./demo-states";
import { MessageThread } from "./message-thread";
import {
  getComposerShortcuts,
  resolveShortcutPhase,
  shouldShowContextPanel,
  shouldShowWelcomeState,
} from "./shortcuts";
import type {
  ActiveContext,
  AssistantMessage,
  AssistantViewport,
  ComposerShortcut,
  ConversationalWorkspaceState,
  DemoStateId,
} from "./types";
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

const DEFAULT_SUMMARY = [
  "3 650 € sont attendus aujourd’hui.",
  "Aucun ne nécessite ton intervention.",
];

type ConversationalWorkspaceProps = {
  userFirstName: string;
  userDisplayName: string;
  demoState?: DemoStateId;
  viewport?: AssistantViewport;
  summaryLines?: string[];
  onShortcutAction?: (action: string) => void;
};

function createMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  summaryLines = DEFAULT_SUMMARY,
  onShortcutAction,
}: ConversationalWorkspaceProps) {
  const measuredViewport = useSyncExternalStore(
    subscribeViewport,
    getViewportSnapshot,
    getServerViewportSnapshot,
  );
  const viewport = viewportProp ?? measuredViewport;

  const [draft, setDraft] = useState("");
  const [lastShortcutAction, setLastShortcutAction] = useState<string | null>(
    null,
  );
  const [workspace, setWorkspace] = useState<ConversationalWorkspaceState>(
    () => (demoState ? getDemoWorkspaceState(demoState) : emptyWorkspace()),
  );
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
    () => getComposerShortcuts(workspace.shortcutPhase),
    [workspace.shortcutPhase],
  );

  const dockRef = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(132);

  useEffect(() => {
    const element = dockRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    const updateHeight = () => {
      setDockHeight(Math.ceil(element.getBoundingClientRect().height));
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [shortcuts, workspace.isGenerating]);

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
    setWorkspace((current) => ({
      ...current,
      isContextPanelOpen: false,
      dismissedContextId: current.activeContext?.id ?? current.dismissedContextId,
    }));
  }, []);

  const appendMessages = useCallback((messages: AssistantMessage[]) => {
    setWorkspace((current) => ({
      ...current,
      messages: [...current.messages, ...messages],
    }));
  }, []);

  const handleSend = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || workspace.isGenerating) return;

      const userMessage: AssistantMessage = {
        id: createMessageId("user"),
        role: "user",
        content: trimmed,
      };

      setDraft("");
      setWorkspace((current) => ({
        ...current,
        messages: [...current.messages, userMessage],
        isGenerating: true,
      }));

      window.setTimeout(() => {
        const assistantMessage: AssistantMessage = {
          id: createMessageId("assistant"),
          role: "assistant",
            content:
              "J’ai noté ta demande.\n\nJe prépare un brouillon — rien n’est créé tant que tu n’as pas confirmé.",
          };
        setWorkspace((current) => ({
          ...current,
          messages: [...current.messages, assistantMessage],
          isGenerating: false,
        }));
      }, 280);
    },
    [workspace.isGenerating],
  );

  const handleShortcut = useCallback(
    (shortcut: ComposerShortcut) => {
      setLastShortcutAction(shortcut.action);
      onShortcutAction?.(shortcut.action);

      if (shortcut.action === "create_protection") {
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
            primaryActionLabel: "Créer la protection",
          },
        };
        appendMessages([
          {
            id: createMessageId("user"),
            role: "user",
            content: shortcut.label,
          },
          {
            id: createMessageId("assistant"),
            role: "assistant",
            content:
              "On prépare une protection.\n\nJ’ai besoin de :\n• ton client\n• le montant\n• la date d’échéance",
            suggestions: ["Exemple Dupont Conseil", "Ajouter un client"],
          },
        ]);
        openContextIfNeeded(context);
        return;
      }

      handleSend(shortcut.label);
    },
    [appendMessages, handleSend, onShortcutAction, openContextIfNeeded],
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

  const contentMaxWidth = "min(100%, 820px)";
  const panelMode =
    viewport === "tablet" ? "overlay" : viewport === "mobile" ? "sheet" : "inline";

  const mobileSheetOpen =
    viewport === "mobile" &&
    workspace.isContextPanelOpen &&
    workspace.activeContext !== null;

  return (
    <AssistantShell userDisplayName={userDisplayName}>
      <div
        data-testid="conversational-workspace"
        data-viewport={viewport}
        data-panel-open={panelVisible ? "true" : "false"}
        data-last-shortcut={lastShortcutAction ?? undefined}
        className="relative flex h-full min-h-0 bg-assistant-bg"
      >
        <section
          data-testid="discussion-pane"
          className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        >
          <div className="hidden px-8 pb-0 pt-4 lg:block">
            <p className="text-[12px] text-assistant-muted/60">Assistant</p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div
              data-testid="conversation-content"
              className="mx-auto flex min-h-full w-full flex-col px-4 py-8 sm:px-8"
              style={{
                maxWidth: contentMaxWidth,
                paddingBottom: dockHeight + 16,
              }}
            >
              <div
                className={`flex flex-1 flex-col ${
                  showWelcome
                    ? "justify-center"
                    : "justify-start pt-4"
                }`}
              >
                <WelcomeState
                  userFirstName={userFirstName}
                  summaryLines={summaryLines}
                  suggestions={[...WELCOME_SUGGESTIONS]}
                  onSuggestion={handleWelcomeSuggestion}
                  visible={showWelcome}
                />
                <MessageThread
                  messages={workspace.messages}
                  onSuggestionSelect={(suggestion) => handleSend(suggestion)}
                />
                {workspace.isGenerating ? (
                  <p
                    data-testid="generating-indicator"
                    className="mt-6 text-[12px] text-assistant-muted/65"
                  >
                    Sidian réfléchit…
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div
            ref={dockRef}
            data-testid="assistant-composer-dock"
            className="assistant-composer-dock absolute left-1/2 z-20 flex w-[min(calc(100%-32px),820px)] -translate-x-1/2 flex-col gap-2 bg-gradient-to-t from-assistant-bg via-assistant-bg to-assistant-bg/80 pt-4"
            style={{
              bottom: "max(8px, env(safe-area-inset-bottom, 0px))",
            }}
          >
            <Composer
              value={draft}
              onChange={setDraft}
              onSubmit={() => handleSend(draft)}
              disabled={workspace.isGenerating}
            />
            <ComposerShortcuts
              shortcuts={shortcuts}
              onSelect={handleShortcut}
              hidden={workspace.isGenerating}
            />
          </div>
        </section>

        {panelVisible && workspace.activeContext?.protection ? (
          <ContextPanel
            open
            mode={panelMode === "overlay" ? "overlay" : "inline"}
            protection={workspace.activeContext.protection}
            onClose={closeContextPanel}
          />
        ) : null}

        {mobileSheetOpen && workspace.activeContext?.protection ? (
          <>
            <button
              type="button"
              aria-label="Fermer le contexte"
              className="fixed inset-0 z-20 bg-black/50"
              onClick={closeContextPanel}
            />
            <ContextPanel
              open
              mode="sheet"
              protection={workspace.activeContext.protection}
              onClose={closeContextPanel}
            />
          </>
        ) : null}
      </div>
    </AssistantShell>
  );
}
