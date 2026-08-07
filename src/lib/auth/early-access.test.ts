import { afterEach, describe, expect, it } from "vitest";

import {
  assertEarlyAccess,
  EarlyAccessDeniedError,
  isEarlyAccessEnforced,
} from "@/lib/auth/early-access";

const ENV_KEY = "SIDIAN_EARLY_ACCESS_EMAILS";

function setAllowlist(value: string | undefined): void {
  if (value === undefined) {
    delete process.env[ENV_KEY];
    return;
  }
  process.env[ENV_KEY] = value;
}

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe("barrière d'accès anticipé", () => {
  it("laisse tout passer quand la variable est absente", () => {
    setAllowlist(undefined);

    expect(isEarlyAccessEnforced()).toBe(false);
    expect(() => assertEarlyAccess("inconnu@example.com")).not.toThrow();
    expect(() => assertEarlyAccess(null)).not.toThrow();
  });

  it("laisse tout passer quand la variable est vide", () => {
    setAllowlist("   ");

    expect(isEarlyAccessEnforced()).toBe(false);
    expect(() => assertEarlyAccess("inconnu@example.com")).not.toThrow();
  });

  it("autorise une adresse listée, quelle que soit sa casse", () => {
    setAllowlist("jcurtato@gmail.com, contact@sidian.so");

    expect(isEarlyAccessEnforced()).toBe(true);
    expect(() => assertEarlyAccess("JCurtato@Gmail.com")).not.toThrow();
    expect(() => assertEarlyAccess("  contact@sidian.so  ")).not.toThrow();
  });

  it("refuse une adresse absente de la liste", () => {
    setAllowlist("jcurtato@gmail.com");

    expect(() => assertEarlyAccess("autre@example.com")).toThrow(
      EarlyAccessDeniedError,
    );
  });

  it("refuse quand l'email est manquant", () => {
    setAllowlist("jcurtato@gmail.com");

    expect(() => assertEarlyAccess(null)).toThrow(EarlyAccessDeniedError);
    expect(() => assertEarlyAccess(undefined)).toThrow(EarlyAccessDeniedError);
    expect(() => assertEarlyAccess("   ")).toThrow(EarlyAccessDeniedError);
  });

  it("échoue fermé sur une liste renseignée mais vide après nettoyage", () => {
    // Une barrière mal configurée doit refuser tout le monde, pas ouvrir.
    setAllowlist(" , , ");

    expect(isEarlyAccessEnforced()).toBe(true);
    expect(() => assertEarlyAccess("jcurtato@gmail.com")).toThrow(
      EarlyAccessDeniedError,
    );
  });
});
