import { describe, expect, it } from "vitest";

import { ToolRegistryError } from "./errors";
import {
  createToolRegistry,
  loadProductionRegistry,
} from "./registry";
import {
  approvedOnlyTool,
  disabledPaymentTool,
  unknownSchemaTool,
} from "./test-fixtures/invalid-definitions";

describe("tool registry (G1-B)", () => {
  it("charge le registre Production sans fixtures de test", () => {
    const registry = loadProductionRegistry();
    const ids = registry.list().map((d) => `${d.tool_id}@${d.version}`);
    expect(ids).toContain("payment.create_attempt@1.0.0");
    expect(ids).toContain("payment.create_attempt@0.9.0");
    expect(ids).toContain("invoice.get@1.0.0");
    expect(ids).toContain("notification.generate_draft@1.0.0");
    expect(ids.some((id) => id.startsWith("fixture."))).toBe(false);
  });

  it("EVAL-TOOL-019: refuse un outil inconnu", () => {
    const registry = loadProductionRegistry();
    expect(() => registry.get("totally.unknown.tool", "1.0.0")).toThrow(
      ToolRegistryError,
    );
    try {
      registry.get("totally.unknown.tool", "1.0.0");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolRegistryError);
      expect((error as ToolRegistryError).code).toBe("TOOL_UNKNOWN");
    }
  });

  it("EVAL-TOOL-020: refuse Deprecated et Disabled", () => {
    const registry = loadProductionRegistry();
    expect(() =>
      registry.assertCallable("payment.create_attempt", "0.9.0"),
    ).toThrow(ToolRegistryError);
    try {
      registry.assertCallable("payment.create_attempt", "0.9.0");
    } catch (error) {
      expect((error as ToolRegistryError).code).toBe("TOOL_DEPRECATED");
    }

    const fixtureRegistry = createToolRegistry([disabledPaymentTool]);
    try {
      fixtureRegistry.assertCallable("fixture.disabled_payment", "1.0.0");
      expect.unreachable();
    } catch (error) {
      expect((error as ToolRegistryError).code).toBe("TOOL_DISABLED");
    }
  });

  it("seul status=Production est callable (Approved non callable)", () => {
    const registry = createToolRegistry([approvedOnlyTool]);
    expect(() =>
      registry.assertCallable("fixture.approved_only", "1.0.0"),
    ).toThrow(/TOOL_NOT_CALLABLE|n’est pas callable/);
  });

  it("échoue si input_schema_id / output_schema_id absents du schema-registry", () => {
    expect(() => createToolRegistry([unknownSchemaTool as never])).toThrow(
      ToolRegistryError,
    );
    try {
      createToolRegistry([unknownSchemaTool as never]);
    } catch (error) {
      expect((error as ToolRegistryError).code).toBe("SCHEMA_UNKNOWN");
    }
  });

  it("assertCallable réussit pour payment.create_attempt@1.0.0 Production", () => {
    const def = loadProductionRegistry().assertCallable(
      "payment.create_attempt",
      "1.0.0",
    );
    expect(def.status).toBe("Production");
  });
});
