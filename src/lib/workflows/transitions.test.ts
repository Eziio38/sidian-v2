import { describe, expect, it } from "vitest";

import { allowedFollowUpTargets } from "./transitions";

describe("transitions dossier affichées", () => {
  it("ne propose aucun retour depuis CLOS", () => {
    expect(allowedFollowUpTargets("CLOS", "ANNULEE")).toEqual([]);
  });

  it("propose la clôture d’un dossier financier terminal", () => {
    expect(allowedFollowUpTargets("ATTENTE_CLIENT", "REGLEE")).toEqual(["CLOS"]);
    expect(allowedFollowUpTargets("PAUSE_LITIGE", "ANNULEE")).toEqual(["CLOS"]);
    expect(allowedFollowUpTargets("PREVENTION", "IRRECOUVRABLE")).toEqual([
      "CLOS",
    ]);
  });

  it("conserve l’escalade humaine avant clôture sur une créance ouverte", () => {
    expect(allowedFollowUpTargets("PREVENTION", "OUVERTE")).not.toContain("CLOS");
    expect(allowedFollowUpTargets("ESCALADE_HUMAINE", "OUVERTE")).toContain("CLOS");
  });
});
