/**
 * Microcopy panneau Protection — tutoiement, calme, sans jargon admin.
 */

import type { ProtectionPanelStatus } from "./types";

export const PROTECTION_PANEL_TITLE = "Protection";

export const FIELD_LABELS = {
  client: "Client",
  amount: "Montant",
  due_date: "Échéance",
  payment_method: "Moyen de paiement",
  authorization: "Autorisation",
  auto_debit: "Prélèvement auto",
  status: "Statut",
  next_step: "Élément manquant",
  consequences: "Réassurance",
} as const;

export const PLACEHOLDERS = {
  client: "À préciser",
  amount: "À préciser",
  due_date: "À préciser",
  /** Réservés : ne plus afficher en anticipation sur la fiche. */
  payment_method: "",
  authorization: "",
  auto_debit: "",
  next_step: "Il me manque encore quelques informations.",
} as const;

export const STATUS_LABELS: Record<ProtectionPanelStatus, string> = {
  draft: "Brouillon",
  active: "Active",
  blocked: "En pause",
  error: "À vérifier",
  analyzing: "En cours…",
};

/** Réassurance selon l’état — rassurant, factuel. */
export const CONSEQUENCE_COPY: Record<ProtectionPanelStatus, string> = {
  draft: "Rien ne sera envoyé avant ta confirmation.",
  active:
    "À l’échéance, Sidian vérifiera le paiement et te préviendra si une action est utile.",
  blocked:
    "Les relances et prélèvements automatiques sont en pause pour cette protection.",
  error:
    "Une info manque ou pose problème. Corrige-la pour reprendre le suivi.",
  analyzing: "Je prépare ta protection. Aucune action n’est encore engagée.",
};

export const ACTION_LABELS = {
  create: "Continuer la protection",
  confirm: "Confirmer et créer",
  view: "Voir le détail",
  reopen: "Rouvrir le panneau",
  cancel_draft: "Annuler le brouillon",
  retry: "Réessayer",
} as const;

/**
 * Mappe un état machine backend → statut panneau (présentation).
 * Aucune transition métier ici — pure correspondance d’affichage.
 */
export function mapBackendStateToPanelStatus(
  backendState: string | undefined | null,
): ProtectionPanelStatus {
  if (!backendState) return "draft";
  switch (backendState) {
    case "TERMINE":
      return "active";
    case "ANNULE":
    case "EXPIRE":
      return "blocked";
    case "CREATION_ATOMIQUE":
      return "analyzing";
    case "MESSAGE_RECU":
    case "EXTRACTION_BROUILLON":
    case "INFORMATIONS_MANQUANTES":
    case "QUESTION_CIBLEE":
    case "BROUILLON_COMPLET":
    case "RECAPITULATIF":
    case "CONFIRMATION_EXPLICITE":
      return "draft";
    default:
      return "draft";
  }
}

export function statusLabelFor(
  status: ProtectionPanelStatus,
  override?: string,
): string {
  return override?.trim() || STATUS_LABELS[status];
}
