/**
 * Tool Registry mémoire G1-D.
 * N’appelle pas assertSchemasRegistered — permet les fixtures INPUT/OUTPUT_SCHEMA_UNRESOLVED.
 */

import type { ToolDefinition } from "@/lib/agent/tools/definition-schema";

function toolKey(toolId: string, version: string): string {
  return `${toolId}@${version}`;
}

/**
 * Registre structurel compatible avec l’API attendue du Router :
 * `get(toolId, version) → ToolDefinition | null`.
 */
export type MemoryToolRegistry = {
  get(toolId: string, version: string): ToolDefinition | null;
  list(): ToolDefinition[];
};

export function createMemoryToolRegistry(
  definitions: ToolDefinition[],
): MemoryToolRegistry {
  const byKey = new Map<string, ToolDefinition>();
  for (const def of definitions) {
    byKey.set(toolKey(def.tool_id, def.version), def);
  }

  return {
    get(toolId: string, version: string): ToolDefinition | null {
      return byKey.get(toolKey(toolId, version)) ?? null;
    },
    list(): ToolDefinition[] {
      return [...byKey.values()];
    },
  };
}
