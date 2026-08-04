import { describe, expect, it } from "vitest";

import { matchWelcomeQuickAction } from "./match-welcome-quick-action";

describe("matchWelcomeQuickAction", () => {
  it("reconnaît les labels empty state et leurs variantes", () => {
    expect(matchWelcomeQuickAction("Protéger une facture")?.action).toBe(
      "create_protection",
    );
    expect(matchWelcomeQuickAction("Créer une protection")?.action).toBe(
      "create_protection",
    );
    expect(matchWelcomeQuickAction("Faire le point sur mes paiements")?.action).toBe(
      "view_expected_payments",
    );
    expect(matchWelcomeQuickAction("Consulter les paiements")?.action).toBe(
      "view_expected_payments",
    );
    expect(matchWelcomeQuickAction("Voir les paiements")?.action).toBe(
      "view_expected_payments",
    );
    expect(matchWelcomeQuickAction("Vérifier les paiements")?.action).toBe(
      "view_expected_payments",
    );
    expect(matchWelcomeQuickAction("Ajouter un client")?.action).toBe(
      "create_client",
    );
    expect(matchWelcomeQuickAction("Créer un client")?.action).toBe(
      "create_client",
    );
    expect(matchWelcomeQuickAction("Analyser un document")?.action).toBe(
      "add_invoice",
    );
    expect(matchWelcomeQuickAction("Importer un document")?.action).toBe(
      "add_invoice",
    );
    expect(matchWelcomeQuickAction("Importer une facture")?.action).toBe(
      "add_invoice",
    );
  });

  it("tolère préfixe poli et ponctuation", () => {
    expect(
      matchWelcomeQuickAction("Je veux créer une protection")?.action,
    ).toBe("create_protection");
    expect(matchWelcomeQuickAction("Vérifier les paiements !")?.action).toBe(
      "view_expected_payments",
    );
  });

  it("ne capture pas une intention protection riche", () => {
    expect(
      matchWelcomeQuickAction(
        "Nouveau client X, facture de 350 le 31 juillet",
      ),
    ).toBeNull();
    expect(matchWelcomeQuickAction("Bonjour Sidian")).toBeNull();
    expect(matchWelcomeQuickAction("Dupont Conseil")).toBeNull();
  });
});
