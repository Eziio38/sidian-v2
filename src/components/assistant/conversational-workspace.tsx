"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";

import { AppShell } from "@/components/app/app-shell";
import type {
  ProjectDrawerAnchor,
  SidebarOnboardingFacts,
} from "@/components/app/app-sidebar";
import {
  GeneratingIndicator,
  OfflineBanner,
  PermissionDenied,
} from "@/components/feedback";
import { UX_COPY } from "@/lib/ux/microcopy";

import {
  callAgentTool,
  type AgentTransport,
} from "./agent-client";
import { createClientPayeurAction } from "@/app/actions/clients-creances";

import {
  createAssistantProject,
  createAssistantConversation,
  deleteAssistantProject,
  deleteAssistantConversation,
  fetchConversationHistory,
  fetchConversationMessages,
  organizeAssistantConversation,
  persistAssistantConversationTurn,
  renameAssistantConversation,
  updateAssistantProject,
} from "./conversation-client";
import {
  CONVERSATION_TITLE_MAX_LENGTH,
  deriveConversationPreview,
  deriveConversationTitle,
  isMeaningfulLabel as isMeaningfulConversationLabel,
} from "./conversation-title";
import {
  COMPOSER_MAX_FILES,
  COMPOSER_PLACEHOLDER,
  WELCOME_COMPOSER_PLACEHOLDER,
  buildComposerFileLimitMessage,
  Composer,
} from "./composer";
import { ComposerShortcuts } from "./composer-shortcuts";
import {
  buildConversationOrganizeOptions,
  ConversationOrganize,
  type ConversationOrganizeOption,
} from "./conversation-organize";
import { ConversationTitleBar } from "./conversation-title-bar";
import {
  ConversationResources,
  extractConversationLinks,
} from "./conversation-resources";
import resourceStyles from "./conversation-resources.module.css";
import {
  buildAttachmentReceiptReply,
  classifyDocumentAttachment,
  getAttachmentExtension,
  validateDocumentFiles,
} from "./document-attachments";
import {
  buildResolvedDocumentReply,
  resolveDocumentRequest,
} from "./document-reference";
import { WorkspaceConfirmDialog } from "./workspace-confirm-dialog";
import { ProjectCreationDrawer } from "./project-creation-drawer";
import {
  DEFAULT_PROJECT_PERSONALIZATION,
  type ProjectCreationDraft,
} from "./project-personalization";
import { WorkspaceToast } from "./workspace-toast";
import {
  buildClientPaymentSuggestions,
  upsertKnownClient,
  type KnownClient,
} from "./known-clients";
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
  SUGGESTION_CLIENT_NAME,
  SUGGESTION_CREATE_CLIENT,
  SUGGESTION_ENTER_EMAIL,
  SUGGESTION_OTHER_AMOUNT,
  SUGGESTION_PICK_DATE,
  SUGGESTION_STAY_IN_GENERAL,
  isValidSuggestionEmail,
  parseCreateClientSpaceSuggestion,
  suggestionCreateClientSpace,
} from "./message-suggestions";
import {
  clientSpaceKey,
  findProjectByName,
  shouldOfferClientSpace,
} from "./client-space";
import { matchWelcomeQuickAction } from "./match-welcome-quick-action";
import { parseProtectionIntent } from "./parse-protection-intent";
import {
  hasInvoiceAttachmentIntent,
  summarizeInvoiceAttachments,
} from "./invoice-attachment";
import {
  CONSEQUENCE_COPY,
  ProtectionPanel,
  protectionDraftApi,
} from "./protection-panel";
import {
  resolveShortcutPhase,
  shouldShowContextPanel,
  shouldShowWelcomeState,
} from "./shortcuts";
import type {
  ActiveContext,
  ActiveContextData,
  AssistantMessage,
  AssistantMessageAction,
  AssistantViewport,
  ComposerShortcut,
  ConversationHistoryItem,
  ConversationProject,
  ConversationalWorkspaceState,
  DemoStateId,
  MessageAttachment,
  MessageFeedback,
  PaymentSummaryData,
} from "./types";
import {
  FALLBACK_WELCOME_SUMMARY,
  resolveWelcomeDataState,
  type WelcomeDataState,
} from "./welcome-summary";
import { WelcomeState } from "./welcome-state";
import type { WelcomeBriefCard } from "./welcome-state";
import { cx } from "@/design-system/utils";
import styles from "./conversational-workspace.module.css";

/** Accueil : quatre intentions sous le composer. */
const WELCOME_SUGGESTIONS = [
  {
    id: "create-protection",
    label: "Protéger une facture",
    action: "create_protection",
    emphasis: "default" as const,
  },
  {
    id: "add-invoice",
    label: "Analyser un document",
    action: "add_invoice",
    emphasis: "default" as const,
  },
  {
    id: "create-client",
    label: "Ajouter un client",
    action: "create_client",
    emphasis: "default" as const,
  },
  {
    id: "view-expected",
    label: "Faire le point sur mes paiements",
    action: "view_expected_payments",
    emphasis: "default" as const,
  },
] as const;

const CREATE_PROTECTION_PROMPT =
  "Je veux créer une protection. Pose-moi les questions une par une pour recueillir le client, le montant et l’échéance.";

type InitialWorkspaceAction = "create_protection";

function isFilledLabel(value: string | undefined | null): boolean {
  if (!value) return false;
  const t = value.trim();
  return t.length > 0 && t !== "—" && t !== "À préciser";
}

function paymentCountLabel(count: number): string {
  return `${count} paiement${count > 1 ? "s" : ""}`;
}

function buildPaymentsSummaryMessage(
  summary: PaymentSummaryData | undefined,
  briefCards: WelcomeBriefCard[] | undefined,
): AssistantMessage {
  const expected = briefCards?.find((card) => card.id === "expected");
  const next = briefCards?.find((card) => card.id === "next");

  const confirmed = summary
    ? `${paymentCountLabel(summary.confirmedCount)} · ${summary.confirmedAmountLabel}`
    : "Détail indisponible";
  const processing = summary
    ? `${paymentCountLabel(summary.processingCount)} · ${summary.processingAmountLabel}`
    : "Détail indisponible";
  const upcoming = summary
    ? `${paymentCountLabel(summary.upcomingCount)} · ${summary.upcomingAmountLabel}`
    : `${expected?.value ?? "À préciser"} attendus`;
  const nextPayment =
    summary?.nextPaymentLabel ??
    [next?.value, next?.hint].filter(isFilledLabel).join(" · ");

  return {
    id: createMessageId("assistant"),
    role: "assistant",
    content: [
      "Voici la synthèse de tes paiements.",
      `• Validés : ${confirmed}`,
      `• En cours : ${processing}`,
      `• À venir : ${upcoming}`,
      nextPayment ? `\nProchain paiement : ${nextPayment}.` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    status: "sent",
    actions: [
      {
        id: "view-payments",
        label: "Consulter les paiements",
        kind: "open_protection",
        href: "/app/paiements",
      },
    ],
  };
}

/**
 * Panneau ouvert seulement quand utile — pas au premier clic / brouillon vide.
 */
function shouldAutoOpenProtectionPanel(context: ActiveContext): boolean {
  if (!context?.protection) return false;
  const { protection } = context;
  if (
    protection.status === "active" ||
    protection.status === "blocked" ||
    protection.status === "error"
  ) {
    return true;
  }
  if (protection.confirmationNonce) return true;
  return (
    isFilledLabel(protection.clientName) &&
    isFilledLabel(protection.amountLabel) &&
    isFilledLabel(protection.dueDateLabel)
  );
}

function buildDemoReplyFromParsedIntent(
  intent: NonNullable<ReturnType<typeof parseProtectionIntent>>,
  currentContext: ActiveContext,
  clientSuggestions: string[],
): { message: AssistantMessage; context: ActiveContextData } {
  const baseProtection = currentContext?.protection ?? {
    clientName: "À préciser",
    statusLabel: "Brouillon",
    status: "draft" as const,
    amountLabel: "À préciser",
    subject: "À préciser",
    dueDateLabel: "À préciser",
    nextStepLabel: "Il me manque encore quelques informations.",
    consequenceLabel: CONSEQUENCE_COPY.draft,
    primaryActionLabel: "Continuer la protection",
    secondaryActionLabel: "Annuler le brouillon",
  };

  const protection = {
    ...baseProtection,
    ...(intent.clientName ? { clientName: intent.clientName } : {}),
    ...(intent.amountLabel ? { amountLabel: intent.amountLabel } : {}),
    ...(intent.dueDateLabel ? { dueDateLabel: intent.dueDateLabel } : {}),
  };

  const clientReady = isFilledLabel(protection.clientName);
  const amountReady = isFilledLabel(protection.amountLabel);
  const dueReady = isFilledLabel(protection.dueDateLabel);

  if (clientReady && amountReady && dueReady) {
    protection.statusLabel = "À confirmer";
    protection.nextStepLabel = undefined;
    const context: ActiveContext = {
      id: currentContext?.id ?? `ctx-draft-${Date.now()}`,
      type: "protection_draft",
      protection,
    };
    return {
      context,
      message: {
        id: createMessageId("assistant"),
        role: "assistant",
        content: `J’ai créé le client ${protection.clientName} et préparé la protection.\n\nRécapitulatif : ${protection.clientName} · ${protection.amountLabel} · ${protection.dueDateLabel}.\n\nRien ne sera créé sans ta confirmation.`,
        suggestions: [
          "Confirmer la protection",
          "Modifier le montant",
          "Changer l’échéance",
        ],
        status: "sent",
      },
    };
  }

  const context: ActiveContext = {
    id: currentContext?.id ?? `ctx-draft-${Date.now()}`,
    type: "protection_draft",
    protection,
  };

  if (!clientReady) {
    return {
      context,
      message: {
        id: createMessageId("assistant"),
        role: "assistant",
        content: "Qui doit te payer ?",
        suggestions: clientSuggestions,
        status: "sent",
      },
    };
  }

  if (!amountReady) {
    return {
      context,
      message: {
        id: createMessageId("assistant"),
        role: "assistant",
        content: `Parfait, je retiens ${protection.clientName}. Quel montant veux-tu sécuriser ?`,
        suggestions: ["1 000 €", "2 500 €", SUGGESTION_OTHER_AMOUNT],
        status: "sent",
      },
    };
  }

  return {
    context,
    message: {
      id: createMessageId("assistant"),
      role: "assistant",
      content:
        "Très bien. Quelle est la date d’échéance prévue pour ce paiement ?",
      suggestions: ["Dans 30 jours", "Fin du mois", SUGGESTION_PICK_DATE],
      status: "sent",
    },
  };
}

function buildDemoProtectionReply(
  answer: string,
  context: ActiveContext,
): { message: AssistantMessage; context: ActiveContextData } | null {
  if (context?.type !== "protection_draft" || !context.protection) return null;

  const trimmed = answer.trim();
  if (
    trimmed === SUGGESTION_OTHER_AMOUNT ||
    trimmed === SUGGESTION_PICK_DATE ||
    trimmed === SUGGESTION_CREATE_CLIENT ||
    trimmed === SUGGESTION_CLIENT_NAME ||
    trimmed === SUGGESTION_ENTER_EMAIL ||
    trimmed === SUGGESTION_STAY_IN_GENERAL ||
    parseCreateClientSpaceSuggestion(trimmed)
  ) {
    return null;
  }

  const current = context.protection;
  if (!isFilledLabel(current.clientName)) {
    const protection = { ...current, clientName: trimmed };
    return {
      context: { ...context, protection },
      message: {
        id: createMessageId("assistant"),
        role: "assistant",
        content: `Parfait, je retiens ${trimmed}.\n\nOn continue : quel montant veux-tu sécuriser ?`,
        suggestions: ["1 000 €", "2 500 €", SUGGESTION_OTHER_AMOUNT],
        status: "sent",
      },
    };
  }

  if (!isFilledLabel(current.amountLabel)) {
    const protection = { ...current, amountLabel: trimmed };
    return {
      context: { ...context, protection },
      message: {
        id: createMessageId("assistant"),
        role: "assistant",
        content:
          "Très bien. Quelle est la date d’échéance prévue pour ce paiement ?",
        suggestions: ["Dans 30 jours", "Fin du mois", SUGGESTION_PICK_DATE],
        status: "sent",
      },
    };
  }

  if (!isFilledLabel(current.dueDateLabel)) {
    const protection = {
      ...current,
      dueDateLabel: trimmed,
      statusLabel: "À confirmer",
      nextStepLabel: undefined,
    };
    return {
      context: { ...context, protection },
      message: {
        id: createMessageId("assistant"),
        role: "assistant",
        content: `Récapitulatif : ${protection.clientName} · ${protection.amountLabel} · ${protection.dueDateLabel}.\n\nRien ne sera créé sans ta confirmation.`,
        suggestions: [
          "Confirmer la protection",
          "Modifier le montant",
          "Changer l’échéance",
        ],
        status: "sent",
      },
    };
  }

  return null;
}

type DraftSession = {
  draftId: string | null;
  confirmationNonce: string | null;
};

type GenerationControlState = "idle" | "running" | "stopping";

type ClientIntakeState =
  | { step: "name" }
  | { step: "email"; name: string }
  | { step: "confirm"; name: string; email: string }
  | { step: "existing"; client: KnownClient };

const SUGGESTION_CONFIRM_CLIENT = "Confirmer la création du client";
const SUGGESTION_EDIT_CLIENT_EMAIL = "Modifier l’email";
const SUGGESTION_USE_EXISTING_CLIENT = "Utiliser ce client";
const SUGGESTION_ENTER_ANOTHER_CLIENT = "Saisir un autre client";

type ConversationalWorkspaceProps = {
  /** Prénom d’accueil — `null` → « Bonjour » seul (jamais username/email). */
  userFirstName: string | null;
  userDisplayName: string;
  userEmail?: string;
  /** Libellé de plan réel uniquement ; aucun fallback n’est inventé. */
  userPlan?: string;
  /** Progression calculée depuis les données métier réelles côté serveur. */
  sidebarOnboardingFacts?: SidebarOnboardingFacts;
  demoState?: DemoStateId;
  viewport?: AssistantViewport;
  summaryLines?: string[];
  welcomeDataState?: WelcomeDataState;
  /** Trois repères métier prioritaires du briefing Aujourd’hui. */
  welcomeBriefCards?: WelcomeBriefCard[];
  /** Synthèse déjà calculée côté serveur pour le raccourci Paiements. */
  paymentSummary?: PaymentSummaryData;
  /** Historique tenant-scopé chargé côté serveur. */
  initialConversationHistory?: ConversationHistoryItem[];
  /** Projets tenant-scopés chargés côté serveur. */
  initialConversationProjects?: ConversationProject[];
  /** Clients réels tenant-scopés utilisés par les suggestions guidées. */
  initialKnownClients?: KnownClient[];
  /** Intention explicite transmise par la route au premier rendu. */
  initialAction?: InitialWorkspaceAction;
  /** Preview : ouvre le drawer mobile. */
  defaultMobileNavOpen?: boolean;
  onShortcutAction?: (action: string) => void;
  /** Transport injectable (tests). Défaut : POST /api/agent/tools. */
  agentTransport?: AgentTransport;
  /** Force le mode live même avec demoState (tests). */
  forceLiveAgent?: boolean;
  /** État local réservé aux captures du preview `/dev/assistant`. */
  composerPreviewState?: "drop";
  /** Texte initial réservé aux états de preview locale. */
  initialComposerValue?: string;
  /** Compensation du viewport du navigateur de capture local. */
  previewComposerOffset?: number;
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

/**
 * Le focus ne revient au composer que s’il a été perdu (bouton démonté) ou
 * s’il s’y trouve déjà. Toute autre cible — titre, menu, dialogue — appartient
 * à l’utilisateur et ne doit pas être interrompue.
 */
function composerMayTakeFocus(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body) return true;
  return Boolean(active.closest?.('[data-testid="composer"]'));
}

function restoreComposerFocus(): void {
  if (!composerMayTakeFocus()) return;
  window.requestAnimationFrame(() => {
    if (!composerMayTakeFocus()) return;
    document
      .querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]')
      ?.focus();
  });
}

function operationFailureCopy(
  code: string,
  operation: "analysis" | "confirmation",
): { content: string; detail: string } {
  if (code === "NETWORK_ERROR") {
    return {
      content: "La connexion a été interrompue.",
      detail:
        operation === "confirmation"
          ? "La protection n’a pas été créée. Tes informations sont conservées."
          : "Ton message est conservé. Tu peux réessayer.",
    };
  }

  if (
    code === "AUTH_TOKEN_EXPIRED" ||
    code === "AUTHENTICATION_INVALID" ||
    code === "AUTHENTICATION_REQUIRED" ||
    code === "UNAUTHENTICATED"
  ) {
    return {
      content: "Ta session a expiré.",
      detail: "Reconnecte-toi, puis réessaie. Tes informations restent affichées.",
    };
  }

  return operation === "confirmation"
    ? {
        content: "Je n’ai pas pu créer la protection.",
        detail: "Rien n’a été créé. Vérifie les informations puis réessaie.",
      }
    : {
        content: "Je n’ai pas pu analyser ta demande.",
        detail: "La facture et les informations déjà saisies sont conservées.",
      };
}

const NON_RETRYABLE_CONVERSATION_FAILURES = new Set([
  "AGENT_DEPENDENCY_UNAVAILABLE",
  "AUTHENTICATION_INVALID",
  "AUTHENTICATION_REQUIRED",
  "AUTH_TOKEN_EXPIRED",
  "PERMISSION_DENIED",
  "TENANT_ACCESS_DENIED",
  "UNAUTHENTICATED",
  "permission_denied",
]);

function canRetryConversationFailure(
  code: string,
  transportMarkedRetryable: boolean,
): boolean {
  return (
    transportMarkedRetryable &&
    !NON_RETRYABLE_CONVERSATION_FAILURES.has(code)
  );
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

function startLocalProtection(
  current: ConversationalWorkspaceState,
  clientSuggestions: string[],
  userContent: string,
  ids?: { context: string; user: string; assistant: string },
): ConversationalWorkspaceState {
  const context: ActiveContext = {
    id: ids?.context ?? createMessageId("ctx-draft"),
    type: "protection_draft",
    protection: {
      clientName: "À préciser",
      statusLabel: "Brouillon",
      status: "draft",
      amountLabel: "À préciser",
      subject: "À préciser",
      dueDateLabel: "À préciser",
      nextStepLabel: "Il me manque encore quelques informations.",
      consequenceLabel: CONSEQUENCE_COPY.draft,
      primaryActionLabel: "Continuer la protection",
      secondaryActionLabel: "Annuler le brouillon",
    },
  };

  return {
    ...current,
    messages: [
      ...current.messages,
      {
        id: ids?.user ?? createMessageId("user"),
        role: "user",
        content: userContent,
        status: "sent",
      },
      {
        id: ids?.assistant ?? createMessageId("assistant"),
        role: "assistant",
        content:
          "Créons cette protection ensemble. Je vais recueillir les informations obligatoires une par une.\n\nQui doit te payer ?",
        suggestions: clientSuggestions,
        status: "sent",
      },
    ],
    activeContext: context,
    isContextPanelOpen: false,
    isGenerating: false,
    shortcutPhase: resolveShortcutPhase(context),
  };
}

function initialWorkspaceState({
  demoState,
  initialAction,
  usesServerConversationPersistence,
  initialKnownClients,
}: {
  demoState?: DemoStateId;
  initialAction?: InitialWorkspaceAction;
  usesServerConversationPersistence: boolean;
  initialKnownClients: KnownClient[];
}): ConversationalWorkspaceState {
  const current = demoState ? getDemoWorkspaceState(demoState) : emptyWorkspace();
  if (initialAction !== "create_protection") return current;

  if (usesServerConversationPersistence) {
    return {
      ...current,
      messages: [
        ...current.messages,
        {
          id: "initial-create-protection-user",
          role: "user",
          content: CREATE_PROTECTION_PROMPT,
          status: "sent",
        },
      ],
      isGenerating: true,
    };
  }

  return startLocalProtection(
    current,
    buildClientPaymentSuggestions(initialKnownClients),
    "Protéger une facture",
    {
      context: "initial-create-protection-context",
      user: "initial-create-protection-user",
      assistant: "initial-create-protection-assistant",
    },
  );
}

function buildLocalHistoryItem({
  id,
  workspace,
  organization,
  customTitle,
  previous,
  updatedAt,
}: {
  id: string;
  workspace: ConversationalWorkspaceState;
  organization: {
    clientId: string | null;
    clientName: string | null;
    projectId: string | null;
    projectName: string | null;
  };
  customTitle: string | null;
  previous?: ConversationHistoryItem;
  updatedAt: string;
}): ConversationHistoryItem {
  const contextClientName =
    workspace.activeContext?.protection?.clientName ?? null;
  const clientName = isMeaningfulConversationLabel(contextClientName)
    ? contextClientName!.trim()
    : organization.clientName;
  const hasCustomTitle = Boolean(previous?.titleCustom || customTitle);

  return {
    id,
    clientId: organization.clientId,
    clientName: isMeaningfulConversationLabel(clientName)
      ? clientName!.trim()
      : null,
    projectId: organization.projectId,
    projectName: organization.projectName,
    title: hasCustomTitle
      ? (previous?.titleCustom ? previous.title : customTitle!)
      : deriveConversationTitle({
          clientName,
          messages: workspace.messages,
        }),
    titleCustom: hasCustomTitle || undefined,
    preview: deriveConversationPreview(workspace.messages),
    updatedAt,
  };
}

export function ConversationalWorkspace({
  userFirstName,
  userDisplayName,
  userEmail,
  userPlan,
  sidebarOnboardingFacts,
  demoState,
  viewport: viewportProp,
  summaryLines = [...FALLBACK_WELCOME_SUMMARY],
  welcomeDataState,
  welcomeBriefCards,
  paymentSummary,
  initialConversationHistory = [],
  initialConversationProjects = [],
  initialKnownClients = [],
  initialAction,
  defaultMobileNavOpen = false,
  onShortcutAction,
  agentTransport = callAgentTool,
  forceLiveAgent = false,
  composerPreviewState,
  initialComposerValue = "",
  previewComposerOffset,
}: ConversationalWorkspaceProps) {
  const router = useRouter();
  const localConversationSeed = useId();
  const createProtectionBootstrapped = useRef(false);
  const handleShortcutRef = useRef<(shortcut: ComposerShortcut) => void>(
    () => {},
  );
  const measuredViewport = useSyncExternalStore(
    subscribeViewport,
    getViewportSnapshot,
    getServerViewportSnapshot,
  );
  const viewport = viewportProp ?? measuredViewport;
  const liveAgent = forceLiveAgent || !demoState;
  const usesServerConversationPersistence =
    liveAgent && agentTransport === callAgentTool;
  const seededKnownClients = demoState
    ? [{ name: "Dupont Conseil" }]
    : initialKnownClients;

  const [draft, setDraft] = useState(initialComposerValue);
  const [composerFiles, setComposerFiles] = useState<File[]>([]);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [permissionNotice, setPermissionNotice] = useState(false);
  const [lastShortcutAction, setLastShortcutAction] = useState<string | null>(
    initialAction ?? null,
  );
  const [workspace, setWorkspace] = useState<ConversationalWorkspaceState>(
    () =>
      initialWorkspaceState({
        demoState,
        initialAction,
        usesServerConversationPersistence,
        initialKnownClients: seededKnownClients,
      }),
  );
  const [draftSession, setDraftSession] = useState<DraftSession>({
    draftId: null,
    confirmationNonce: null,
  });
  const [clientIntake, setClientIntake] = useState<ClientIntakeState | null>(
    null,
  );
  const [panelBusy, setPanelBusy] = useState(false);
  const [panelActionError, setPanelActionError] = useState<string | null>(null);
  const [conversationHistory, setConversationHistory] = useState(
    initialConversationHistory,
  );
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(() =>
    !usesServerConversationPersistence && workspace.messages.length > 0
      ? `demo-conversation-${localConversationSeed}`
      : null,
  );
  const [conversationHistoryBusy, setConversationHistoryBusy] = useState(false);
  const [knownClients, setKnownClients] = useState<KnownClient[]>(() =>
    seededKnownClients,
  );
  const [pendingOrganization, setPendingOrganization] = useState<{
    clientId: string | null;
    clientName: string | null;
    projectId: string | null;
    projectName: string | null;
  }>({
    clientId: null,
    clientName: null,
    projectId: null,
    projectName: null,
  });
  const [conversationProjects, setConversationProjects] = useState<
    ConversationProject[]
  >(initialConversationProjects);
  const [declinedClientSpaces, setDeclinedClientSpaces] = useState<string[]>(
    [],
  );
  const [offeredClientSpaces, setOfferedClientSpaces] = useState<string[]>([]);
  const [pendingInvoiceImport, setPendingInvoiceImport] = useState(false);
  const [generatingLabel, setGeneratingLabel] = useState<string | null>(null);
  const [generationControlState, setGenerationControlState] =
    useState<GenerationControlState>("idle");
  const [workspaceToast, setWorkspaceToast] = useState<{
    id: number;
    message: string;
  } | null>(null);
  const workspaceToastIdRef = useRef(0);
  /**
   * Un message identique répété doit être réannoncé et relancer sa
   * temporisation : d’où l’identifiant plutôt qu’une simple chaîne.
   */
  const showWorkspaceToast = useCallback((message: string) => {
    workspaceToastIdRef.current += 1;
    setWorkspaceToast({ id: workspaceToastIdRef.current, message });
  }, []);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  /** Titre saisi pour une discussion encore absente de l’historique persisté. */
  const [localConversationTitle, setLocalConversationTitle] = useState<
    string | null
  >(null);
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  const [projectDrawerAnchor, setProjectDrawerAnchor] =
    useState<ProjectDrawerAnchor | null>(null);
  const [editingProject, setEditingProject] =
    useState<ConversationProject | null>(null);
  const [projectDeleteDialog, setProjectDeleteDialog] =
    useState<ConversationProject | null>(null);
  const [projectDeleteBusy, setProjectDeleteBusy] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [pendingFilePick, setPendingFilePick] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const voluntaryAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const activeConversationIdRef = useRef<string | null>(activeConversationId);
  const conversationCreationRef = useRef<Promise<string | null> | null>(null);
  const submitGuardRef = useRef<symbol | null>(null);
  const confirmGuardRef = useRef(false);
  const selectionRequestRef = useRef(0);
  const conversationEpochRef = useRef(0);
  const deterministicPersistenceQueueRef = useRef<Promise<void>>(
    Promise.resolve(),
  );
  const threadEndRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const openFilePickerRef = useRef<(() => void) | null>(null);
  const attachmentPreviewUrlsRef = useRef<Set<string>>(new Set());
  const demoSnapshotsRef = useRef<
    Map<
      string,
      {
        workspace: ConversationalWorkspaceState;
        draftSession: DraftSession;
        clientIntake: ClientIntakeState | null;
      }
    >
  >(new Map());
  const contextClientName = workspace.activeContext?.protection?.clientName;
  const effectiveKnownClients = useMemo(
    () =>
      isFilledLabel(contextClientName)
        ? upsertKnownClient(knownClients, { name: contextClientName!.trim() })
        : knownClients,
    [contextClientName, knownClients],
  );
  const clientSuggestions = useMemo(
    () => buildClientPaymentSuggestions(effectiveKnownClients),
    [effectiveKnownClients],
  );

  const cancelActiveRequest = useCallback(() => {
    const controller = abortRef.current;
    abortRef.current = null;
    voluntaryAbortRef.current = null;
    submitGuardRef.current = null;
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    setGenerationControlState("idle");
    setGeneratingLabel(null);
  }, []);

  const buildCurrentLocalHistoryItem = useCallback(
    (
      id: string,
      previous: ConversationHistoryItem | undefined,
      updatedAt: string,
    ) =>
      buildLocalHistoryItem({
        id,
        workspace,
        organization: pendingOrganization,
        customTitle: localConversationTitle,
        previous,
        updatedAt,
      }),
    [localConversationTitle, pendingOrganization, workspace],
  );

  const ensureLocalConversation = useCallback((): string => {
    const currentId = activeConversationIdRef.current;
    if (currentId) return currentId;
    const id = createMessageId("demo-conversation");
    activeConversationIdRef.current = id;
    setActiveConversationId(id);
    return id;
  }, []);

  const touchLocalConversation = useCallback((): string | null => {
    if (usesServerConversationPersistence) {
      return activeConversationIdRef.current;
    }
    const id = ensureLocalConversation();
    const updatedAt = new Date().toISOString();
    setConversationHistory((current) => {
      const previous = current.find((entry) => entry.id === id);
      const item = buildCurrentLocalHistoryItem(id, previous, updatedAt);
      return [item, ...current.filter((entry) => entry.id !== id)];
    });
    return id;
  }, [
    buildCurrentLocalHistoryItem,
    ensureLocalConversation,
    usesServerConversationPersistence,
  ]);

  const commitCurrentLocalConversation = useCallback(() => {
    if (usesServerConversationPersistence || workspace.messages.length === 0) {
      return;
    }
    const id = activeConversationIdRef.current;
    if (!id) return;
    demoSnapshotsRef.current.set(id, {
      workspace: { ...workspace, isGenerating: false },
      draftSession,
      clientIntake,
    });
    setConversationHistory((current) => {
      const previous = current.find((entry) => entry.id === id);
      const item = buildCurrentLocalHistoryItem(
        id,
        previous,
        previous?.updatedAt ?? new Date().toISOString(),
      );
      if (!previous) return [item, ...current];
      return current.map((entry) => (entry.id === id ? item : entry));
    });
  }, [
    buildCurrentLocalHistoryItem,
    clientIntake,
    draftSession,
    usesServerConversationPersistence,
    workspace,
  ]);

  const revokeAttachmentPreviews = useCallback(() => {
    for (const url of attachmentPreviewUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    attachmentPreviewUrlsRef.current.clear();
  }, []);

  useEffect(() => revokeAttachmentPreviews, [revokeAttachmentPreviews]);

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

  const [keyboardOffset, setKeyboardOffset] = useState(0);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    if (!visualViewport) return;

    const updateKeyboardOffset = () => {
      const measuredInset = Math.max(
        0,
        window.innerHeight - visualViewport.height - visualViewport.offsetTop,
      );
      // Ignore les écarts subpixel du viewport mobile : ils ne correspondent
      // pas à un clavier et peuvent créer un calque composite inutile.
      setKeyboardOffset(measuredInset < 1 ? 0 : Math.ceil(measuredInset));
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
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const frame = window.requestAnimationFrame(() => {
      const top = scroller.scrollHeight;
      if (typeof scroller.scrollTo === "function") {
        scroller.scrollTo({
          top,
          behavior: reduceMotion ? "auto" : "smooth",
        });
        return;
      }
      scroller.scrollTop = top;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [workspace.messages, workspace.isGenerating, showWelcome]);

  // Ouvre le file picker après re-render (ex. sortie empty state → composer remonté).
  useEffect(() => {
    if (!pendingFilePick) return;
    const frame = window.requestAnimationFrame(() => {
      openFilePickerRef.current?.();
      setPendingFilePick(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingFilePick, showWelcome, workspace.messages.length]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const controller = abortRef.current;
      abortRef.current = null;
      voluntaryAbortRef.current = null;
      submitGuardRef.current = null;
      controller?.abort();
    };
  }, []);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

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

  const refreshConversationHistory = useCallback(async () => {
    if (!usesServerConversationPersistence) return;
    try {
      const conversations = await fetchConversationHistory();
      setConversationHistory(conversations);
    } catch {
      // L’historique est secondaire : la conversation courante reste utilisable.
    }
  }, [usesServerConversationPersistence]);

  const ensureActiveConversation = useCallback(async (): Promise<
    string | null
  > => {
    if (activeConversationIdRef.current) {
      return activeConversationIdRef.current;
    }
    if (conversationCreationRef.current) {
      return conversationCreationRef.current;
    }
    if (!usesServerConversationPersistence) {
      return ensureLocalConversation();
    }

    // Verrou synchrone : plusieurs envois déclenchés avant le prochain rendu
    // partagent la même création différée au lieu de créer des doublons.
    const creationEpoch = conversationEpochRef.current;
    const pending = (async () => {
      try {
        const conversation = await createAssistantConversation(
          pendingOrganization.clientId,
        );
        if (conversationEpochRef.current !== creationEpoch) {
          await deleteAssistantConversation(conversation.id).catch(() => undefined);
          return null;
        }
        activeConversationIdRef.current = conversation.id;
        setActiveConversationId(conversation.id);
        return conversation.id;
      } catch {
        return null;
      }
    })();
    conversationCreationRef.current = pending;
    try {
      return await pending;
    } finally {
      if (conversationCreationRef.current === pending) {
        conversationCreationRef.current = null;
      }
    }
  }, [
    ensureLocalConversation,
    pendingOrganization.clientId,
    usesServerConversationPersistence,
  ]);

  const persistDeterministicTurn = useCallback(
    async (userContent: string, assistantContent: string): Promise<boolean> => {
      if (!usesServerConversationPersistence) return true;
      let persisted = false;
      const persist = async () => {
        const conversationId = await ensureActiveConversation();
        if (!conversationId) {
          showWorkspaceToast("Je n’ai pas pu enregistrer cette discussion.");
          return;
        }
        try {
          await persistAssistantConversationTurn({
            conversationId,
            userContent,
            assistantContent,
          });
          await refreshConversationHistory();
          persisted = true;
        } catch {
          showWorkspaceToast("Je n’ai pas pu enregistrer cette discussion.");
        }
      };
      const queued = deterministicPersistenceQueueRef.current.then(
        persist,
        persist,
      );
      deterministicPersistenceQueueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );
      await queued;
      return persisted;
    },
    [
      ensureActiveConversation,
      refreshConversationHistory,
      showWorkspaceToast,
      usesServerConversationPersistence,
    ],
  );


  /** Remet à zéro tout ce qui n’appartient qu’à la discussion quittée. */
  const clearConversationScopedState = useCallback(() => {
    conversationEpochRef.current += 1;
    selectionRequestRef.current += 1;
    cancelActiveRequest();
    setComposerError(null);
    setPermissionNotice(false);
    setDraft("");
    setComposerFiles([]);
    setEditingMessageId(null);
    setPendingInvoiceImport(false);
    setLocalConversationTitle(null);
    setClientIntake(null);
    setDraftSession({ draftId: null, confirmationNonce: null });
    setWorkspace(emptyWorkspace());
    setPendingOrganization({
      clientId: null,
      clientName: null,
      projectId: null,
      projectName: null,
    });
    activeConversationIdRef.current = null;
    setActiveConversationId(null);
  }, [cancelActiveRequest]);

  const handleNewConversation = useCallback(async () => {
    if (conversationHistoryBusy) return;
    conversationEpochRef.current += 1;
    selectionRequestRef.current += 1;
    cancelActiveRequest();
    setConversationHistoryBusy(true);
    setComposerError(null);
    setPermissionNotice(false);
    setDraft("");
    setComposerFiles([]);
    setEditingMessageId(null);
    setPendingInvoiceImport(false);
    setLocalConversationTitle(null);
    setDraftSession({ draftId: null, confirmationNonce: null });
    setPendingOrganization({
      clientId: null,
      clientName: null,
      projectId: null,
      projectName: null,
    });
    setWorkspace(emptyWorkspace());
    // Hors démo, les messages quittés ne reviennent pas : leurs aperçus
    // retiendraient les fichiers en mémoire pour toute la session.
    if (usesServerConversationPersistence) revokeAttachmentPreviews();

    if (!usesServerConversationPersistence) {
      commitCurrentLocalConversation();
      setClientIntake(null);
      // Brouillon local : pas d’entrée historique tant qu’aucun message n’est envoyé.
      activeConversationIdRef.current = null;
      setActiveConversationId(null);
      setConversationHistoryBusy(false);
      return;
    }

    // Si une conversation serveur a été créée mais reste vide, on la retire.
    const abandonedId = activeConversationId;
    const abandonedIsEmpty =
      Boolean(abandonedId) &&
      workspace.messages.length === 0 &&
      !conversationHistory.some((item) => item.id === abandonedId);

    setClientIntake(null);
    activeConversationIdRef.current = null;
    setActiveConversationId(null);

    try {
      if (abandonedId && abandonedIsEmpty) {
        await deleteAssistantConversation(abandonedId);
      }
    } catch {
      // Le brouillon abandonné est secondaire : on laisse l’UI repartir propre.
    } finally {
      setConversationHistoryBusy(false);
    }
  }, [
    activeConversationId,
    cancelActiveRequest,
    commitCurrentLocalConversation,
    conversationHistory,
    conversationHistoryBusy,
    revokeAttachmentPreviews,
    usesServerConversationPersistence,
    workspace,
  ]);

  const handleSelectConversation = useCallback(
    async (conversationId: string) => {
      if (conversationHistoryBusy || conversationId === activeConversationId) {
        return;
      }

      conversationEpochRef.current += 1;
      const requestId = selectionRequestRef.current + 1;
      selectionRequestRef.current = requestId;
      cancelActiveRequest();

      if (!usesServerConversationPersistence) {
        commitCurrentLocalConversation();
        const snapshot = demoSnapshotsRef.current.get(conversationId);
        if (!snapshot) return;
        setComposerError(null);
        setPermissionNotice(false);
        setDraft("");
        setComposerFiles([]);
        setEditingMessageId(null);
        setPendingInvoiceImport(false);
        setLocalConversationTitle(null);
        activeConversationIdRef.current = conversationId;
        setActiveConversationId(conversationId);
        const historyItem = conversationHistory.find(
          (item) => item.id === conversationId,
        );
        setPendingOrganization({
          clientId: historyItem?.clientId ?? null,
          clientName: historyItem?.clientName ?? null,
          projectId: historyItem?.projectId ?? null,
          projectName: historyItem?.projectName ?? null,
        });
        setWorkspace(snapshot.workspace);
        setDraftSession(snapshot.draftSession);
        setClientIntake(snapshot.clientIntake);
        return;
      }

      setConversationHistoryBusy(true);
      setComposerError(null);
      setPermissionNotice(false);
      setEditingMessageId(null);
      // Le brouillon, les pièces jointes et les parcours guidés appartiennent
      // à la discussion quittée : rien ne doit suivre l’utilisateur.
      setDraft("");
      setComposerFiles([]);
      setClientIntake(null);
      setPendingInvoiceImport(false);
      setLocalConversationTitle(null);
      revokeAttachmentPreviews();
      try {
        const messages = await fetchConversationMessages(conversationId);
        if (selectionRequestRef.current !== requestId) return;
        activeConversationIdRef.current = conversationId;
        setActiveConversationId(conversationId);
        const historyItem = conversationHistory.find(
          (item) => item.id === conversationId,
        );
        setPendingOrganization({
          clientId: historyItem?.clientId ?? null,
          clientName: historyItem?.clientName ?? null,
          projectId: historyItem?.projectId ?? null,
          projectName: historyItem?.projectName ?? null,
        });
        setDraftSession({ draftId: null, confirmationNonce: null });
        setWorkspace({
          ...emptyWorkspace(),
          messages,
        });
      } catch {
        if (selectionRequestRef.current === requestId) {
          setComposerError(UX_COPY.requestSaveFailed.title);
        }
      } finally {
        if (selectionRequestRef.current === requestId) {
          setConversationHistoryBusy(false);
        }
      }
    },
    [
      activeConversationId,
      cancelActiveRequest,
      commitCurrentLocalConversation,
      conversationHistory,
      conversationHistoryBusy,
      revokeAttachmentPreviews,
      usesServerConversationPersistence,
    ],
  );

  const ensureNamedProject = useCallback(
    (
      name: string,
      personalization?: Pick<ProjectCreationDraft, "icon" | "color">,
    ): ConversationProject => {
      const trimmed = name.trim();
      const existing = findProjectByName(conversationProjects, trimmed);
      if (existing) return existing;
      const project: ConversationProject = {
        id: createMessageId("project"),
        name: trimmed,
        ...personalization,
      };
      setConversationProjects((current) => {
        if (findProjectByName(current, trimmed)) return current;
        return [project, ...current];
      });
      return project;
    },
    [conversationProjects],
  );

  const assignConversationToProject = useCallback(
    (project: ConversationProject) => {
      setPendingOrganization((current) => ({
        ...current,
        projectId: project.id,
        projectName: project.name,
      }));
      if (!activeConversationId) return;
      setConversationHistory((current) => {
        const previous = current.find(
          (item) => item.id === activeConversationId,
        );
        const materialized = previous
          ? current
          : [
              buildCurrentLocalHistoryItem(
                activeConversationId,
                undefined,
                new Date().toISOString(),
              ),
              ...current,
            ];
        return materialized.map((item) =>
          item.id === activeConversationId
            ? {
                ...item,
                projectId: project.id,
                projectName: project.name,
              }
            : item,
        );
      });
    },
    [activeConversationId, buildCurrentLocalHistoryItem],
  );

  const askProtectionAmount = useCallback(
    (clientName: string, reason: "space-created" | "stay-general" | "default" = "default") => {
      const lead =
        reason === "space-created"
          ? `C’est noté — j’ai créé l’espace « ${clientName} » pour y ranger cette discussion.`
          : reason === "stay-general"
            ? `Très bien, on reste dans Général pour l’instant. Tu pourras classer plus tard si tu veux.`
            : `Parfait, je retiens ${clientName}.`;

      setWorkspace((current) => ({
        ...current,
        messages: [
          ...current.messages,
          {
            id: createMessageId("assistant"),
            role: "assistant",
            content: `${lead}\n\nOn continue la protection : quel montant veux-tu sécuriser ?`,
            suggestions: ["1 000 €", "2 500 €", SUGGESTION_OTHER_AMOUNT],
            status: "sent",
          },
        ],
        isGenerating: false,
      }));
    },
    [],
  );

  const handleOrganizeConversation = useCallback(
    async (option: ConversationOrganizeOption) => {
      const previousOrganization = pendingOrganization;
      let nextOrg = {
        clientId: option.kind === "client" ? option.clientId : null,
        clientName: option.kind === "client" ? option.clientName : null,
        projectId: option.kind === "project" ? option.projectId : null,
        projectName: option.kind === "project" ? option.projectName : null,
      };

      if (option.kind === "project" && option.projectName?.trim()) {
        const project = ensureNamedProject(option.projectName);
        nextOrg = {
          clientId: null,
          clientName: null,
          projectId: project.id,
          projectName: project.name,
        };
      }

      if (option.kind === "general") {
        nextOrg = {
          clientId: null,
          clientName: null,
          projectId: null,
          projectName: null,
        };
      }

      setPendingOrganization((current) => ({
        ...current,
        ...nextOrg,
        // Conserve le client métier du brouillon ; seul le classement projet change.
        clientId:
          option.kind === "general" || option.kind === "project"
            ? current.clientId
            : nextOrg.clientId,
        clientName:
          option.kind === "general" || option.kind === "project"
            ? current.clientName
            : nextOrg.clientName,
      }));

      if (!activeConversationId) return;

      const applyLocal = () => {
        setConversationHistory((current) => {
          const previous = current.find(
            (item) => item.id === activeConversationId,
          );
          const materialized = previous
            ? current
            : [
                buildCurrentLocalHistoryItem(
                  activeConversationId,
                  undefined,
                  new Date().toISOString(),
                ),
                ...current,
              ];
          return materialized.map((item) =>
            item.id === activeConversationId
              ? {
                  ...item,
                  projectId: nextOrg.projectId,
                  projectName: nextOrg.projectName,
                  ...(option.kind === "client"
                    ? {
                        clientId: nextOrg.clientId,
                        clientName: nextOrg.clientName,
                      }
                    : option.kind === "general"
                      ? { clientId: null, clientName: item.clientName }
                      : {}),
                }
              : item,
          );
        });
      };

      if (!usesServerConversationPersistence) {
        applyLocal();
        return;
      }

      if (option.kind === "project" || option.kind === "general") {
        try {
          const organization = await organizeAssistantConversation({
            conversationId: activeConversationId,
            projectId: nextOrg.projectId,
          });
          nextOrg = {
            ...nextOrg,
            projectId: organization.projectId ?? null,
            projectName: organization.projectName ?? null,
          };
          applyLocal();
        } catch {
          setPendingOrganization(previousOrganization);
          showWorkspaceToast("Je n’ai pas pu déplacer cette discussion.");
        }
        return;
      }

      if (option.clientName && !option.clientId) {
        applyLocal();
        return;
      }

      try {
        const organization = await organizeAssistantConversation({
          conversationId: activeConversationId,
          clientId: option.clientId,
        });
        setPendingOrganization((current) => ({
          ...current,
          clientId: organization.clientId ?? null,
          clientName: organization.clientName ?? null,
        }));
        setConversationHistory((current) =>
          current.map((item) =>
            item.id === activeConversationId
              ? {
                  ...item,
                  clientId: organization.clientId ?? null,
                  clientName: organization.clientName ?? null,
                }
              : item,
          ),
        );
      } catch {
        setPendingOrganization(previousOrganization);
        showWorkspaceToast("Je n’ai pas pu organiser cette discussion.");
      }
    },
    [
      activeConversationId,
      buildCurrentLocalHistoryItem,
      ensureNamedProject,
      pendingOrganization,
      showWorkspaceToast,
      usesServerConversationPersistence,
    ],
  );

  const handleCreateProject = useCallback((anchor?: ProjectDrawerAnchor) => {
    setEditingProject(null);
    setProjectDrawerAnchor(anchor ?? null);
    setProjectDrawerOpen(true);
  }, []);

  const handleEditProject = useCallback(
    (project: ConversationProject, anchor?: ProjectDrawerAnchor) => {
      setEditingProject(project);
      setProjectDrawerAnchor(anchor ?? null);
      setProjectDrawerOpen(true);
    },
    [],
  );

  const handleConfirmProject = useCallback(
    async (draft: ProjectCreationDraft) => {
      // Deux projets homonymes sont créables côté serveur mais le menu
      // « Classer dans » n’en expose qu’un : le second serait inatteignable.
      const nameConflict = findProjectByName(conversationProjects, draft.name);
      if (nameConflict && nameConflict.id !== editingProject?.id) {
        showWorkspaceToast(
          `Un projet « ${nameConflict.name} » existe déjà.`,
        );
        return;
      }

      if (editingProject) {
        let updatedProject: ConversationProject;
        try {
          updatedProject = usesServerConversationPersistence
            ? await updateAssistantProject(editingProject.id, draft)
            : {
                ...editingProject,
                name: draft.name,
                icon: draft.icon,
                color: draft.color,
              };
        } catch {
          showWorkspaceToast("Je n’ai pas pu modifier ce projet.");
          return;
        }
        setConversationProjects((current) => {
          const exists = current.some(
            (project) => project.id === editingProject.id,
          );
          return exists
            ? current.map((project) =>
                project.id === editingProject.id ? updatedProject : project,
              )
            : [updatedProject, ...current];
        });
        setConversationHistory((current) =>
          current.map((item) => {
            const belongsToProject =
              item.projectId === editingProject.id ||
              (!item.projectId &&
                item.projectName?.trim().toLocaleLowerCase("fr") ===
                  editingProject.name.trim().toLocaleLowerCase("fr"));
            return belongsToProject
              ? {
                  ...item,
                  projectId: editingProject.id,
                  projectName: draft.name,
                }
              : item;
          }),
        );
        setPendingOrganization((current) => {
          const belongsToProject =
            current.projectId === editingProject.id ||
            (!current.projectId &&
              current.projectName?.trim().toLocaleLowerCase("fr") ===
                editingProject.name.trim().toLocaleLowerCase("fr"));
          return belongsToProject
            ? {
                ...current,
                projectId: editingProject.id,
                projectName: draft.name,
              }
            : current;
        });
        setEditingProject(updatedProject);
        setProjectDrawerOpen(false);
        setProjectDrawerAnchor(null);
        return;
      }

      try {
        if (usesServerConversationPersistence) {
          const project = await createAssistantProject(draft);
          setConversationProjects((current) => [
            project,
            ...current.filter((item) => item.id !== project.id),
          ]);
        } else {
          ensureNamedProject(draft.name, {
            icon: draft.icon,
            color: draft.color,
          });
        }
      } catch {
        showWorkspaceToast("Je n’ai pas pu créer ce projet.");
        return;
      }
      setProjectDrawerOpen(false);
      setProjectDrawerAnchor(null);
    },
    [
      conversationProjects,
      editingProject,
      ensureNamedProject,
      showWorkspaceToast,
      usesServerConversationPersistence,
    ],
  );

  const handleDuplicateProject = useCallback(
    async (project: ConversationProject) => {
      const knownNames = new Set(
        [
          ...conversationProjects.map((item) => item.name),
          ...conversationHistory.flatMap((item) =>
            item.projectName ? [item.projectName] : [],
          ),
        ].map((name) => name.trim().toLocaleLowerCase("fr")),
      );
      const copyLabel = `${project.name} — copie`;
      let duplicateName = copyLabel;
      let copyIndex = 2;
      while (knownNames.has(duplicateName.toLocaleLowerCase("fr"))) {
        duplicateName = `${copyLabel} ${copyIndex}`;
        copyIndex += 1;
      }
      try {
        const duplicate = usesServerConversationPersistence
          ? await createAssistantProject({
              name: duplicateName,
              icon: project.icon ?? DEFAULT_PROJECT_PERSONALIZATION.icon,
              color: project.color ?? DEFAULT_PROJECT_PERSONALIZATION.color,
            })
          : {
              id: createMessageId("project"),
              name: duplicateName,
              icon: project.icon,
              color: project.color,
            };
        setConversationProjects((current) => [duplicate, ...current]);
      } catch {
        showWorkspaceToast("Je n’ai pas pu dupliquer ce projet.");
      }
    },
    [
      conversationHistory,
      conversationProjects,
      showWorkspaceToast,
      usesServerConversationPersistence,
    ],
  );

  const handleDeleteProject = useCallback((project: ConversationProject) => {
    setProjectDeleteDialog(project);
  }, []);

  const confirmDeleteProject = useCallback(async () => {
    if (!projectDeleteDialog || projectDeleteBusy) return;
    const project = projectDeleteDialog;

    setProjectDeleteBusy(true);
    try {
      if (usesServerConversationPersistence) {
        await deleteAssistantProject(project.id);
      }
    } catch {
      showWorkspaceToast("Je n’ai pas pu supprimer ce projet.");
      return;
    } finally {
      setProjectDeleteBusy(false);
    }

    setConversationProjects((current) =>
      current.filter((item) => item.id !== project.id),
    );
    setConversationHistory((current) =>
      current.map((item) => {
        const belongsToProject =
          item.projectId === project.id ||
          (!item.projectId &&
            item.projectName?.trim().toLocaleLowerCase("fr") ===
              project.name.trim().toLocaleLowerCase("fr"));
        return belongsToProject
          ? { ...item, projectId: null, projectName: null }
          : item;
      }),
    );
    setPendingOrganization((current) => {
      const belongsToProject =
        current.projectId === project.id ||
        (!current.projectId &&
          current.projectName?.trim().toLocaleLowerCase("fr") ===
            project.name.trim().toLocaleLowerCase("fr"));
      return belongsToProject
        ? { ...current, projectId: null, projectName: null }
        : current;
    });
    setEditingProject((current) =>
      current?.id === project.id ? null : current,
    );
    setProjectDeleteDialog(null);
  }, [
    projectDeleteBusy,
    projectDeleteDialog,
    showWorkspaceToast,
    usesServerConversationPersistence,
  ]);

  const projectDeleteConversationCount = useMemo(() => {
    if (!projectDeleteDialog) return 0;
    const projectNameKey = projectDeleteDialog.name
      .trim()
      .toLocaleLowerCase("fr");
    return conversationHistory.filter(
      (item) =>
        item.projectId === projectDeleteDialog.id ||
        (!item.projectId &&
          item.projectName?.trim().toLocaleLowerCase("fr") === projectNameKey),
    ).length;
  }, [conversationHistory, projectDeleteDialog]);

  const handleRenameConversation = useCallback(
    (title: string) => {
      const next = title.trim().slice(0, CONVERSATION_TITLE_MAX_LENGTH);
      if (!next) return;
      // Une discussion sans ligne serveur (pièces jointes temporaires seules)
      // reste renommable pour la session : sans cela le titre revenait
      // silencieusement à sa valeur dérivée.
      setLocalConversationTitle(next);
      if (!activeConversationId) return;
      const previous = conversationHistory.find(
        (item) => item.id === activeConversationId,
      );
      setConversationHistory((current) => {
        const existing = current.find((item) => item.id === activeConversationId);
        if (existing) {
          return current.map((item) =>
            item.id === activeConversationId
              ? { ...item, title: next, titleCustom: true }
              : item,
          );
        }
        if (workspace.messages.length === 0) return current;
        return [
          {
            id: activeConversationId,
            clientId: pendingOrganization.clientId,
            clientName: pendingOrganization.clientName,
            projectId: pendingOrganization.projectId,
            projectName: pendingOrganization.projectName,
            title: next,
            titleCustom: true,
            preview: deriveConversationPreview(workspace.messages),
            updatedAt: new Date().toISOString(),
          },
          ...current,
        ];
      });
      if (!usesServerConversationPersistence) return;

      void renameAssistantConversation(activeConversationId, next).catch(() => {
        setConversationHistory((current) =>
          previous
            ? current.map((item) =>
                item.id === activeConversationId ? previous : item,
              )
            : // L’entrée n’existait pas avant le renommage : la laisser
              // afficherait un titre que le serveur ne connaît pas.
              current.filter((item) => item.id !== activeConversationId),
        );
        setLocalConversationTitle(null);
        showWorkspaceToast("Je n’ai pas pu renommer cette discussion.");
      });
    },
    [
      activeConversationId,
      conversationHistory,
      pendingOrganization,
      showWorkspaceToast,
      usesServerConversationPersistence,
      workspace.messages,
    ],
  );

  const handleMessageFeedback = useCallback(
    (
      messageId: string,
      feedback: MessageFeedback | null,
      comment: string,
    ) => {
      setWorkspace((current) => ({
        ...current,
        messages: current.messages.map((message) => {
          if (message.id !== messageId) return message;
          return {
            ...message,
            feedback,
            // Le commentaire n’a pas d’existence indépendante : retirer le
            // feedback le retire aussi, sans laisser de donnée orpheline.
            feedbackComment: feedback ? comment || null : null,
          };
        }),
      }));
    },
    [],
  );

  const handleEditMessage = useCallback(
    (message: AssistantMessage) => {
      const text = message.content.trim();
      if (!text || workspace.isGenerating) return;
      setComposerError(null);
      setPermissionNotice(false);
      setEditingMessageId(message.id);
      setDraft(text);
      setComposerFiles([]);
      window.requestAnimationFrame(() => {
        const input = document.querySelector<HTMLTextAreaElement>(
          '[data-testid="composer-input"]',
        );
        input?.focus();
        const length = input?.value.length ?? 0;
        input?.setSelectionRange(length, length);
      });
    },
    [workspace.isGenerating],
  );

  const handleCancelEditMessage = useCallback(() => {
    setEditingMessageId(null);
    setDraft("");
    setComposerFiles([]);
  }, []);

  const requestDeleteConversation = useCallback(
    (conversationId: string) => {
      if (conversationHistoryBusy) return;
      const target = conversationHistory.find(
        (item) => item.id === conversationId,
      );
      const label = target?.title?.trim() || "cette discussion";
      setDeleteDialog({ id: conversationId, label });
    },
    [conversationHistory, conversationHistoryBusy],
  );

  const handleDeleteConversation = useCallback(
    async (conversationId: string) => {
      if (conversationHistoryBusy) return;

      if (!usesServerConversationPersistence) {
        demoSnapshotsRef.current.delete(conversationId);
        setConversationHistory((current) =>
          current.filter((item) => item.id !== conversationId),
        );
        if (activeConversationId === conversationId) {
          clearConversationScopedState();
        }
        setDeleteDialog(null);
        return;
      }

      // Ids locaux (démo) : pas d’appel API.
      const isServerId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        conversationId,
      );
      if (!isServerId) {
        demoSnapshotsRef.current.delete(conversationId);
        setConversationHistory((current) =>
          current.filter((item) => item.id !== conversationId),
        );
        if (activeConversationId === conversationId) {
          clearConversationScopedState();
        }
        setDeleteDialog(null);
        return;
      }

      setConversationHistoryBusy(true);
      try {
        await deleteAssistantConversation(conversationId);
        setConversationHistory((current) =>
          current.filter((item) => item.id !== conversationId),
        );
        if (activeConversationId === conversationId) {
          clearConversationScopedState();
        }
        setDeleteDialog(null);
      } catch {
        showWorkspaceToast("Impossible de supprimer cette discussion pour le moment.");
      } finally {
        setConversationHistoryBusy(false);
      }
    },
    [
      activeConversationId,
      clearConversationScopedState,
      conversationHistoryBusy,
      showWorkspaceToast,
      usesServerConversationPersistence,
    ],
  );

  const appendErrorMessage = useCallback(
    (params: {
      content: string;
      errorMessage: string;
      retryContent: string;
      retryable?: boolean;
    }) => {
      const errorMessage: AssistantMessage = {
        id: createMessageId("error"),
        role: "assistant",
        content: params.content,
        status: "error",
        errorMessage: params.errorMessage,
        retryContent: params.retryContent,
        retryable: params.retryable === true,
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
    async (
      userText: string,
    ): Promise<"success" | "failure" | "aborted"> => {
      const conversationEpoch = conversationEpochRef.current;
      const previousController = abortRef.current;
      if (previousController && !previousController.signal.aborted) {
        previousController.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;
      voluntaryAbortRef.current = null;
      if (mountedRef.current) {
        setGenerationControlState("running");
        setWorkspace((current) =>
          current.isGenerating ? current : { ...current, isGenerating: true },
        );
      }

      try {
        const conversationId = await ensureActiveConversation();
        if (
          controller.signal.aborted ||
          conversationEpochRef.current !== conversationEpoch
        ) {
          return "aborted";
        }
        if (!conversationId) {
          setComposerError(UX_COPY.requestSaveFailed.title);
          appendErrorMessage({
            content: UX_COPY.requestSaveFailed.title,
            errorMessage: UX_COPY.requestSaveFailed.description,
            retryContent: userText,
            retryable: true,
          });
          return "failure";
        }

        const argumentsPayload: Record<string, unknown> = {
          message: userText,
          conversation_id: conversationId,
        };
        if (draftSession.draftId) {
          argumentsPayload.draft_id = draftSession.draftId;
        }

        let result: Awaited<ReturnType<AgentTransport>>;
        try {
          result = await agentTransport(
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
        } catch {
          if (
            controller.signal.aborted ||
            conversationEpochRef.current !== conversationEpoch
          ) {
            return "aborted";
          }
          setPermissionNotice(false);
          setComposerError(UX_COPY.requestSaveFailed.title);
          appendErrorMessage({
            content: UX_COPY.requestSaveFailed.title,
            errorMessage: UX_COPY.requestSaveFailed.description,
            retryContent: userText,
            retryable: true,
          });
          return "failure";
        }

        if (
          controller.signal.aborted ||
          conversationEpochRef.current !== conversationEpoch ||
          (!result.ok && result.code === "ABORTED")
        ) {
          return "aborted";
        }

        if (!result.ok) {
          if (
            result.code === "PERMISSION_DENIED" ||
            result.code === "TENANT_ACCESS_DENIED" ||
            result.code === "permission_denied"
          ) {
            setPermissionNotice(true);
            setComposerError(UX_COPY.permissionDenied.title);
            setWorkspace((current) => ({ ...current, isGenerating: false }));
            return "failure";
          }
          setPermissionNotice(false);
          const failure = operationFailureCopy(result.code, "analysis");
          setComposerError(failure.content);
          appendErrorMessage({
            content: failure.content,
            errorMessage: failure.detail,
            retryContent: userText,
            retryable: canRetryConversationFailure(
              result.code,
              result.retryable,
            ),
          });
          return "failure";
        }

        const rawOutput = result.output as Record<string, unknown>;
        if (!rawOutput || Object.keys(rawOutput).length === 0) {
          setComposerError(UX_COPY.requestSaveFailed.title);
          appendErrorMessage({
            content: UX_COPY.requestSaveFailed.title,
            errorMessage: UX_COPY.requestSaveFailed.description,
            retryContent: userText,
            retryable: true,
          });
          return "failure";
        }

        const output = asConverseOutput(rawOutput);
        if (!output) {
          setComposerError(UX_COPY.requestSaveFailed.title);
          appendErrorMessage({
            content: UX_COPY.requestSaveFailed.title,
            errorMessage: UX_COPY.requestSaveFailed.description,
            retryContent: userText,
            retryable: true,
          });
          return "failure";
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
          setComposerError(UX_COPY.requestSaveFailed.title);
          appendErrorMessage({
            content: UX_COPY.requestSaveFailed.title,
            errorMessage: UX_COPY.requestSaveFailed.description,
            retryContent: userText,
            retryable: true,
          });
          return "failure";
        }

        const context = buildActiveContextFromConverse(output);
        const retainedClientName = context?.protection?.clientName;
        if (isFilledLabel(retainedClientName)) {
          setKnownClients((clients) =>
            upsertKnownClient(clients, { name: retainedClientName!.trim() }),
          );
        }

        setWorkspace((current) => {
          const dismissedSame = current.dismissedContextId === context.id;
          const shouldOpen =
            !dismissedSame && shouldAutoOpenProtectionPanel(context);
          return {
            ...current,
            messages: [...current.messages, assistantMessage],
            isGenerating: false,
            activeContext: context,
            isContextPanelOpen: shouldOpen
              ? true
              : current.isContextPanelOpen,
            shortcutPhase: resolveShortcutPhase(context),
          };
        });
        void refreshConversationHistory();
        return "success";
      } finally {
        const ownsController = abortRef.current === controller;
        const wasVoluntary = voluntaryAbortRef.current === controller;
        if (ownsController) {
          abortRef.current = null;
        }
        if (wasVoluntary) {
          voluntaryAbortRef.current = null;
        }
        if (ownsController && mountedRef.current) {
          setGenerationControlState("idle");
          setGeneratingLabel(null);
          setWorkspace((current) =>
            current.isGenerating
              ? { ...current, isGenerating: false }
              : current,
          );
          if (wasVoluntary) {
            setComposerError(null);
            setPermissionNotice(false);
            showWorkspaceToast("Génération interrompue.");
          }
        }
      }
    },
    [
      agentTransport,
      appendErrorMessage,
      draftSession.draftId,
      ensureActiveConversation,
      refreshConversationHistory,
      showWorkspaceToast,
    ],
  );

  const handleStopGeneration = useCallback(() => {
    if (generationControlState !== "running") return;
    const controller = abortRef.current;
    if (!controller || controller.signal.aborted) return;
    voluntaryAbortRef.current = controller;
    setGenerationControlState("stopping");
    controller.abort();
  }, [generationControlState]);

  const runConfirm = useCallback(async () => {
    if (
      confirmGuardRef.current ||
      !draftSession.draftId ||
      !draftSession.confirmationNonce
    ) {
      if (confirmGuardRef.current) return;
      appendErrorMessage({
        content: "Impossible de confirmer pour le moment.",
        errorMessage: "Le brouillon n’est pas prêt pour confirmation.",
        retryContent: "",
      });
      return;
    }
    confirmGuardRef.current = true;
    let controller: AbortController | null = null;

    try {
    abortRef.current?.abort();
    voluntaryAbortRef.current = null;
    setGenerationControlState("idle");
    controller = new AbortController();
    abortRef.current = controller;

    setWorkspace((current) => ({
      ...current,
      isGenerating: true,
    }));
    setGeneratingLabel("Création de la protection…");

    let result: Awaited<ReturnType<AgentTransport>>;
    try {
      result = await agentTransport(
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
    } catch {
      if (controller.signal.aborted) {
        setGeneratingLabel(null);
        setWorkspace((current) => ({ ...current, isGenerating: false }));
        return;
      }
      setComposerError(UX_COPY.requestSaveFailed.title);
      appendErrorMessage({
        content: UX_COPY.requestSaveFailed.title,
        errorMessage: UX_COPY.requestSaveFailed.description,
        retryContent: "",
        retryable: Boolean(draftSession.confirmationNonce),
      });
      setGeneratingLabel(null);
      return;
    }

    if (!result.ok) {
      if (result.code === "ABORTED") {
        setGeneratingLabel(null);
        setWorkspace((current) => ({ ...current, isGenerating: false }));
        return;
      }
      if (
        result.code === "PERMISSION_DENIED" ||
        result.code === "TENANT_ACCESS_DENIED" ||
        result.code === "permission_denied"
      ) {
        setPermissionNotice(true);
        setComposerError(UX_COPY.permissionDenied.title);
        setWorkspace((current) => ({ ...current, isGenerating: false }));
        setGeneratingLabel(null);
        return;
      }
      setPermissionNotice(false);
      const failure = operationFailureCopy(result.code, "confirmation");
      setComposerError(failure.content);
      appendErrorMessage({
        content: failure.content,
        errorMessage: failure.detail,
        retryContent: "",
        retryable:
          Boolean(draftSession.confirmationNonce) &&
          canRetryConversationFailure(result.code, result.retryable),
      });
      setGeneratingLabel(null);
      return;
    }

    const output = asConfirmOutput(result.output as Record<string, unknown>);
    if (!output) {
      appendErrorMessage({
        content: UX_COPY.requestSaveFailed.title,
        errorMessage: UX_COPY.requestSaveFailed.description,
        retryContent: "",
        retryable: Boolean(draftSession.confirmationNonce),
      });
      setGeneratingLabel(null);
      return;
    }

    const previousProtection = workspace.activeContext?.protection ?? null;
    const assistantMessage = buildAssistantMessageFromConfirm({
      messageId: createMessageId("assistant"),
      output,
      protection: previousProtection,
    });
    const context = buildActiveContextFromConfirm({
      output,
      previous: previousProtection,
    });

    setDraftSession({ draftId: null, confirmationNonce: null });
    setGeneratingLabel(null);
    setWorkspace((current) => ({
      ...current,
      messages: [
        ...current.messages,
        {
          ...assistantMessage,
          card: assistantMessage.card ?? {
            kind: "confirmation" as const,
            title: "Protection créée",
            subtitle: "Rien d’autre à faire pour le moment.",
          },
        },
      ],
      isGenerating: false,
      activeContext: context,
      isContextPanelOpen: true,
      dismissedContextId: null,
      shortcutPhase: resolveShortcutPhase(context),
    }));
    void refreshConversationHistory();
    } finally {
      if (controller && abortRef.current === controller) {
        abortRef.current = null;
      }
      confirmGuardRef.current = false;
    }
  }, [
    agentTransport,
    appendErrorMessage,
    draftSession.confirmationNonce,
    draftSession.draftId,
    refreshConversationHistory,
    workspace.activeContext?.protection,
  ]);

  const handleClientNameSubmit = useCallback(
    (name: string) => {
      const trimmedName = name.trim();
      if (trimmedName.length < 2) return;
      touchLocalConversation();
      const key = trimmedName.toLocaleLowerCase("fr");
      const existing = knownClients.find(
        (client) => client.name.trim().toLocaleLowerCase("fr") === key,
      );
      const assistantContent = existing
        ? `${existing.name} existe déjà${
            existing.email ? ` (${existing.email})` : ""
          }. Voulez-vous réutiliser ce client ?`
        : `Parfait. Quel est l’email de ${trimmedName} ?`;

      setClientIntake(
        existing
          ? { step: "existing", client: existing }
          : { step: "email", name: trimmedName },
      );
      setComposerError(null);
      setWorkspace((current) => ({
        ...current,
        messages: [
          ...current.messages,
          {
            id: createMessageId("user"),
            role: "user",
            content: trimmedName,
            status: "sent",
          },
          {
            id: createMessageId("assistant"),
            role: "assistant",
            content: assistantContent,
            suggestions: existing
              ? [
                  SUGGESTION_USE_EXISTING_CLIENT,
                  SUGGESTION_ENTER_ANOTHER_CLIENT,
                ]
              : [SUGGESTION_ENTER_EMAIL],
            status: "sent",
          },
        ],
        isGenerating: false,
      }));
      void persistDeterministicTurn(trimmedName, assistantContent);
    },
    [knownClients, persistDeterministicTurn, touchLocalConversation],
  );

  const finishClientIntake = useCallback(
    async (intake: Extract<ClientIntakeState, { step: "confirm" }>) => {
      setComposerError(null);
      if (!usesServerConversationPersistence) {
        setWorkspace((current) => ({
          ...current,
          messages: [
            ...current.messages,
            {
              id: createMessageId("assistant"),
              role: "assistant",
              content:
                "La création de client n’est pas disponible dans cet aperçu. Aucune donnée n’a été enregistrée.",
              status: "sent",
            },
          ],
          isGenerating: false,
        }));
        return false;
      }

      try {
        const conversationId = await ensureActiveConversation();
        if (!conversationId) {
          showWorkspaceToast("Je n’ai pas pu enregistrer cette discussion.");
          setWorkspace((current) => ({ ...current, isGenerating: false }));
          return false;
        }
        const formData = new FormData();
        formData.set("nom", intake.name);
        formData.set("email", intake.email);
        formData.set(
          "creationKey",
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : createIdempotencyKey("client"),
        );
        // conversationId DB = UUID uniquement (pas les ids démo locaux).
        if (/^[0-9a-f-]{36}$/i.test(conversationId)) {
          formData.set("conversationId", conversationId);
        }
        const result = await createClientPayeurAction(undefined, formData);
        if (!result.ok) {
          setComposerError(result.message);
          setWorkspace((current) => ({
            ...current,
            messages: [
              ...current.messages,
              {
                id: createMessageId("error"),
                role: "assistant",
                content: result.message,
                errorMessage:
                  "Les informations saisies sont conservées. Tu peux réessayer.",
                retryContent: SUGGESTION_CONFIRM_CLIENT,
                status: "error",
              },
            ],
            isGenerating: false,
          }));
          return false;
        }

        const client: KnownClient = {
          id: result.client?.id,
          name: result.client?.name ?? intake.name,
          email: result.client?.email ?? intake.email,
        };
        setClientIntake(null);
        setKnownClients((current) => upsertKnownClient(current, client));
        setPendingOrganization((current) => ({
          ...current,
          clientId: client.id ?? current.clientId,
          clientName: client.name,
        }));
        const resumesProtection =
          workspace.activeContext?.type === "protection_draft" &&
          workspace.activeContext.protection &&
          !isFilledLabel(workspace.activeContext.protection.clientName);
        const lead = result.existing
          ? `Ce client existe déjà : ${client.name}. Je le réutilise.`
          : `Client créé : ${client.name}.`;
        const assistantContent = resumesProtection
          ? `${lead}\nEmail : ${client.email}\n\nQuel montant veux-tu sécuriser ?`
          : `${lead}\nEmail : ${client.email}`;
        setWorkspace((current) => {
          const inProtectionDraft =
            current.activeContext?.type === "protection_draft" &&
            current.activeContext.protection &&
            !isFilledLabel(current.activeContext.protection.clientName);
          if (inProtectionDraft && current.activeContext?.protection) {
            const protection = {
              ...current.activeContext.protection,
              clientName: client.name,
            };
            const context: ActiveContext = {
              ...current.activeContext,
              protection,
            };
            return {
              ...current,
              messages: [
                ...current.messages,
                {
                  id: createMessageId("assistant"),
                  role: "assistant",
                  content: assistantContent,
                  suggestions: ["1 000 €", "2 500 €", SUGGESTION_OTHER_AMOUNT],
                  status: "sent",
                },
              ],
              activeContext: context,
              shortcutPhase: resolveShortcutPhase(context),
              isGenerating: false,
            };
          }

          return {
            ...current,
            messages: [
              ...current.messages,
              {
                id: createMessageId("assistant"),
                role: "assistant",
                content: assistantContent,
                suggestions: ["Créer une protection"],
                status: "sent",
              },
            ],
            isGenerating: false,
          };
        });
        await persistDeterministicTurn(
          SUGGESTION_CONFIRM_CLIENT,
          assistantContent,
        );
        return true;
      } catch {
        setComposerError("Impossible d'enregistrer le client pour le moment.");
        setWorkspace((current) => ({ ...current, isGenerating: false }));
        return false;
      }
    },
    [
      ensureActiveConversation,
      persistDeterministicTurn,
      showWorkspaceToast,
      usesServerConversationPersistence,
      workspace.activeContext,
    ],
  );

  const handleSend = useCallback(
    async (content: string, options?: { editMessageId?: string | null }) => {
      const trimmed = content.trim();
      const hasFiles = composerFiles.length > 0;
      if (
        (!trimmed && !hasFiles) ||
        workspace.isGenerating ||
        submitGuardRef.current !== null
      ) {
        return;
      }
      const submitToken = Symbol("assistant-submit");
      submitGuardRef.current = submitToken;

      try {
        const editOverrideId = options?.editMessageId;
        const activeEditId =
          editOverrideId !== undefined ? editOverrideId : editingMessageId;
        touchLocalConversation();

      setPermissionNotice(false);
      setGeneratingLabel(null);

      const createSpaceName = parseCreateClientSpaceSuggestion(trimmed);
      if (createSpaceName) {
        let project = findProjectByName(conversationProjects, createSpaceName);
        try {
          if (!project) {
            project = usesServerConversationPersistence
              ? await createAssistantProject({
                  name: createSpaceName,
                  ...DEFAULT_PROJECT_PERSONALIZATION,
                })
              : ensureNamedProject(createSpaceName);
            setConversationProjects((current) => [
              project!,
              ...current.filter((item) => item.id !== project!.id),
            ]);
          }
          if (usesServerConversationPersistence && activeConversationId) {
            await organizeAssistantConversation({
              conversationId: activeConversationId,
              projectId: project.id,
            });
          }
        } catch {
          setComposerError(UX_COPY.requestSaveFailed.title);
          return;
        }
        assignConversationToProject(project);
        setOfferedClientSpaces((current) => {
          const key = clientSpaceKey(createSpaceName);
          return current.includes(key) ? current : [...current, key];
        });
        const userMessage: AssistantMessage = {
          id: createMessageId("user"),
          role: "user",
          content: trimmed,
          status: "sent",
        };
        setWorkspace((current) => ({
          ...current,
          messages: [...current.messages, userMessage],
          isGenerating: false,
        }));
        askProtectionAmount(createSpaceName, "space-created");
        setDraft("");
        return;
      }

      if (trimmed === SUGGESTION_STAY_IN_GENERAL) {
        const clientName =
          workspace.activeContext?.protection?.clientName?.trim() || "ce client";
        const key = clientSpaceKey(clientName);
        setDeclinedClientSpaces((current) =>
          current.includes(key) ? current : [...current, key],
        );
        setOfferedClientSpaces((current) =>
          current.includes(key) ? current : [...current, key],
        );
        const userMessage: AssistantMessage = {
          id: createMessageId("user"),
          role: "user",
          content: trimmed,
          status: "sent",
        };
        setWorkspace((current) => ({
          ...current,
          messages: [...current.messages, userMessage],
          isGenerating: false,
        }));
        askProtectionAmount(clientName, "stay-general");
        setDraft("");
        return;
      }

      if (clientIntake?.step === "existing") {
        if (trimmed === SUGGESTION_ENTER_ANOTHER_CLIENT) {
          setClientIntake({ step: "name" });
          setDraft("");
          setComposerError(null);
          setWorkspace((current) => ({
            ...current,
            messages: [
              ...current.messages,
              {
                id: createMessageId("user"),
                role: "user",
                content: trimmed,
                status: "sent",
              },
              {
                id: createMessageId("assistant"),
                role: "assistant",
                content: "Quel est le nom du nouveau client ?",
                suggestions: [SUGGESTION_CLIENT_NAME],
                status: "sent",
              },
            ],
          }));
          return;
        }
        if (trimmed !== SUGGESTION_USE_EXISTING_CLIENT) {
          setComposerError(
            "Choisissez ce client ou saisissez un autre client.",
          );
          return;
        }

        const client = clientIntake.client;
        const conversationId = usesServerConversationPersistence
          ? await ensureActiveConversation()
          : activeConversationId;
        if (usesServerConversationPersistence && conversationId && client.id) {
          try {
            await organizeAssistantConversation({
              conversationId,
              clientId: client.id,
            });
          } catch {
            showWorkspaceToast("Je n’ai pas pu associer ce client.");
            return;
          }
        }
        setClientIntake(null);
        setDraft("");
        setPendingOrganization((current) => ({
          ...current,
          clientId: client.id ?? current.clientId,
          clientName: client.name,
        }));
        const canResumeProtection =
          workspace.activeContext?.type === "protection_draft" &&
          workspace.activeContext.protection &&
          !isFilledLabel(workspace.activeContext.protection.clientName);
        const assistantContent = canResumeProtection
          ? `Client sélectionné : ${client.name}.\n\nQuel montant voulez-vous sécuriser ?`
          : `Client sélectionné : ${client.name}.`;
        setWorkspace((current) => {
          const canResumeProtection =
            current.activeContext?.type === "protection_draft" &&
            current.activeContext.protection &&
            !isFilledLabel(current.activeContext.protection.clientName);
          const nextContext =
            canResumeProtection && current.activeContext?.protection
              ? {
                  ...current.activeContext,
                  protection: {
                    ...current.activeContext.protection,
                    clientName: client.name,
                  },
                }
              : current.activeContext;
          return {
            ...current,
            messages: [
              ...current.messages,
              {
                id: createMessageId("user"),
                role: "user",
                content: trimmed,
                status: "sent",
              },
              {
                id: createMessageId("assistant"),
                role: "assistant",
                content: assistantContent,
                suggestions: canResumeProtection
                  ? ["1 000 €", "2 500 €", SUGGESTION_OTHER_AMOUNT]
                  : ["Créer une protection"],
                status: "sent",
              },
            ],
            activeContext: nextContext,
            shortcutPhase: resolveShortcutPhase(nextContext),
          };
        });
        void persistDeterministicTurn(trimmed, assistantContent);
        return;
      }

      if (clientIntake?.step === "email") {
        if (!trimmed) return;
        if (!isValidSuggestionEmail(trimmed)) {
          setComposerError("Indique un email valide.");
          return;
        }
        setDraft("");
        setComposerFiles([]);
        setComposerError(null);
        setClientIntake({
          step: "confirm",
          name: clientIntake.name,
          email: trimmed,
        });
        const assistantContent = `Voici le récapitulatif avant création :\n${clientIntake.name}\n${trimmed}\n\nVeux-tu créer ce client ?`;
        setWorkspace((current) => ({
          ...current,
          messages: [
            ...current.messages,
            {
              id: createMessageId("user"),
              role: "user",
              content: trimmed,
              status: "sent",
            },
            {
              id: createMessageId("assistant"),
              role: "assistant",
              content: assistantContent,
              suggestions: [
                SUGGESTION_CONFIRM_CLIENT,
                SUGGESTION_EDIT_CLIENT_EMAIL,
              ],
              status: "sent",
            },
          ],
          isGenerating: false,
        }));
        void persistDeterministicTurn(trimmed, assistantContent);
        return;
      }

      if (clientIntake?.step === "name") {
        if (trimmed.length < 2) {
          setComposerError("Indique le nom du client.");
          return;
        }
        setDraft("");
        setComposerFiles([]);
        handleClientNameSubmit(trimmed);
        return;
      }

      if (clientIntake?.step === "confirm") {
        if (trimmed === SUGGESTION_EDIT_CLIENT_EMAIL) {
          setClientIntake({ step: "email", name: clientIntake.name });
          setDraft("");
          setComposerError(null);
          const assistantContent = `Quel est le bon email de ${clientIntake.name} ?`;
          setWorkspace((current) => ({
            ...current,
            messages: [
              ...current.messages,
              {
                id: createMessageId("user"),
                role: "user",
                content: trimmed,
                status: "sent",
              },
              {
                id: createMessageId("assistant"),
                role: "assistant",
                content: assistantContent,
                suggestions: [SUGGESTION_ENTER_EMAIL],
                status: "sent",
              },
            ],
          }));
          void persistDeterministicTurn(trimmed, assistantContent);
          return;
        }
        if (trimmed !== SUGGESTION_CONFIRM_CLIENT) {
          setComposerError(
            "Confirme la création ou choisis de modifier l’email.",
          );
          return;
        }
        setDraft("");
        setComposerFiles([]);
        setWorkspace((current) => ({
          ...current,
          messages: [
            ...current.messages,
            {
              id: createMessageId("user"),
              role: "user",
              content: trimmed,
              status: "sent",
            },
          ],
          isGenerating: true,
        }));
        const succeeded = await finishClientIntake(clientIntake);
        if (!succeeded) setDraft(trimmed);
        return;
      }

      // Même parcours que les actions rapides empty state (texte libre).
      const welcomeQuickAction = matchWelcomeQuickAction(trimmed);
      if (welcomeQuickAction && !hasFiles && !activeEditId) {
        setDraft("");
        setComposerFiles([]);
        setComposerError(null);
        setEditingMessageId(null);
        setPermissionNotice(false);
        handleShortcutRef.current({
          id: welcomeQuickAction.id,
          label: trimmed,
          action: welcomeQuickAction.action,
          emphasis: welcomeQuickAction.emphasis,
        });
        return;
      }

      const userContent = trimmed;
      const editTargetId = activeEditId;
      const editIndex = editTargetId
        ? workspace.messages.findIndex((item) => item.id === editTargetId)
        : -1;
      const isEditing = editIndex >= 0;
      const previousAttachments =
        isEditing ? workspace.messages[editIndex]?.attachments : undefined;
      const userMessageId = isEditing
        ? editTargetId!
        : createMessageId("user");
      const attachmentInvoiceIntent = hasInvoiceAttachmentIntent({
        files: composerFiles,
        instruction: trimmed,
        explicit: pendingInvoiceImport,
      });
      const attachmentInvoiceSummary = attachmentInvoiceIntent
        ? summarizeInvoiceAttachments(composerFiles)
        : null;
      const entireGroupIsInvoice =
        attachmentInvoiceSummary?.verdict === "likely_invoice";
      const attachments: MessageAttachment[] = composerFiles.map(
        (file, index) => {
          const previewUrl = URL.createObjectURL(file);
          attachmentPreviewUrlsRef.current.add(previewUrl);
          return {
            id: createMessageId("file"),
            name: file.name,
            size: file.size,
            type: file.type || "application/octet-stream",
            extension: getAttachmentExtension(file.name),
            positionInGroup: index + 1,
            messageId: userMessageId,
            category: classifyDocumentAttachment(file, {
              invoiceContext: entireGroupIsInvoice,
            }),
            persistenceStatus: "temporary",
            previewUrl,
            previewSource: file,
          };
        },
      );

      const userMessage: AssistantMessage = {
        id: userMessageId,
        role: "user",
        content: userContent,
        status: "sent",
        ...(attachments.length > 0
          ? { attachments }
          : isEditing && previousAttachments && previousAttachments.length > 0
            ? { attachments: previousAttachments }
            : {}),
      };

      const replaceFromEdit = (
        currentMessages: AssistantMessage[],
        next: AssistantMessage[],
      ): AssistantMessage[] => {
        if (!isEditing) return [...currentMessages, ...next];
        return [...currentMessages.slice(0, editIndex), ...next];
      };

      setEditingMessageId(null);
      setDraft("");
      setComposerFiles([]);
      setComposerError(null);
      setPermissionNotice(false);

      if (attachments.length > 0) {
        setPendingInvoiceImport(false);
        const reply = buildAttachmentReceiptReply(attachments);
        setWorkspace((current) => ({
          ...current,
          messages: replaceFromEdit(current.messages, [
            userMessage,
            {
              id: createMessageId("assistant"),
              role: "assistant",
              content: reply,
              status: "sent",
            },
          ]),
          isGenerating: false,
        }));
        return;
      }

      const documentRequest = resolveDocumentRequest(
        trimmed,
        workspace.messages,
      );
      if (documentRequest) {
        const startsClientIntake =
          documentRequest.kind === "resolved" &&
          documentRequest.action === "create_client";
        if (startsClientIntake) {
          setClientIntake({ step: "name" });
        }
        const assistantMessage: AssistantMessage = {
          id: createMessageId("assistant-document"),
          role: "assistant",
          content:
            documentRequest.kind === "clarification"
              ? documentRequest.message
              : startsClientIntake
                ? `J’ai retrouvé ${
                    documentRequest.attachments.length === 1
                      ? `« ${documentRequest.attachments[0]!.name} »`
                      : `les ${documentRequest.attachments.length} documents concernés`
                  }. La lecture automatique n’est pas disponible : je ne déduirai aucune donnée du document.\n\nQuel est le nom du client à créer ?`
                : buildResolvedDocumentReply(
                    documentRequest.action,
                    documentRequest.attachments,
                  ),
          suggestions: startsClientIntake ? [SUGGESTION_CLIENT_NAME] : undefined,
          status: "sent",
        };
        const selectedIds =
          documentRequest.kind === "resolved"
            ? new Set(documentRequest.attachments.map((file) => file.id))
            : null;

        setWorkspace((current) => {
          let existingMessages = current.messages;
          if (
            selectedIds &&
            documentRequest.kind === "resolved" &&
            (documentRequest.action === "remove" ||
              documentRequest.action === "keep")
          ) {
            existingMessages = existingMessages.map((message) => {
              if (!message.attachments?.length) return message;
              const nextAttachments = message.attachments.filter((file) =>
                documentRequest.action === "remove"
                  ? !selectedIds.has(file.id)
                  : selectedIds.has(file.id),
              );
              return {
                ...message,
                attachments:
                  nextAttachments.length > 0 ? nextAttachments : undefined,
              };
            });
          }
          return {
            ...current,
            messages: replaceFromEdit(existingMessages, [
              userMessage,
              assistantMessage,
            ]),
            isGenerating: false,
          };
        });
        return;
      }

      setWorkspace((current) => ({
        ...current,
        messages: replaceFromEdit(current.messages, [userMessage]),
        isGenerating: true,
      }));

      if (!liveAgent) {
        {
          let offeredClientName: string | null = null;
          const parsedEager = parseProtectionIntent(trimmed);
          if (
            parsedEager?.clientName &&
            isFilledLabel(parsedEager.clientName)
          ) {
            setKnownClients((clients) =>
              upsertKnownClient(clients, {
                name: parsedEager.clientName!.trim(),
              }),
            );
          }

          setWorkspace((current) => {
            const parsed = parsedEager;
            const richIntent = Boolean(
              parsed &&
                [parsed.clientName, parsed.amountLabel, parsed.dueDateLabel]
                  .filter(Boolean).length >= 2,
            );

            const guidedReply = richIntent && parsed
              ? buildDemoReplyFromParsedIntent(
                  parsed,
                  current.activeContext,
                  clientSuggestions,
                )
              : buildDemoProtectionReply(trimmed, current.activeContext) ??
                (parsed
                  ? buildDemoReplyFromParsedIntent(
                      parsed,
                      current.activeContext,
                      clientSuggestions,
                    )
                  : null);

            if (guidedReply) {
              const draftComplete =
                isFilledLabel(guidedReply.context.protection?.clientName) &&
                isFilledLabel(guidedReply.context.protection?.amountLabel) &&
                isFilledLabel(guidedReply.context.protection?.dueDateLabel);

              const previousClient =
                current.activeContext?.protection?.clientName?.trim() ?? "";
              const nextClient =
                guidedReply.context.protection?.clientName?.trim() ?? "";
              const clientNewlyRetained =
                Boolean(nextClient) &&
                previousClient.toLocaleLowerCase("fr") !==
                  nextClient.toLocaleLowerCase("fr");

              let message = guidedReply.message;
              const amountReady = isFilledLabel(
                guidedReply.context.protection?.amountLabel,
              );
              if (
                clientNewlyRetained &&
                !amountReady &&
                shouldOfferClientSpace({
                  clientName: nextClient,
                  projects: conversationProjects,
                  declinedKeys: new Set(declinedClientSpaces),
                  alreadyOfferedKeys: new Set(offeredClientSpaces),
                })
              ) {
                offeredClientName = nextClient;
                message = {
                  ...guidedReply.message,
                  content: `Parfait, je retiens ${nextClient}.\n\nSi tu veux, je peux créer un espace « ${nextClient} » pour classer tes discussions avec ce client — sinon on reste dans Général.`,
                  suggestions: [
                    suggestionCreateClientSpace(nextClient),
                    SUGGESTION_STAY_IN_GENERAL,
                  ],
                };
              }

              return {
                ...current,
                messages: [...current.messages, message],
                activeContext: guidedReply.context,
                shortcutPhase: resolveShortcutPhase(guidedReply.context),
                isContextPanelOpen: draftComplete
                  ? true
                  : current.isContextPanelOpen,
                isGenerating: false,
              };
            }

            const assistantMessage: AssistantMessage = {
              id: createMessageId("assistant"),
              role: "assistant",
              content:
                "Je peux vous aider à préparer une protection, créer un client ou consulter vos paiements.\n\nPrécisez simplement le résultat souhaité ; aucune action ne sera exécutée sans votre confirmation.",
              status: "sent",
            };
            return {
              ...current,
              messages: [...current.messages, assistantMessage],
              isGenerating: false,
            };
          });

          if (offeredClientName) {
            const key = clientSpaceKey(offeredClientName);
            setOfferedClientSpaces((offered) =>
              offered.includes(key) ? offered : [...offered, key],
            );
          }
        }
        return;
      }

      const outcome = await runConverse(trimmed);
      if (outcome === "failure") {
        setDraft(content);
      }
      } finally {
        if (submitGuardRef.current === submitToken) {
          submitGuardRef.current = null;
        }
        restoreComposerFocus();
      }
    },
    [
      askProtectionAmount,
      activeConversationId,
      assignConversationToProject,
      clientIntake,
      clientSuggestions,
      composerFiles,
      conversationProjects,
      declinedClientSpaces,
      editingMessageId,
      ensureActiveConversation,
      ensureNamedProject,
      finishClientIntake,
      handleClientNameSubmit,
      liveAgent,
      offeredClientSpaces,
      pendingInvoiceImport,
      persistDeterministicTurn,
      runConverse,
      showWorkspaceToast,
      touchLocalConversation,
      usesServerConversationPersistence,
      workspace.activeContext,
      workspace.isGenerating,
      workspace.messages,
    ],
  );

  const handleShortcut = useCallback(
    (shortcut: ComposerShortcut) => {
      setLastShortcutAction(shortcut.action);
      onShortcutAction?.(shortcut.action);
      setPermissionNotice(false);
      setComposerError(null);

      if (shortcut.action === "reopen_protection_panel") {
        reopenContextPanel();
        return;
      }

      if (shortcut.action === "view_expected_payments") {
        touchLocalConversation();
        const userMessage: AssistantMessage = {
          id: createMessageId("user"),
          role: "user",
          content: shortcut.label,
          status: "sent",
        };
        const assistantMessage = buildPaymentsSummaryMessage(
          paymentSummary,
          welcomeBriefCards,
        );
        setWorkspace((current) => ({
          ...current,
          messages: [...current.messages, userMessage, assistantMessage],
          isGenerating: false,
        }));
        void persistDeterministicTurn(
          shortcut.label,
          assistantMessage.content,
        );
        return;
      }

      if (shortcut.action === "view_actions") {
        router.push("/app/activite");
        return;
      }

      if (shortcut.action === "create_client") {
        touchLocalConversation();
        setClientIntake({ step: "name" });
        const assistantContent = "Quel est le nom du nouveau client ?";
        setWorkspace((current) => ({
          ...current,
          messages: [
            ...current.messages,
            {
              id: createMessageId("user"),
              role: "user",
              content: "Créer un client",
              status: "sent",
            },
            {
              id: createMessageId("assistant"),
              role: "assistant",
              content: assistantContent,
              suggestions: [SUGGESTION_CLIENT_NAME],
              status: "sent",
            },
          ],
          isGenerating: false,
        }));
        void persistDeterministicTurn("Créer un client", assistantContent);
        return;
      }

      if (
        shortcut.action === "add_invoice" ||
        shortcut.action === "add_another_invoice"
      ) {
        touchLocalConversation();
        const assistantContent =
          "Importe ta facture avec le sélecteur de fichiers. Indique-moi ensuite ce que tu veux sécuriser à partir de ce document.";
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
              content: assistantContent,
              status: "sent",
            },
          ],
          isGenerating: false,
        }));
        void persistDeterministicTurn(shortcut.label, assistantContent);
        setPendingFilePick(true);
        setPendingInvoiceImport(true);
        return;
      }

      if (shortcut.action === "find_client") {
        touchLocalConversation();
        const userMessage: AssistantMessage = {
          id: createMessageId("user"),
          role: "user",
          content: "Créer un client",
          status: "sent",
        };
        const assistantMessage: AssistantMessage = {
          id: createMessageId("assistant"),
          role: "assistant",
          content:
            "Pour garder tes échanges clairs, veux-tu ouvrir une discussion dédiée à ce client ou continuer ici ?",
          status: "sent",
          actions: [
            {
              id: "new-client-conversation",
              label: "Nouvelle discussion",
              kind: "new_client_conversation",
            },
            {
              id: "continue-client-conversation",
              label: "Continuer ici",
              kind: "continue_client_conversation",
            },
          ],
        };
        setWorkspace((current) => ({
          ...current,
          messages: [...current.messages, userMessage, assistantMessage],
          isGenerating: false,
        }));
        void persistDeterministicTurn(
          userMessage.content,
          assistantMessage.content,
        );
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

      if (shortcut.action === "create_protection") {
        if (!liveAgent) {
          touchLocalConversation();
          setWorkspace((current) =>
            startLocalProtection(
              current,
              clientSuggestions,
              shortcut.label,
            ),
          );
          return;
        }

        handleSend(CREATE_PROTECTION_PROMPT);
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
      clientSuggestions,
      onShortcutAction,
      reopenContextPanel,
      router,
      paymentSummary,
      persistDeterministicTurn,
      touchLocalConversation,
      welcomeBriefCards,
      workspace.activeContext?.protection,
      workspace.messages,
    ],
  );

  useEffect(() => {
    handleShortcutRef.current = handleShortcut;
  }, [handleShortcut]);

  const handleWelcomeSuggestion = useCallback(
    (action: string) => {
      const match = WELCOME_SUGGESTIONS.find((item) => item.action === action);
      if (!match) return;
      handleShortcut({
        id: match.id,
        label: match.label,
        action: match.action,
        emphasis: match.emphasis,
      });
    },
    [handleShortcut],
  );

  const handleRetryMessage = useCallback(
    async (message: AssistantMessage) => {
      const retryContent = message.retryContent?.trim() ?? "";
      const canRetryConfirmation =
        !retryContent && Boolean(draftSession.confirmationNonce);
      if (
        message.retryable !== true ||
        workspace.isGenerating ||
        submitGuardRef.current !== null ||
        (!retryContent && !canRetryConfirmation)
      ) {
        return;
      }

      const submitToken = Symbol("assistant-retry");
      submitGuardRef.current = submitToken;
      setComposerError(null);
      setPermissionNotice(false);
      setGeneratingLabel(null);
      setDraft("");
      setWorkspace((current) => ({
        ...current,
        messages: current.messages.filter((item) => item.id !== message.id),
        isGenerating: true,
      }));

      try {
        if (canRetryConfirmation) {
          await runConfirm();
          return;
        }
        const outcome = await runConverse(retryContent);
        if (outcome === "failure") {
          setDraft(retryContent);
        }
      } finally {
        if (submitGuardRef.current === submitToken) {
          submitGuardRef.current = null;
        }
        restoreComposerFocus();
      }
    },
    [
      draftSession.confirmationNonce,
      runConfirm,
      runConverse,
      workspace.isGenerating,
    ],
  );

  useEffect(() => {
    if (createProtectionBootstrapped.current) return;
    if (initialAction !== "create_protection") return;
    createProtectionBootstrapped.current = true;
    onShortcutAction?.("create_protection");
    if (usesServerConversationPersistence) {
      const conversationEpoch = conversationEpochRef.current;
      const pending = createAssistantConversation(
        pendingOrganization.clientId,
      )
        .then(async (conversation) => {
          if (conversationEpochRef.current !== conversationEpoch) {
            await deleteAssistantConversation(conversation.id).catch(
              () => undefined,
            );
            return null;
          }
          activeConversationIdRef.current = conversation.id;
          setActiveConversationId(conversation.id);
          return conversation.id;
        })
        .catch(() => {
          setComposerError(UX_COPY.requestSaveFailed.title);
          appendErrorMessage({
            content: UX_COPY.requestSaveFailed.title,
            errorMessage: UX_COPY.requestSaveFailed.description,
            retryContent: CREATE_PROTECTION_PROMPT,
            retryable: true,
          });
          return null;
        });
      conversationCreationRef.current = pending;
      void pending
        .then((conversationId) => {
          if (conversationId) {
            void runConverse(CREATE_PROTECTION_PROMPT);
          }
        })
        .finally(() => {
          if (conversationCreationRef.current === pending) {
            conversationCreationRef.current = null;
          }
        });
    }
    router.replace("/app/assistant", { scroll: false });
  }, [
    appendErrorMessage,
    initialAction,
    onShortcutAction,
    pendingOrganization.clientId,
    router,
    runConverse,
    usesServerConversationPersistence,
  ]);

  const handleMessageAction = useCallback(
    (action: AssistantMessageAction, message: AssistantMessage) => {
      if (action.kind === "retry") {
        void handleRetryMessage(message);
        return;
      }

      if (action.kind === "confirm_protection") {
        void runConfirm();
        return;
      }

      if (action.kind === "edit_protection") {
        reopenContextPanel();
        return;
      }

      if (action.kind === "open_protection" && action.href) {
        router.push(action.href);
        return;
      }

      if (
        action.kind === "new_client_conversation" ||
        action.kind === "continue_client_conversation"
      ) {
        void (async () => {
          try {
            if (action.kind === "new_client_conversation") {
              // Même état vide que « Sidian » / « Demander à Sidian » :
              // aucune ligne serveur n’est créée avant le premier message utile.
              await handleNewConversation();
              router.push("/app/clients");
              return;
            }

            const conversationId = activeConversationId;
            if (!conversationId) {
              router.push("/app/clients");
              return;
            }
            router.push(
              `/app/clients?conversation=${encodeURIComponent(conversationId)}`,
            );
          } catch {
            setComposerError(UX_COPY.requestSaveFailed.title);
          }
        })();
      }
    },
    [
      activeConversationId,
      handleRetryMessage,
      handleNewConversation,
      reopenContextPanel,
      router,
      runConfirm,
    ],
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
      return;
    }

    // Continuer la protection : ramène le focus sur le composer.
    const input = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="composer-input"]',
    );
    input?.focus();
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
      void error;
      setPanelActionError(UX_COPY.requestSaveFailed.title);
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

  const panelMode =
    viewport === "tablet" ? "overlay" : viewport === "mobile" ? "sheet" : "inline";

  const mobileSheetOpen =
    viewport === "mobile" &&
    workspace.isContextPanelOpen &&
    workspace.activeContext !== null;

  const workMode = !showWelcome;

  // `aria-hidden` seul laissait le composer focusable au clavier (axe
  // aria-hidden-focus / WCAG 4.1.2) : `inert` le sort aussi de l'ordre de
  // tabulation tant que la feuille mobile est ouverte.
  useEffect(() => {
    const dock = composerDockRef.current;
    if (!dock) return;
    if (mobileSheetOpen) dock.setAttribute("inert", "");
    else dock.removeAttribute("inert");
    // `showWelcome` monte/démonte le dock : la dépendance garantit que l'attribut
    // est réappliqué au remontage.
  }, [mobileSheetOpen, showWelcome]);

  useEffect(() => {
    if (!mobileSheetOpen) return;
    const { body, documentElement } = document;
    const previousBodyOverflow = body.style.overflow;
    const previousHtmlOverflow = documentElement.style.overflow;
    const previousBodyTouchAction = body.style.touchAction;
    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";
    body.style.touchAction = "none";
    return () => {
      body.style.overflow = previousBodyOverflow;
      documentElement.style.overflow = previousHtmlOverflow;
      body.style.touchAction = previousBodyTouchAction;
    };
  }, [mobileSheetOpen]);

  const resolvedWelcomeState: WelcomeDataState =
    welcomeDataState ??
    resolveWelcomeDataState({
      todayOutstandingCents: 0,
      todayCount: 0,
      overdueCount: 0,
      attentionCount: 0,
    });

  const draftProtection = workspace.activeContext?.protection;
  const draftHasProgress =
    workspace.activeContext?.type === "protection_draft" &&
    Boolean(draftProtection) &&
    (isFilledLabel(draftProtection?.clientName) ||
      isFilledLabel(draftProtection?.amountLabel) ||
      isFilledLabel(draftProtection?.dueDateLabel));

  // Pas de bannière « brouillon » dans le fil : questions + suggestions IA suffisent.
  const earlyProtectionDraft =
    workspace.activeContext?.type === "protection_draft" && !draftHasProgress;

  // Empty state uniquement — en discussion le CTA vit dans la sidebar.
  const composerShortcuts: ComposerShortcut[] = showWelcome
    ? WELCOME_SUGGESTIONS.map((suggestion) => ({ ...suggestion }))
    : [];
  const hideComposerShortcuts = !showWelcome || workspace.isGenerating;

  const conversationFiles = useMemo(
    () =>
      workspace.messages.flatMap((message) => message.attachments ?? []),
    [workspace.messages],
  );
  const conversationLinks = useMemo(
    () =>
      extractConversationLinks(
        workspace.messages.map((message) => message.content),
      ),
    [workspace.messages],
  );
  const showConversationResources =
    !showWelcome &&
    (conversationFiles.length > 0 || conversationLinks.length > 0);
  const showConversationToolbar = !showWelcome;
  const resolvedConversationHistory = useMemo(() => {
    if (
      usesServerConversationPersistence ||
      !activeConversationId ||
      workspace.messages.length === 0
    ) {
      return conversationHistory;
    }
    const previous = conversationHistory.find(
      (item) => item.id === activeConversationId,
    );
    const item = buildCurrentLocalHistoryItem(
      activeConversationId,
      previous,
      previous?.updatedAt ?? "1970-01-01T00:00:00.000Z",
    );
    if (!previous) return [item, ...conversationHistory];
    return conversationHistory.map((entry) =>
      entry.id === activeConversationId ? item : entry,
    );
  }, [
    activeConversationId,
    buildCurrentLocalHistoryItem,
    conversationHistory,
    usesServerConversationPersistence,
    workspace.messages.length,
  ]);
  const activeHistoryItem = resolvedConversationHistory.find(
    (item) => item.id === activeConversationId,
  );
  const organizeOptions = useMemo(
    () =>
      buildConversationOrganizeOptions({
        projects: conversationProjects,
      }),
    [conversationProjects],
  );

  const activeHistoryTitle = activeHistoryItem?.title ?? null;
  const discussionTitle = useMemo(() => {
    if (activeHistoryTitle) return activeHistoryTitle;
    if (localConversationTitle) return localConversationTitle;
    return deriveConversationTitle({
      clientName:
        pendingOrganization.clientName ??
        workspace.activeContext?.protection?.clientName ??
        null,
      messages: workspace.messages,
    });
  }, [
    activeHistoryTitle,
    localConversationTitle,
    pendingOrganization.clientName,
    workspace.activeContext?.protection?.clientName,
    workspace.messages,
  ]);
  const dismissWorkspaceToast = useCallback(() => {
    setWorkspaceToast(null);
  }, []);

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

  const composerNotices = (
    <>
      <OfflineBanner surface="dark" />
      {permissionNotice ? <PermissionDenied surface="dark" /> : null}
    </>
  );

  const composerSurface = (
    <Composer
      value={draft}
      onChange={(value) => {
        setDraft(value);
        if (composerError) setComposerError(null);
        if (permissionNotice) setPermissionNotice(false);
      }}
      onSubmit={() => {
        handleSend(draft);
      }}
      onStop={
        generationControlState === "idle"
          ? undefined
          : handleStopGeneration
      }
      isStopping={generationControlState === "stopping"}
      disabled={workspace.isGenerating}
      isLoading={workspace.isGenerating}
      error={composerError}
      editing={Boolean(editingMessageId)}
      onCancelEdit={handleCancelEditMessage}
      placeholder={
        earlyProtectionDraft
          ? "Ex. Dupont Conseil, ou le nom de ton client…"
          : showWelcome
            ? WELCOME_COMPOSER_PLACEHOLDER
            : COMPOSER_PLACEHOLDER
      }
      files={composerFiles}
      openFilePickerRef={openFilePickerRef}
      onAddFiles={(nextFiles) => {
        const validation = validateDocumentFiles(nextFiles);
        if (validation.rejected.length > 0) {
          showWorkspaceToast(
            validation.rejected.map((item) => item.message).join(" "),
          );
        }
        setComposerFiles((current) => {
          // Deux fichiers peuvent légitimement porter le même nom.
          return [...current, ...validation.accepted].slice(
            0,
            COMPOSER_MAX_FILES,
          );
        });
      }}
      onFileLimitReached={(acceptedCount) => {
        showWorkspaceToast(buildComposerFileLimitMessage(acceptedCount));
      }}
      onRemoveFile={(target) => {
        setComposerFiles((current) =>
          current.filter((file) => file !== target),
        );
      }}
      previewDropOverlay={composerPreviewState === "drop"}
      welcomeMode={showWelcome}
    />
  );

  const composerShortcutSurface = (
    <ComposerShortcuts
      shortcuts={composerShortcuts}
      onSelect={(shortcut) => {
        if (showWelcome) {
          handleWelcomeSuggestion(shortcut.action);
          return;
        }
        handleShortcut(shortcut);
      }}
      hidden={hideComposerShortcuts}
      welcomeMode={showWelcome}
    />
  );

  return (
    <AppShell
      variant="workspace"
      appearance="agent-dark"
      userDisplayName={userDisplayName}
      userEmail={userEmail}
      userPlan={userPlan}
      defaultMobileNavOpen={defaultMobileNavOpen}
      shellTestId="assistant-shell"
      conversationHistory={resolvedConversationHistory}
      conversationProjects={conversationProjects}
      activeConversationId={activeConversationId}
      conversationHistoryBusy={conversationHistoryBusy}
      onNewConversation={() => {
        void handleNewConversation();
      }}
      onSelectConversation={(conversationId) => {
        void handleSelectConversation(conversationId);
      }}
      onDeleteConversation={(conversationId) => {
        void requestDeleteConversation(conversationId);
      }}
      onCreateProject={handleCreateProject}
      onEditProject={handleEditProject}
      onDuplicateProject={handleDuplicateProject}
      onDeleteProject={handleDeleteProject}
      sidebarOnboardingFacts={sidebarOnboardingFacts}
      onImportInvoice={() => {
        handleWelcomeSuggestion("add_invoice");
      }}
      onCreateProtection={() => {
        void (async () => {
          await handleNewConversation();
          handleWelcomeSuggestion("create_protection");
        })();
      }}
    >
      <div
        data-testid="conversational-workspace"
        data-viewport={viewport}
        data-panel-open={panelVisible ? "true" : "false"}
        data-work-mode={workMode ? "true" : "false"}
        data-live-agent={liveAgent ? "true" : "false"}
        data-appearance="agent-dark"
        data-last-shortcut={lastShortcutAction ?? undefined}
        className={styles.workspace}
      >
        <WorkspaceToast
          key={workspaceToast?.id ?? "none"}
          message={workspaceToast?.message ?? null}
          onDismiss={dismissWorkspaceToast}
        />
        <section
          id="assistant-discussion"
          data-testid="discussion-pane"
          data-main-content
          className={styles.discussion}
          aria-label="Espace de travail"
        >
          {showConversationToolbar ? (
            <div className={styles.resourcesAnchor}>
              <div className={resourceStyles.toolbar}>
                {showConversationResources ? (
                  <ConversationResources
                    files={conversationFiles}
                    links={conversationLinks}
                  />
                ) : null}
                <ConversationOrganize
                  options={organizeOptions}
                  activeClientId={
                    pendingOrganization.clientId ??
                    activeHistoryItem?.clientId ??
                    null
                  }
                  activeClientName={
                    pendingOrganization.clientName ??
                    activeHistoryItem?.clientName ??
                    null
                  }
                  activeProjectId={
                    pendingOrganization.projectId ??
                    activeHistoryItem?.projectId ??
                    null
                  }
                  activeProjectName={
                    pendingOrganization.projectName ??
                    activeHistoryItem?.projectName ??
                    null
                  }
                  onSelect={(option) => {
                    void handleOrganizeConversation(option);
                  }}
                  onCreateProject={handleCreateProject}
                />
              </div>
            </div>
          ) : null}
          {!showWelcome ? (
            <div className={styles.titleBarSlot}>
              <ConversationTitleBar
                title={discussionTitle}
                onRename={handleRenameConversation}
              />
            </div>
          ) : null}
          <div
            ref={scrollerRef}
            className={styles.scroller}
          >
            <div
              data-testid="conversation-content"
              className={cx(
                styles.content,
                showWelcome
                  ? styles.welcomeContent
                  : cx(
                      panelVisible
                        ? styles.contentWithPanel
                        : styles.contentWide,
                      styles.conversationContent,
                    ),
              )}
            >
              <div
                className={cx(
                  styles.contentInner,
                  showWelcome && styles.contentInnerWelcome,
                  workMode && styles.contentInnerWork,
                )}
              >
                {showWelcome ? (
                  <>
                    <WelcomeState
                      userFirstName={userFirstName}
                      summaryLines={summaryLines}
                      visible
                      dataState={resolvedWelcomeState}
                      briefCards={welcomeBriefCards}
                    />
                    <div
                      data-testid="welcome-composer-group"
                      data-welcome-group
                      className={styles.welcomeComposerGroup}
                    >
                      {composerNotices}
                      {composerSurface}
                      {composerShortcutSurface}
                    </div>
                  </>
                ) : (
                  <>
                    <MessageThread
                      messages={workspace.messages}
                      busy={workspace.isGenerating}
                      editingMessageId={editingMessageId}
                      onSuggestionSelect={(suggestion) => {
                        if (suggestion === "Créer une protection") {
                          handleWelcomeSuggestion("create_protection");
                          return;
                        }
                        if (suggestion === "Importer une facture") {
                          handleWelcomeSuggestion("add_invoice");
                          return;
                        }
                        handleSend(suggestion);
                      }}
                      onClientNameSubmit={handleClientNameSubmit}
                      onAction={handleMessageAction}
                      onMessageFeedback={handleMessageFeedback}
                      onEditMessage={
                        usesServerConversationPersistence
                          ? undefined
                          : handleEditMessage
                      }
                      onOpenCard={(message) => {
                        const kind = message.card?.kind;
                        if (kind === "payment") {
                          router.push("/app/paiements");
                          return;
                        }
                        if (kind === "action_needed") {
                          router.push("/app/activite");
                          return;
                        }
                        if (
                          kind === "protection" ||
                          kind === "protection_draft"
                        ) {
                          reopenContextPanel();
                        }
                      }}
                    />
                    {workspace.isGenerating &&
                    workspace.messages.at(-1)?.status !== "streaming" ? (
                      <GeneratingIndicator
                        className={styles.generating}
                        label={generatingLabel ?? undefined}
                      />
                    ) : null}
                    <div
                      ref={threadEndRef}
                      aria-hidden
                      className={styles.threadEnd}
                    />
                  </>
                )}
              </div>
            </div>
          </div>

          {!showWelcome ? (
            <div
              ref={composerDockRef}
              data-testid="assistant-composer-dock"
              className={cx(
                "assistant-composer-dock",
                styles.composerDock,
                mobileSheetOpen && styles.composerDockBlocked,
              )}
              aria-hidden={mobileSheetOpen ? true : undefined}
              style={
                {
                  "--assistant-keyboard-offset": `${keyboardOffset}px`,
                  ...(previewComposerOffset !== undefined
                    ? {
                        "--assistant-keyboard-offset": `${previewComposerOffset}px`,
                      }
                    : {}),
                } as CSSProperties
              }
            >
              <div
                className={cx(
                  styles.composerInner,
                  panelVisible ? styles.composerWithPanel : styles.composerWide,
                )}
              >
                {composerNotices}
                {composerShortcutSurface}
                {composerSurface}
              </div>
            </div>
          ) : null}
        </section>

        {/* panelProps : callbacks stables — faux positif react-hooks/refs sur le spread */}
        {/* eslint-disable-next-line react-hooks/refs -- panelProps is plain state + callbacks, not a ref */}
        {panelVisible && panelProps ? (
          <ProtectionPanel
            {...panelProps}
            mode={panelMode === "overlay" ? "overlay" : "inline"}
          />
        ) : null}

        {/* eslint-disable-next-line react-hooks/refs -- same as above */}
        {mobileSheetOpen && panelProps ? (
          <>
            {/* Refermer en touchant hors de la feuille — sans perte de contexte. */}
            <div
              aria-hidden
              className={styles.sheetBackdrop}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeContextPanel();
              }}
            />
            <ProtectionPanel {...panelProps} mode="sheet" />
          </>
        ) : null}
      </div>

      <ProjectCreationDrawer
        key={editingProject?.id ?? "create-project"}
        open={projectDrawerOpen}
        mode={editingProject ? "edit" : "create"}
        initialValue={
          editingProject
            ? {
                name: editingProject.name,
                icon:
                  editingProject.icon ??
                  DEFAULT_PROJECT_PERSONALIZATION.icon,
                color:
                  editingProject.color ??
                  DEFAULT_PROJECT_PERSONALIZATION.color,
              }
            : undefined
        }
        anchor={projectDrawerAnchor}
        onClose={() => {
          setProjectDrawerOpen(false);
          setProjectDrawerAnchor(null);
        }}
        onConfirm={handleConfirmProject}
      />

      <WorkspaceConfirmDialog
        open={Boolean(deleteDialog)}
        title={
          deleteDialog
            ? `Supprimer « ${deleteDialog.label} » ?`
            : "Supprimer cette discussion ?"
        }
        description="Cette action est définitive."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        destructive
        busy={conversationHistoryBusy}
        onClose={() => {
          if (!conversationHistoryBusy) setDeleteDialog(null);
        }}
        onConfirm={() => {
          if (!deleteDialog) return;
          void handleDeleteConversation(deleteDialog.id);
        }}
      />

      <WorkspaceConfirmDialog
        open={Boolean(projectDeleteDialog)}
        title={
          projectDeleteDialog
            ? `Supprimer « ${projectDeleteDialog.name} » ?`
            : "Supprimer ce projet ?"
        }
        description={
          projectDeleteConversationCount === 0
            ? "Ce projet est vide. Aucune discussion ne sera supprimée."
            : `${projectDeleteConversationCount} ${
                projectDeleteConversationCount === 1
                  ? "discussion sera déplacée"
                  : "discussions seront déplacées"
              } vers Discussions. Aucun message ne sera supprimé.`
        }
        confirmLabel={
          projectDeleteConversationCount === 0
            ? "Supprimer le projet"
            : "Déplacer les discussions vers Discussions"
        }
        cancelLabel="Annuler"
        destructive
        busy={projectDeleteBusy}
        onClose={() => {
          if (!projectDeleteBusy) setProjectDeleteDialog(null);
        }}
        onConfirm={() => {
          void confirmDeleteProject();
        }}
      />
    </AppShell>
  );
}
