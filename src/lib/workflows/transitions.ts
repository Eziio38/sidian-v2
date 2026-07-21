import type { Database } from "@/types/database.generated";

type FollowUpState = Database["public"]["Enums"]["dossier_suivi_etat"];
type ReceivableState = Database["public"]["Enums"]["creance_etat"];

const NORMAL_TRANSITIONS: Record<FollowUpState, FollowUpState[]> = {
  PREVENTION: [
    "ECHEANCE",
    "PAUSE_LITIGE",
    "ATTENTE_CLIENT",
    "ATTENTE_PRESTATAIRE",
    "ESCALADE_HUMAINE",
  ],
  ECHEANCE: [
    "SUIVI_AMIABLE",
    "PAUSE_LITIGE",
    "ATTENTE_CLIENT",
    "ATTENTE_PRESTATAIRE",
    "ESCALADE_HUMAINE",
  ],
  SUIVI_AMIABLE: [
    "PAUSE_LITIGE",
    "ATTENTE_CLIENT",
    "ATTENTE_PRESTATAIRE",
    "ESCALADE_HUMAINE",
  ],
  PAUSE_LITIGE: [
    "SUIVI_AMIABLE",
    "ATTENTE_CLIENT",
    "ATTENTE_PRESTATAIRE",
    "ESCALADE_HUMAINE",
  ],
  ATTENTE_CLIENT: [
    "SUIVI_AMIABLE",
    "PAUSE_LITIGE",
    "ATTENTE_PRESTATAIRE",
    "ESCALADE_HUMAINE",
  ],
  ATTENTE_PRESTATAIRE: [
    "SUIVI_AMIABLE",
    "PAUSE_LITIGE",
    "ATTENTE_CLIENT",
    "ESCALADE_HUMAINE",
  ],
  ESCALADE_HUMAINE: ["CLOS"],
  CLOS: [],
};

export function allowedFollowUpTargets(
  current: FollowUpState,
  receivableState: ReceivableState,
): FollowUpState[] {
  if (current === "CLOS") {
    return [];
  }

  // Une situation financière terminale ne doit plus recevoir de nouvelle
  // échéance ou action relationnelle. La seule mutation utile est la clôture
  // du dossier encore actif ; le SQL applique la même frontière.
  if (["REGLEE", "ANNULEE", "IRRECOUVRABLE"].includes(receivableState)) {
    return ["CLOS"];
  }

  const targets = [current, ...NORMAL_TRANSITIONS[current]];
  return [...new Set(targets)];
}
