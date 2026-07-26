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
  | "open_protection";

export type AssistantMessageAction = {
  id: string;
  label: string;
  kind: AssistantMessageActionKind;
  href?: string;
};

export type AssistantMessage = {
  id: string;
  role: AssistantMessageRole;
  content: string;
  createdAt?: string;
  suggestions?: string[];
  actions?: AssistantMessageAction[];
  status?: AssistantMessageStatus;
  errorMessage?: string;
  retryContent?: string;
  /** Référence opaque protection créée (creance_id) — navigation uniquement. */
  protectionId?: string;
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
