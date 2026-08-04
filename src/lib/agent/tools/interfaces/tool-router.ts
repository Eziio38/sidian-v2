/**
 * Interface enveloppe stub G1-B (`invoke` / ToolCallEnvelope).
 * L’implémentation déterministe G1-D est `createToolRouter().route()` sous
 * `@/lib/agent/router` — contrat distinct, zéro I/O métier.
 */
import type { ToolCallEnvelope, ToolResultEnvelope } from "../schemas/common";

export interface ToolRouter {
  invoke(input: ToolCallEnvelope): Promise<ToolResultEnvelope>;
}
