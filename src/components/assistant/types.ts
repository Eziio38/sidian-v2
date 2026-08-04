import type { ReactNode } from "react";

import type {
  ProtectionPanelData,
  ProtectionPanelStatus,
} from "./protection-panel/types";

export type AssistantMessageRole = "user" | "assistant";

export type AssistantMessageStatus =
  | "sent"
  | "streaming"
  | "error"
  | "pending";

export type AssistantMessageActionKind =
  | "retry"
  | "confirm_protection"
  | "edit_protection"
  | "open_protection"
  | "new_client_conversation"
  | "continue_client_conversation";

export type AssistantMessageAction = {
  id: string;
  label: string;
  kind: AssistantMessageActionKind;
  href?: string;
};

type AssistantInsightCard = {
  title: string;
  subtitle?: string;
  meta?: Array<{ label: string; value: string }>;
  statusLabel?: string;
};

/** Carte métier inline — pas pour chaque réponse texte. */
export type AssistantMessageCard =
  | (AssistantInsightCard & { kind: "protection_draft" })
  | (AssistantInsightCard & { kind: "protection" })
  | (AssistantInsightCard & { kind: "payment" })
  | (AssistantInsightCard & { kind: "action_needed" })
  | {
      kind: "confirmation";
      title: string;
      subtitle?: string;
    }
  | {
      kind: "timeline";
      title: string;
      items: Array<{ label: string; detail?: string }>;
    };

/** Pièce jointe liée à un message (métadonnées + aperçu local éventuel). */
export type MessageAttachmentCategory =
  | "invoice"
  | "pdf"
  | "image"
  | "audio"
  | "text"
  | "spreadsheet"
  | "archive"
  | "word"
  | "unknown";

export type MessageAttachment = {
  id: string;
  name: string;
  size: number;
  type: string;
  extension: string;
  positionInGroup: number;
  messageId: string;
  category: MessageAttachmentCategory;
  persistenceStatus: "temporary" | "persistent";
  /** URL blob locale pour aperçu image — session courante uniquement. */
  previewUrl?: string;
  /** Fichier local conservé pour le rendu PDF — session courante uniquement. */
  previewSource?: File;
};

export type MessageFeedback = "like" | "dislike";

export type AssistantMessage = {
  id: string;
  role: AssistantMessageRole;
  content: string;
  createdAt?: string;
  suggestions?: string[];
  actions?: AssistantMessageAction[];
  status?: AssistantMessageStatus;
  /** Indicateur discret pour une opération réelle en cours sur ce message. */
  activityIndicator?: boolean;
  errorMessage?: string;
  retryContent?: string;
  /** Vrai uniquement si le traitement à l’origine du message peut être relancé. */
  retryable?: boolean;
  /** Référence opaque protection créée (creance_id) — navigation uniquement. */
  protectionId?: string;
  /** Carte métier optionnelle (protection / paiement / confirmation…). */
  card?: AssistantMessageCard;
  /** Fichiers joints à ce message (affichés dans le fil et l’historique). */
  attachments?: MessageAttachment[];
  /** Feedback utilisateur (pouces) — local à la session. */
  feedback?: MessageFeedback | null;
  feedbackComment?: string | null;
};

export type ActiveContextType =
  | "none"
  | "protection_draft"
  | "protection"
  | "payment"
  | "client";

export type { ProtectionPanelStatus };

/** Alias stable pour le workspace — même modèle que ProtectionPanelData. */
export type ProtectionContextData = ProtectionPanelData;

export type ActiveContextData = {
  id: string;
  type: Exclude<ActiveContextType, "none">;
  protection?: ProtectionContextData;
};

export type ActiveContext = ActiveContextData | null;

export type ComposerShortcut = {
  id: string;
  label: string;
  action: string;
  icon?: ReactNode;
  emphasis?: "default" | "primary";
};

export type PaymentSummaryData = {
  confirmedCount: number;
  confirmedAmountLabel: string;
  processingCount: number;
  processingAmountLabel: string;
  upcomingCount: number;
  upcomingAmountLabel: string;
  nextPaymentLabel?: string;
};

export type ConversationHistoryItem = {
  id: string;
  clientId: string | null;
  clientName: string | null;
  projectId?: string | null;
  projectName?: string | null;
  title: string;
  /** Titre saisi manuellement — ne plus dériver depuis les messages. */
  titleCustom?: boolean;
  preview: string | null;
  updatedAt: string;
};

export type ConversationProject = {
  id: string;
  name: string;
  icon?: import("./project-personalization").ProjectIconId;
  color?: import("./project-personalization").ProjectColorId;
};

export type ShortcutPhase = "default" | "draft" | "created";

export type AssistantViewport = "desktop" | "tablet" | "mobile";

export type DemoStateId = "A" | "B" | "C" | "D" | "E";

export type ConversationalWorkspaceState = {
  messages: AssistantMessage[];
  activeContext: ActiveContext;
  isContextPanelOpen: boolean;
  isGenerating: boolean;
  dismissedContextId: string | null;
  shortcutPhase: ShortcutPhase;
};
