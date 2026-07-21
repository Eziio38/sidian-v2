import type { Database } from "@/types/database.generated";

type ReceivableState = Database["public"]["Enums"]["creance_etat"];

const ARCHIVABLE_STATES = new Set<ReceivableState>([
  "BROUILLON",
  "REGLEE",
  "ANNULEE",
  "IRRECOUVRABLE",
]);

/**
 * L'archivage masque un élément terminé ; il ne remplace jamais l'annulation
 * sûre d'un paiement à recevoir ouvert ou d'un paiement Stripe en cours.
 */
export function canArchiveReceivable(state: ReceivableState): boolean {
  return ARCHIVABLE_STATES.has(state);
}
