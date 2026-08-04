import { describe, expect, it } from "vitest";

import {
  clientSpaceKey,
  findProjectByName,
  shouldOfferClientSpace,
} from "./client-space";

describe("client-space", () => {
  it("détecte un projet existant sans tenir compte de la casse", () => {
    expect(
      findProjectByName([{ id: "1", name: "Michel" }], "michel")?.id,
    ).toBe("1");
  });

  it("propose un espace seulement si absent, non refusé et non déjà offert", () => {
    expect(
      shouldOfferClientSpace({
        clientName: "Chiant",
        projects: [],
        declinedKeys: new Set(),
        alreadyOfferedKeys: new Set(),
      }),
    ).toBe(true);

    expect(
      shouldOfferClientSpace({
        clientName: "Chiant",
        projects: [{ id: "1", name: "Chiant" }],
        declinedKeys: new Set(),
        alreadyOfferedKeys: new Set(),
      }),
    ).toBe(false);

    expect(
      shouldOfferClientSpace({
        clientName: "Chiant",
        projects: [],
        declinedKeys: new Set([clientSpaceKey("Chiant")]),
        alreadyOfferedKeys: new Set(),
      }),
    ).toBe(false);

    expect(
      shouldOfferClientSpace({
        clientName: "Chiant",
        projects: [],
        declinedKeys: new Set(),
        alreadyOfferedKeys: new Set([clientSpaceKey("Chiant")]),
      }),
    ).toBe(false);
  });
});
