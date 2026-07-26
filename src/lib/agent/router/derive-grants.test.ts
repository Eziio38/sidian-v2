/**
 * Tests G1-K — deriveGrants serveur (jamais depuis body).
 */

import { describe, expect, it } from "vitest";

import { deriveGrants } from "./derive-grants";

const TENANT = "a1111111-1111-4111-8111-111111111111";

describe("deriveGrants (G1-K)", () => {
  it("dérive grants depuis required_permissions + tenant trusted", () => {
    const grants = deriveGrants({
      trustedContext: {
        tenant_id: TENANT,
        roles: ["owner"],
      },
      toolRef: { tool_id: "invoice.get", tool_version: "1.0.0" },
      mode: "agir",
      required_permissions: ["invoice.read"],
      resource_id: "inv_001",
    });

    expect(grants).toEqual([
      {
        permission: "invoice.read",
        tenant_id: TENANT,
        resource_id: "inv_001",
      },
    ]);
  });

  it("rôles vides → aucun grant (fail-closed)", () => {
    expect(
      deriveGrants({
        trustedContext: { tenant_id: TENANT, roles: [] },
        toolRef: { tool_id: "invoice.get", tool_version: "1.0.0" },
        mode: "agir",
        required_permissions: ["invoice.read"],
      }),
    ).toEqual([]);
  });

  it("ne copie jamais un tenant hors trustedContext", () => {
    const grants = deriveGrants({
      trustedContext: {
        tenant_id: TENANT,
        roles: ["member"],
      },
      toolRef: { tool_id: "payment.create_attempt", tool_version: "1.0.0" },
      mode: "agir",
      required_permissions: ["payment.execute"],
    });
    expect(grants.every((g) => g.tenant_id === TENANT)).toBe(true);
  });
});
