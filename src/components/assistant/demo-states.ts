import { CONSEQUENCE_COPY } from "./protection-panel/microcopy";
import type {
  ActiveContext,
  ActiveContextData,
  AssistantMessage,
  ConversationalWorkspaceState,
  DemoStateId,
  ShortcutPhase,
} from "./types";
import { resolveShortcutPhase } from "./shortcuts";

const DRAFT_CONTEXT: ActiveContextData = {
  id: "ctx-dupont-draft",
  type: "protection_draft",
  protection: {
    clientName: "Dupont Conseil",
    statusLabel: "Brouillon",
    status: "draft",
    amountLabel: "2 400 €",
    subject: "Site internet",
    dueDateLabel: "24 août 2026",
    paymentMethodLabel: "Le client choisira au moment du paiement",
    authorizationLabel: "Pas encore proposée",
    autoDebitRuleLabel: "Pas encore activé",
    nextStepLabel: "Vérification à l’échéance",
    consequenceLabel: CONSEQUENCE_COPY.draft,
    primaryActionLabel: "Créer la protection",
    secondaryActionLabel: "Annuler le brouillon",
  },
};

const ACTIVE_CONTEXT: ActiveContextData = {
  id: "ctx-dupont-active",
  type: "protection",
  protection: {
    clientName: "Dupont Conseil",
    statusLabel: "Active",
    status: "active",
    amountLabel: "2 400 €",
    subject: "Site internet",
    dueDateLabel: "24 août 2026",
    paymentMethodLabel: "Carte ou prélèvement — au choix du client",
    authorizationLabel: "Sera proposée au premier paiement",
    autoDebitRuleLabel: "Activable après autorisation du client",
    nextStepLabel: "Suivi à l’échéance",
    consequenceLabel: CONSEQUENCE_COPY.active,
    primaryActionLabel: "Voir le détail",
  },
};

const MESSAGE_USER: AssistantMessage = {
  id: "m-user-1",
  role: "user",
  content:
    "Je dois recevoir 2 400 € de Dupont Conseil le 12 septembre. Le contact est jean@dupont.fr.",
};

const MESSAGE_ASSISTANT_PARTIAL: AssistantMessage = {
  id: "m-assistant-1",
  role: "assistant",
  content:
    "On prépare une protection.\n\nJ’ai besoin de :\n• ton client\n• le montant\n• la date d’échéance",
  suggestions: ["30 jours", "Fin du mois", "Choisir une date"],
};

const MESSAGE_ASSISTANT_CREATED: AssistantMessage = {
  id: "m-assistant-2",
  role: "assistant",
  content:
    "La protection Dupont Conseil est active.\n\nProchaine étape : vérification à l’échéance du 24 août.",
};

const MESSAGE_USER_ANSWER: AssistantMessage = {
  id: "m-user-2",
  role: "user",
  content: "30 jours",
};

function buildState(params: {
  messages: AssistantMessage[];
  activeContext: ActiveContext;
  isContextPanelOpen: boolean;
  dismissedContextId?: string | null;
  isGenerating?: boolean;
}): ConversationalWorkspaceState {
  const shortcutPhase: ShortcutPhase = resolveShortcutPhase(
    params.activeContext,
  );
  return {
    messages: params.messages,
    activeContext: params.activeContext,
    isContextPanelOpen: params.isContextPanelOpen,
    isGenerating: params.isGenerating ?? false,
    dismissedContextId: params.dismissedContextId ?? null,
    shortcutPhase,
  };
}

export function getDemoWorkspaceState(
  demo: DemoStateId,
): ConversationalWorkspaceState {
  switch (demo) {
    case "A":
      return buildState({
        messages: [],
        activeContext: null,
        isContextPanelOpen: false,
      });
    case "B":
      return buildState({
        messages: [MESSAGE_USER, MESSAGE_ASSISTANT_PARTIAL],
        activeContext: null,
        isContextPanelOpen: false,
      });
    case "C":
      return buildState({
        messages: [
          MESSAGE_USER,
          MESSAGE_ASSISTANT_PARTIAL,
          MESSAGE_USER_ANSWER,
        ],
        activeContext: DRAFT_CONTEXT,
        isContextPanelOpen: true,
      });
    case "D":
      return buildState({
        messages: [
          MESSAGE_USER,
          MESSAGE_ASSISTANT_PARTIAL,
          MESSAGE_USER_ANSWER,
        ],
        activeContext: DRAFT_CONTEXT,
        isContextPanelOpen: false,
        dismissedContextId: DRAFT_CONTEXT.id,
      });
    case "E":
      return buildState({
        messages: [
          MESSAGE_USER,
          MESSAGE_ASSISTANT_PARTIAL,
          MESSAGE_USER_ANSWER,
          MESSAGE_ASSISTANT_CREATED,
        ],
        activeContext: ACTIVE_CONTEXT,
        isContextPanelOpen: true,
      });
  }
}

export function isDemoStateId(value: string | null | undefined): value is DemoStateId {
  return value === "A" || value === "B" || value === "C" || value === "D" || value === "E";
}
