import { describe, expect, it } from "vitest";

import { parseProtectionIntent } from "./parse-protection-intent";

describe("parseProtectionIntent", () => {
  it("extrait client, montant et date d’un message libre", () => {
    const parsed = parseProtectionIntent(
      "J'ai un nouveau client qui se nomme martin, facture de 350 avec une date au 31 juillet",
    );
    expect(parsed).toEqual({
      clientName: "Martin",
      amountLabel: "350 €",
      dueDateLabel: "31 juillet",
    });
  });

  it("ignore un message sans intention protection", () => {
    expect(parseProtectionIntent("Bonjour Sidian")).toBeNull();
  });

  it("retient le nom avant « client » (ex. Thibault client Chiant)", () => {
    expect(parseProtectionIntent("thibault client chiant")).toEqual({
      clientName: "Thibault",
    });
    expect(parseProtectionIntent("Thibault alfred client Chiant")).toEqual({
      clientName: "Thibault Alfred",
    });
  });

  it("extrait Nouveau client X avec facture et date", () => {
    expect(
      parseProtectionIntent("Nouveau client X, facture de 350 le 31 juillet"),
    ).toEqual({
      clientName: "X",
      amountLabel: "350 €",
      dueDateLabel: "31 juillet",
    });
  });
});
