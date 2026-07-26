import type { ActiveContext, ComposerShortcut, ShortcutPhase } from "./types";

const DRAFT_SHORTCUTS: ComposerShortcut[] = [
  {
    id: "edit-amount",
    label: "Modifier le montant",
    action: "edit_amount",
  },
  {
    id: "change-due-date",
    label: "Changer l’échéance",
    action: "change_due_date",
  },
  {
    id: "add-contact",
    label: "Ajouter un client",
    action: "add_contact",
  },
  {
    id: "add-document",
    label: "Ajouter un document",
    action: "add_document",
  },
];

const CREATED_SHORTCUTS: ComposerShortcut[] = [
  {
    id: "view-protection",
    label: "Voir la protection",
    action: "view_protection",
  },
  {
    id: "add-another-invoice",
    label: "Ajouter une autre facture",
    action: "add_another_invoice",
  },
  {
    id: "mark-paid",
    label: "Marquer comme payé",
    action: "mark_as_paid",
  },
];

const DEFAULT_SHORTCUTS: ComposerShortcut[] = [
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
];

export function resolveShortcutPhase(
  activeContext: ActiveContext,
): ShortcutPhase {
  if (!activeContext) return "default";
  if (activeContext.type === "protection_draft") return "draft";
  if (activeContext.type === "protection") return "created";
  return "default";
}

export function getComposerShortcuts(
  phase: ShortcutPhase,
): ComposerShortcut[] {
  switch (phase) {
    case "draft":
      return DRAFT_SHORTCUTS;
    case "created":
      return CREATED_SHORTCUTS;
    default:
      return DEFAULT_SHORTCUTS;
  }
}

export function shouldShowContextPanel(params: {
  activeContext: ActiveContext;
  isContextPanelOpen: boolean;
  viewport: "desktop" | "tablet" | "mobile";
}): boolean {
  const { activeContext, isContextPanelOpen, viewport } = params;
  if (viewport === "mobile") return false;
  if (!activeContext || activeContext.type === ("none" as never)) return false;
  return isContextPanelOpen;
}

export function shouldShowWelcomeState(params: {
  messagesLength: number;
  isGenerating: boolean;
  activeContext: ActiveContext;
}): boolean {
  return (
    params.messagesLength === 0 &&
    !params.isGenerating &&
    params.activeContext === null
  );
}
