import { describe, expect, it } from "vitest";

import {
  formatGreeting,
  resolveDisplayName,
  resolveGreetingFirstName,
} from "./greeting";

describe("resolveGreetingFirstName", () => {
  it("préfère first_name puis full_name / display_name", () => {
    expect(
      resolveGreetingFirstName({
        firstName: "Lucie",
        fullName: "Camille Martin",
        displayName: "Studio",
      }),
    ).toBe("Lucie");
    expect(
      resolveGreetingFirstName({
        firstName: null,
        fullName: "Camille Martin",
        displayName: "Studio",
      }),
    ).toBe("Camille");
    expect(
      resolveGreetingFirstName({
        firstName: "  ",
        fullName: null,
        displayName: "Jonathan Curtato",
      }),
    ).toBe("Jonathan");
  });

  it("ne retombe jamais sur un email ou sa local-part", () => {
    expect(
      resolveGreetingFirstName({
        firstName: "jcurtato@agence.fr",
        fullName: null,
        displayName: null,
      }),
    ).toBeNull();
    expect(
      resolveGreetingFirstName({
        firstName: null,
        fullName: "jcurtato@agence.fr",
        displayName: "jcurtato@x.com",
      }),
    ).toBeNull();
  });

  it("retourne null pour un « Bonjour » plain", () => {
    expect(resolveGreetingFirstName({})).toBeNull();
    expect(formatGreeting(null)).toBe("Bonjour");
    expect(formatGreeting("")).toBe("Bonjour");
    expect(formatGreeting("Lucie")).toBe("Bonjour Lucie");
    expect(formatGreeting("jcurtato@x.com")).toBe("Bonjour");
  });
});

describe("resolveDisplayName", () => {
  it("n’utilise jamais l’email", () => {
    expect(
      resolveDisplayName({
        displayName: "user@sidian.fr",
        fullName: "Lucie Martin",
      }),
    ).toBe("Lucie Martin");
    expect(
      resolveDisplayName({
        displayName: null,
        fullName: null,
        firstName: null,
        fallback: "Profil",
      }),
    ).toBe("Profil");
  });
});
