/**
 * G1-M — Conversation-to-Protection Draft — types domaine.
 *
 * Collaboration ≈ client_payeur ; protection ≈ creance (paiement à recevoir).
 * Aucune écriture métier avant confirmation explicite.
 */

export const PROTECTION_DRAFT_STATES = [
  "MESSAGE_RECU",
  "EXTRACTION_BROUILLON",
  "INFORMATIONS_MANQUANTES",
  "QUESTION_CIBLEE",
  "BROUILLON_COMPLET",
  "RECAPITULATIF",
  "CONFIRMATION_EXPLICITE",
  "CREATION_ATOMIQUE",
  "TERMINE",
  "ANNULE",
  "EXPIRE",
] as const;

export type ProtectionDraftState = (typeof PROTECTION_DRAFT_STATES)[number];

export const FIELD_PROVENANCES = [
  "agent_proposed",
  "user_provided",
  "user_corrected",
  "confirmed",
] as const;

export type FieldProvenance = (typeof FIELD_PROVENANCES)[number];

export const REQUIRED_DRAFT_FIELDS = [
  "client_name",
  "client_email",
  "expected_amount_minor",
  "currency",
  "due_date",
] as const;

export type RequiredDraftField = (typeof REQUIRED_DRAFT_FIELDS)[number];

export const OPTIONAL_DRAFT_FIELDS = ["libelle", "reference_externe"] as const;

export type OptionalDraftField = (typeof OPTIONAL_DRAFT_FIELDS)[number];

export type DraftFieldName = RequiredDraftField | OptionalDraftField;

export type DraftFieldValue = {
  value: string | number;
  provenance: FieldProvenance;
  /** ISO-8601 */
  updated_at: string;
};

export type DraftFields = Partial<Record<DraftFieldName, DraftFieldValue>>;

export type AmbiguityKind = "due_date" | "currency" | "amount";

export type OpenAmbiguity = {
  kind: AmbiguityKind;
  message: string;
  candidates?: string[];
};

/**
 * Devise — règle documentée G1-M :
 * 1. Devise explicite dans le message (EUR / euro / €) → EUR.
 * 2. Montant sans devise + contexte FR/Sidian MVP → déduction EUR.
 * 3. Devise non-EUR explicite → refus (MVP EUR only).
 * 4. Symbole ambigu sans contexte monétaire clair → ambiguïté ouverte.
 */
export const CURRENCY_DEDUCTION_RULE =
  "MVP Sidian : EUR uniquement. Devise explicite (EUR/euro/€) ou déduction EUR si montant sans devise dans un message FR. Autre devise → refus.";

export type AttachmentMeta = {
  filename: string;
  content_type: string;
  size_bytes: number;
  /** Identifiant opaque — pas de contenu, pas d’OCR dans G1-M. */
  attachment_id: string;
};

export type ProtectionDraftRecord = {
  draft_id: string;
  tenant_id: string;
  actor_id: string;
  conversation_id: string | null;
  state: ProtectionDraftState;
  fields: DraftFields;
  missing_fields: DraftFieldName[];
  pending_question: string | null;
  open_ambiguities: OpenAmbiguity[];
  attachments: AttachmentMeta[];
  client_creation_key: string | null;
  creance_creation_key: string | null;
  confirmation_nonce: string | null;
  confirmed_at: string | null;
  client_payeur_id: string | null;
  creance_id: string | null;
  expires_at: string;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DraftRecap = {
  client_name: string | null;
  client_email: string | null;
  expected_amount_minor: number | null;
  currency: string | null;
  due_date: string | null;
  libelle: string | null;
  reference_externe: string | null;
  field_provenance: DraftFields;
  missing_fields: DraftFieldName[];
  open_ambiguities: OpenAmbiguity[];
  attachments: AttachmentMeta[];
};

export type AdvanceIntent =
  | { kind: "message"; text: string; attachments?: AttachmentMeta[] }
  | { kind: "correction"; field: DraftFieldName; value: string | number }
  | { kind: "answer"; text: string }
  | { kind: "acknowledge_recap" }
  /**
   * G1-N — extraction déjà validée (schéma + domaine).
   * Interne / in-process uniquement — jamais exposé dans le schéma outil HTTP.
   */
  | {
      kind: "apply_extraction";
      fields: DraftFields;
      ambiguities?: OpenAmbiguity[];
      attachments?: AttachmentMeta[];
    };

export type ConfirmCreateResult = {
  outcome: "created" | "replay";
  draft_id: string;
  state: ProtectionDraftState;
  client_payeur_id: string;
  creance_id: string;
};

export type ProtectionDraftService = {
  advance(input: {
    tenant_id: string;
    actor_id: string;
    draft_id?: string;
    conversation_id?: string;
    intent: AdvanceIntent;
    now: string;
  }): Promise<{
    draft: ProtectionDraftRecord;
    recap: DraftRecap;
    targeted_question: string | null;
  }>;

  get(input: {
    tenant_id: string;
    draft_id: string;
    now: string;
  }): Promise<{
    draft: ProtectionDraftRecord;
    recap: DraftRecap;
  }>;

  cancel(input: {
    tenant_id: string;
    actor_id: string;
    draft_id: string;
    now: string;
  }): Promise<{ draft: ProtectionDraftRecord }>;

  confirm(input: {
    tenant_id: string;
    actor_id: string;
    draft_id: string;
    /** Doit être true — confirmation explicite utilisateur. */
    explicit_confirmation: true;
    confirmation_nonce: string;
    now: string;
  }): Promise<ConfirmCreateResult>;
};
