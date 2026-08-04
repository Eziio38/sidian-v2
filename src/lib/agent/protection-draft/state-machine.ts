/**
 * G1-M — transitions de la machine d’état conversationnelle.
 */

import type { ProtectionDraftState } from "./types";

const TERMINAL: ReadonlySet<ProtectionDraftState> = new Set([
  "TERMINE",
  "ANNULE",
  "EXPIRE",
]);

export function isTerminalState(state: ProtectionDraftState): boolean {
  return TERMINAL.has(state);
}

export function canAdvance(state: ProtectionDraftState): boolean {
  return !isTerminalState(state) && state !== "CREATION_ATOMIQUE";
}

export function canConfirm(state: ProtectionDraftState): boolean {
  return (
    state === "RECAPITULATIF" ||
    state === "CONFIRMATION_EXPLICITE" ||
    state === "BROUILLON_COMPLET"
  );
}

/**
 * Calcule l’état suivant après extraction / correction.
 */
export function nextStateAfterUpdate(input: {
  missingCount: number;
  ambiguityCount: number;
  previous: ProtectionDraftState;
}): ProtectionDraftState {
  if (isTerminalState(input.previous) || input.previous === "CREATION_ATOMIQUE") {
    return input.previous;
  }
  if (input.ambiguityCount > 0 || input.missingCount > 0) {
    if (input.missingCount > 0 && input.ambiguityCount === 0) {
      return "INFORMATIONS_MANQUANTES";
    }
    if (input.ambiguityCount > 0) {
      return "QUESTION_CIBLEE";
    }
    return "INFORMATIONS_MANQUANTES";
  }
  // Complet → récapitulatif (confirmation explicite encore requise)
  return "RECAPITULATIF";
}

export function stateAfterAcknowledgeRecap(
  state: ProtectionDraftState,
): ProtectionDraftState {
  if (state === "RECAPITULATIF" || state === "BROUILLON_COMPLET") {
    return "CONFIRMATION_EXPLICITE";
  }
  return state;
}
