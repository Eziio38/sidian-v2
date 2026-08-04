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
    consequenceLabel: CONSEQUENCE_COPY.draft,
    primaryActionLabel: "Continuer la protection",
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
    "Je prépare ta protection.\n\nIl me manque encore quelques informations.\n• le montant exact\n• la date d’échéance",
  suggestions: ["30 jours", "Fin du mois", "Choisir une date"],
};

const MESSAGE_ASSISTANT_DRAFT: AssistantMessage = {
  id: "m-assistant-draft",
  role: "assistant",
  content:
    "Voici le brouillon de ta protection. Rien ne sera envoyé avant ta confirmation.",
  card: {
    kind: "protection_draft",
    title: "Protection Dupont Conseil",
    subtitle: "Site internet",
    statusLabel: "Brouillon",
    meta: [
      { label: "Client", value: "Dupont Conseil" },
      { label: "Montant", value: "2 400 €" },
      { label: "Échéance", value: "24 août 2026" },
    ],
  },
};

const MESSAGE_ASSISTANT_CREATED: AssistantMessage = {
  id: "m-assistant-2",
  role: "assistant",
  content: "La protection Dupont Conseil est active.",
  card: {
    kind: "confirmation",
    title: "Protection créée",
    subtitle: "Prochaine étape : vérification à l’échéance du 24 août.",
  },
};

const MESSAGE_ASSISTANT_ACTION: AssistantMessage = {
  id: "m-assistant-action",
  role: "assistant",
  content: "Un paiement nécessite ton attention.",
  card: {
    kind: "action_needed",
    title: "Action nécessaire",
    subtitle: "Dupont Conseil, échéance dépassée",
    statusLabel: "À traiter",
    meta: [
      { label: "Client", value: "Dupont Conseil" },
      { label: "Montant", value: "2 400 €" },
      { label: "Échéance", value: "24 août 2026" },
    ],
  },
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
      // Brouillon utile → panneau ouvert (après carte conversationnelle).
      return buildState({
        messages: [
          MESSAGE_USER,
          MESSAGE_ASSISTANT_PARTIAL,
          MESSAGE_USER_ANSWER,
          MESSAGE_ASSISTANT_DRAFT,
        ],
        activeContext: DRAFT_CONTEXT,
        isContextPanelOpen: true,
      });
    case "D":
      // Carte visible, panneau fermé (rouverture discrète possible).
      return buildState({
        messages: [
          MESSAGE_USER,
          MESSAGE_ASSISTANT_PARTIAL,
          MESSAGE_USER_ANSWER,
          MESSAGE_ASSISTANT_DRAFT,
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
          MESSAGE_ASSISTANT_ACTION,
        ],
        activeContext: ACTIVE_CONTEXT,
        isContextPanelOpen: true,
      });
  }
}

export function isDemoStateId(value: string | null | undefined): value is DemoStateId {
  return value === "A" || value === "B" || value === "C" || value === "D" || value === "E";
}
