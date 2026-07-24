/**
 * Interface future Tool Router (G1-D).
 * Aucune implémentation dans G1-B.
 */
import type { ToolCallEnvelope, ToolResultEnvelope } from "../schemas/common";

export interface ToolRouter {
  invoke(input: ToolCallEnvelope): Promise<ToolResultEnvelope>;
}
