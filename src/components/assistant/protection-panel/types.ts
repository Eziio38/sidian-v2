/**
 * Modèle de vue du panneau Protection — présentation uniquement.
 * Les champs métier viennent du backend (protection.draft.*) via le mapper.
 */

export type ProtectionPanelStatus =
  | "draft"
  | "active"
  | "blocked"
  | "error"
  | "analyzing";

export type ProtectionPanelMode = "inline" | "overlay" | "sheet";

/** Identifiants de sections progressives (ordre d’affichage). */
export const PROTECTION_PANEL_FIELD_IDS = [
  "client",
  "amount",
  "due_date",
  "payment_method",
  "authorization",
  "auto_debit",
  "status",
  "actions",
  "consequences",
] as const;

export type ProtectionPanelFieldId =
  (typeof PROTECTION_PANEL_FIELD_IDS)[number];

export type ProtectionPanelField = {
  id: ProtectionPanelFieldId;
  label: string;
  value: string;
  /** Champ encore attendu du côté brouillon (placeholder doux). */
  pending?: boolean;
  emphasize?: "amount" | "default";
};

/**
 * Données affichables du panneau — pas de logique métier.
 * `draftId` / `confirmationNonce` sont des références opaque pour les appels API.
 */
export type ProtectionPanelData = {
  clientName: string;
  statusLabel: string;
  status: ProtectionPanelStatus;
  amountLabel: string;
  subject?: string;
  dueDateLabel?: string;
  paymentMethodLabel?: string;
  authorizationLabel?: string;
  autoDebitRuleLabel?: string;
  nextStepLabel?: string;
  consequenceLabel?: string;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
  /** Identifiant brouillon backend — absent en lecture pure / démo locale. */
  draftId?: string;
  confirmationNonce?: string | null;
  /** État machine backend (affichage mappé, jamais exposé brut à l’utilisateur). */
  backendState?: string;
  missingFields?: string[];
  pendingQuestion?: string | null;
  clientEmail?: string;
};

export type ProtectionDraftApiRecap = {
  client_name: string | null;
  client_email: string | null;
  expected_amount_minor: number | null;
  currency: string | null;
  due_date: string | null;
  libelle: string | null;
  reference_externe: string | null;
};

/** Sortie commune des outils protection.draft.advance|get|converse. */
export type ProtectionDraftToolOutput = {
  draft_id: string;
  state: string;
  missing_fields: string[];
  pending_question: string | null;
  open_ambiguities?: Array<{
    kind: string;
    message: string;
    candidates?: string[];
  }>;
  recap: ProtectionDraftApiRecap;
  confirmation_nonce: string | null;
  attachments_count?: number;
  summary?: string;
};

export type ProtectionDraftConfirmOutput = {
  outcome: "created" | "replay";
  draft_id: string;
  state: string;
  client_payeur_id: string;
  creance_id: string;
};
