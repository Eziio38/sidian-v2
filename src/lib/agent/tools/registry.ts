import {
  parseToolDefinition,
  type ToolDefinition,
} from "./definition-schema";
import { invoiceGetV1 } from "./definitions/invoice.get.1.0.0";
import { notificationGenerateDraftV1 } from "./definitions/notification.generate_draft.1.0.0";
import { paymentCreateAttemptV09 } from "./definitions/payment.create_attempt.0.9.0";
import { paymentCreateAttemptV1 } from "./definitions/payment.create_attempt.1.0.0";
import { ToolRegistryError } from "./errors";
import { assertSchemasRegistered } from "./schema-registry";

function toolKey(toolId: string, version: string): string {
  return `${toolId}@${version}`;
}

export class ToolRegistry {
  private readonly byKey: Map<string, ToolDefinition>;

  constructor(definitions: ToolDefinition[]) {
    this.byKey = new Map();
    for (const raw of definitions) {
      const def = parseToolDefinition(raw);
      assertSchemasRegistered(def.input_schema_id, def.output_schema_id);
      const key = toolKey(def.tool_id, def.version);
      if (this.byKey.has(key)) {
        throw new ToolRegistryError({
          code: "TOOL_DEFINITION_INVALID",
          category: "technical",
          message: `Définition dupliquée: ${key}`,
          userMessage: "Registre d’outils invalide.",
        });
      }
      this.byKey.set(key, def);
    }
  }

  list(): ToolDefinition[] {
    return [...this.byKey.values()];
  }

  get(toolId: string, version: string): ToolDefinition {
    const found = this.byKey.get(toolKey(toolId, version));
    if (!found) {
      const anyVersion = [...this.byKey.values()].some((d) => d.tool_id === toolId);
      throw new ToolRegistryError({
        code: anyVersion ? "TOOL_VERSION_UNKNOWN" : "TOOL_UNKNOWN",
        category: "technical",
        message: anyVersion
          ? `Version inconnue pour ${toolId}: ${version}`
          : `Outil inconnu: ${toolId}`,
        userMessage: "Cette action n’est pas disponible.",
      });
    }
    return found;
  }

  /**
   * Callable uniquement si status === Production (G1-B).
   * Approved est valide en registre mais non callable.
   */
  assertCallable(toolId: string, version: string): ToolDefinition {
    const def = this.get(toolId, version);
    if (def.status === "Deprecated") {
      throw new ToolRegistryError({
        code: "TOOL_DEPRECATED",
        category: "technical",
        message: `${toolId}@${version} est Deprecated`,
        userMessage: "Cette version d’outil est obsolète.",
      });
    }
    if (def.status === "Disabled" || def.status === "Archived") {
      throw new ToolRegistryError({
        code: "TOOL_DISABLED",
        category: "technical",
        message: `${toolId}@${version} est ${def.status}`,
        userMessage: "Cette action est désactivée.",
      });
    }
    if (def.status !== "Production") {
      throw new ToolRegistryError({
        code: "TOOL_NOT_CALLABLE",
        category: "technical",
        message: `${toolId}@${version} status=${def.status} n’est pas callable (Production requis)`,
        userMessage: "Cette action n’est pas encore disponible.",
      });
    }
    return def;
  }
}

const productionDefinitions: ToolDefinition[] = [
  paymentCreateAttemptV1,
  paymentCreateAttemptV09,
  invoiceGetV1,
  notificationGenerateDraftV1,
];

let cachedProduction: ToolRegistry | null = null;

/** Registre Production — contrats applicatifs uniquement (pas de test-fixtures). */
export function loadProductionRegistry(): ToolRegistry {
  if (!cachedProduction) {
    cachedProduction = new ToolRegistry(productionDefinitions);
  }
  return cachedProduction;
}

/** Pour les tests : registre ad hoc (fixtures), jamais le snapshot Production. */
export function createToolRegistry(
  definitions: ToolDefinition[],
): ToolRegistry {
  return new ToolRegistry(definitions);
}
