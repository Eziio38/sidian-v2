/**
 * Adapter auth HTTP pour createAgentServerHandler (G1-L).
 *
 * Réutilise `ServerRequestAuthAdapter` (G1-K) :
 * Bearer / cookies → AuthMaterial + métadonnées — **jamais** depuis le body.
 */

import "server-only";

import {
  createServerRequestAuthAdapter,
  type ServerRequestAuthAdapter,
} from "@/lib/agent/gateway/adapters";

import type { AgentServerAuthAdapter } from "../route-handler";

/**
 * Crée l’authAdapter injecté dans `createAgentServerHandler`.
 * Identique au contrat G1-K ; typé pour le Server Route Adapter.
 */
export function createAgentHttpAuthAdapter(): AgentServerAuthAdapter &
  ServerRequestAuthAdapter {
  return createServerRequestAuthAdapter();
}
