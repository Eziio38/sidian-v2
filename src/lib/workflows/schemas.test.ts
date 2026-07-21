import { describe, expect, it } from "vitest";

import { followUpUpdateSchema, nextActionDateToIso } from "./schemas";

describe("schéma dossier de suivi", () => {
  it("valide une transition bornée et convertit la date sans dépendre du navigateur", () => {
    const parsed = followUpUpdateSchema.parse({
      receivableId: "11111111-1111-4111-8111-111111111111",
      targetState: "ATTENTE_CLIENT",
      nextActionDate: "2026-08-15",
      escalationReason: "",
    });
    expect(nextActionDateToIso(parsed.nextActionDate)).toBe(
      "2026-08-15T12:00:00.000Z",
    );
  });

  it("refuse une date impossible et un état inventé", () => {
    expect(
      followUpUpdateSchema.safeParse({
        receivableId: "11111111-1111-4111-8111-111111111111",
        targetState: "PAYE_PAR_NAVIGATEUR",
        nextActionDate: "2026-02-31",
        escalationReason: "",
      }).success,
    ).toBe(false);
  });
});
