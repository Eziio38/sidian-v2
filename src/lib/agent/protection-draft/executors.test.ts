/**
 * G1-M — exécuteurs : tenant/actor depuis TrustedExecutionContext uniquement.
 */

import { describe, expect, it } from "vitest";

import { createProtectionDraftExecutors } from "./executors";
import { createProtectionDraftService } from "./service";
import {
  ACTOR_A,
  EXAMPLE_MESSAGE,
  NOW,
  TENANT_A,
  createMemoryProtectionDraftRepository,
} from "./test-fixtures";

describe("G1-M protection draft executors", () => {
  it("utilise tenant/actor de l’exécuteur, pas des arguments", async () => {
    const repo = createMemoryProtectionDraftRepository();
    // Service avec now injecté via wrapper
    const inner = createProtectionDraftService(repo);
    const service = {
      ...inner,
      advance: (input: Parameters<typeof inner.advance>[0]) =>
        inner.advance({ ...input, now: input.now || NOW }),
      get: (input: Parameters<typeof inner.get>[0]) =>
        inner.get({ ...input, now: input.now || NOW }),
      cancel: (input: Parameters<typeof inner.cancel>[0]) =>
        inner.cancel({ ...input, now: input.now || NOW }),
      confirm: (input: Parameters<typeof inner.confirm>[0]) =>
        inner.confirm({ ...input, now: input.now || NOW }),
    };
    const resolve = createProtectionDraftExecutors(service);
    const executor = resolve("protection.draft.advance", "1.0.0");
    expect(executor).toBeTruthy();

    const poisonedArgs = {
      intent: { kind: "message" as const, text: EXAMPLE_MESSAGE },
      tenant_id: "99999999-9999-4999-8999-999999999999",
      actor_id: "attacker",
    };

    const result = (await executor!.execute({
      arguments: poisonedArgs,
      actor: { actor_id: ACTOR_A, actor_type: "human" },
      tenant: { tenant_id: TENANT_A },
      correlation_id: "corr_g1m_1",
    })) as { draft_id: string };

    const stored = repo._store.get(result.draft_id);
    expect(stored?.tenant_id).toBe(TENANT_A);
    expect(stored?.actor_id).toBe(ACTOR_A);
    expect(repo._clients.size).toBe(0);
  });

  it("fail-closed pour outil inconnu", () => {
    const resolve = createProtectionDraftExecutors(
      createProtectionDraftService(createMemoryProtectionDraftRepository()),
    );
    expect(resolve("payment.create_attempt", "1.0.0")).toBeUndefined();
  });
});
