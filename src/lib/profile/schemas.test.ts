import { describe, expect, it } from "vitest";

import { prestataireProfileSchema } from "./schemas";

describe("prestataireProfileSchema", () => {
  it("normalise le nom et accepte les deux profils documentés", () => {
    expect(
      prestataireProfileSchema.parse({
        nom: "  Atelier   Horizon  ",
        profilAgent: "delegation",
      }),
    ).toEqual({ nom: "Atelier Horizon", profilAgent: "delegation" });
  });

  it("refuse un profil inventé et les noms hors bornes", () => {
    expect(
      prestataireProfileSchema.safeParse({
        nom: "A",
        profilAgent: "automatique",
      }).success,
    ).toBe(false);
  });
});
