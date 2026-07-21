import { describe, expect, it } from "vitest";

import { canArchiveReceivable } from "./archive-policy";

describe("politique d’archivage des paiements à recevoir", () => {
  it.each(["BROUILLON", "REGLEE", "ANNULEE", "IRRECOUVRABLE"] as const)(
    "autorise l’état terminal ou préparatoire %s",
    (state) => {
      expect(canArchiveReceivable(state)).toBe(true);
    },
  );

  it.each(["OUVERTE", "PARTIELLEMENT_REGLEE", "EN_LITIGE"] as const)(
    "impose l’annulation sûre pour l’état actif %s",
    (state) => {
      expect(canArchiveReceivable(state)).toBe(false);
    },
  );
});
