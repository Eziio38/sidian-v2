import { describe, expect, it } from "vitest";

import { SUGGESTION_CREATE_CLIENT } from "./message-suggestions";
import {
  buildClientPaymentSuggestions,
  upsertKnownClient,
} from "./known-clients";
import {
  deriveConversationPreview,
  deriveConversationTitle,
} from "./conversation-title";

describe("known-clients", () => {
  it("ne propose que les clients réellement fournis", () => {
    expect(
      buildClientPaymentSuggestions([{ name: "test", email: "test@test.test" }]),
    ).toEqual(["test", SUGGESTION_CREATE_CLIENT]);
  });

  it("déduplique sans tenir compte de la casse", () => {
    expect(
      buildClientPaymentSuggestions([
        { name: "Dupont Conseil" },
        { name: "dupont conseil" },
      ]),
    ).toEqual(["Dupont Conseil", SUGGESTION_CREATE_CLIENT]);
  });

  it("upsert remonte le client en tête", () => {
    const next = upsertKnownClient(
      [{ name: "Alpha" }, { name: "Beta" }],
      { name: "beta", email: "b@b.b" },
    );
    expect(next.map((client) => client.name)).toEqual(["beta", "Alpha"]);
    expect(next[0]?.email).toBe("b@b.b");
  });

  it("conserve l’identifiant réel lors d’un enrichissement par le nom", () => {
    const next = upsertKnownClient(
      [{ id: "client-1", name: "Alpha", email: "alpha@example.com" }],
      { name: "alpha" },
    );
    expect(next[0]).toMatchObject({
      id: "client-1",
      name: "alpha",
      email: "alpha@example.com",
    });
  });
});

describe("conversation-title", () => {
  it("préfère le nom client quand il est renseigné", () => {
    expect(
      deriveConversationTitle({
        clientName: "test",
        messages: [{ role: "user", content: "Créer une protection" }],
      }),
    ).toBe("test");
  });

  it("extrait des mots-clés du premier message utilisateur", () => {
    expect(
      deriveConversationTitle({
        clientName: "À préciser",
        messages: [
          {
            role: "user",
            content: "Je veux créer une protection pour une mission juillet",
          },
        ],
      }),
    ).toBe("Mission juillet");
  });

  it("tronque la preview du dernier message", () => {
    const long = "x".repeat(100);
    expect(deriveConversationPreview([{ role: "assistant", content: long }]))
      .toHaveLength(73);
  });
});
