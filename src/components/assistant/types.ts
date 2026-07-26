import type { ReactNode } from "react";

export type AssistantMessageRole = "user" | "assistant";

export type AssistantMessage = {
  id: string;
  role: AssistantMessageRole;
  content: string;
  createdAt?: string;
  suggestions?: string[];
};

export type ActiveContextType =
  | "none"
  | "protection_draft"
  | "protection"
  | "payment"
  | "client";

export type ProtectionPanelStatus = "draft" | "active" | "analyzing";

export type ProtectionContextData = {
  clientName: string;
  statusLabel: string;
  status: ProtectionPanelStatus;
  amountLabel: string;
  subject?: string;
  dueDateLabel?: string;
  nextStepLabel?: string;
  primaryActionLabel?: string;
};

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
