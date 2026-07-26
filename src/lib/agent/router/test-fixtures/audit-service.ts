/**
 * Spy Audit Service mémoire pour tests Router (G1-E).
 * Délègue au service réel — zéro I/O / zéro persistance.
 */

import {
  createAuditService,
  type AuditEvent,
  type AuditService,
} from "@/lib/agent/audit";

export type SpyAuditService = AuditService & {
  builds: AuditEvent[];
  buildCount: () => number;
  reset: () => void;
};

export function createSpyAuditService(): SpyAuditService {
  const real = createAuditService();
  const builds: AuditEvent[] = [];

  return {
    builds,
    build(input: unknown, context: unknown): AuditEvent {
      const event = real.build(input, context);
      builds.push(event);
      return event;
    },
    buildCount: () => builds.length,
    reset() {
      builds.length = 0;
    },
  };
}
