/**
 * Harness G1-K — gateway + resolvers mémoire prêts à l’emploi.
 */

import { createRequestGateway } from "@/lib/agent/gateway";
import type { RequestGateway } from "@/lib/agent/gateway";

import {
  createMemoryMembershipResolver,
  createMemoryPrincipalResolver,
  type MemoryMembershipResolver,
  type MemoryPrincipalResolver,
} from "./memory-resolvers";

export type GatewayTestHarness = {
  gateway: RequestGateway;
  principalResolver: MemoryPrincipalResolver;
  membershipResolver: MemoryMembershipResolver;
};

export function createGatewayTestHarness(): GatewayTestHarness {
  const principalResolver = createMemoryPrincipalResolver();
  const membershipResolver = createMemoryMembershipResolver();
  const gateway = createRequestGateway({
    principalResolver,
    membershipResolver,
  });
  return { gateway, principalResolver, membershipResolver };
}
