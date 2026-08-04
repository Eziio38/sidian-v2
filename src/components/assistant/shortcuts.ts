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
    label: "Protéger une facture",
    action: "create_protection",
  },
  {
    id: "add-invoice",
    label: "Analyser un document",
    action: "add_invoice",
  },
  {
    id: "create-client",
    label: "Ajouter un client",
    action: "create_client",
  },
  {
    id: "view-expected",
    label: "Faire le point sur mes paiements",
    action: "view_expected_payments",
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

const REOPEN_PANEL_SHORTCUT: ComposerShortcut = {
  id: "reopen-panel",
  label: "Rouvrir le panneau",
  action: "reopen_protection_panel",
  emphasis: "primary",
};

export function getComposerShortcuts(
  phase: ShortcutPhase,
  options?: { includeReopenPanel?: boolean },
): ComposerShortcut[] {
  let shortcuts: ComposerShortcut[];
  switch (phase) {
    case "draft":
      shortcuts = DRAFT_SHORTCUTS;
      break;
    case "created":
      shortcuts = CREATED_SHORTCUTS;
      break;
    default:
      shortcuts = DEFAULT_SHORTCUTS;
  }

  if (!options?.includeReopenPanel) {
    return shortcuts.slice(0, 4);
  }

  // Remplace le dernier raccourci pour garder une rangée courte.
  return [REOPEN_PANEL_SHORTCUT, ...shortcuts.slice(0, 3)];
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
