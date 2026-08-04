/**
 * Factory Email drain FromEnv — fail-closed live.
 * Branche le module Email (A) : Supabase outbox + provider FromEnv.
 */

import "server-only";

import { loadEmailEnv, type EmailEnv } from "../../../email/env";
import { createEmailProviderFromEnv } from "../../../email/provider";
import { createSupabaseEmailOutboxRepository } from "../../../email/outbox/supabase-repository";
import type { EmailPersistenceClient } from "../../../email/outbox/supabase-repository";
import type { EmailOutboxRepository } from "../../../email/outbox/repository";
import { createAdminClient } from "../../../supabase/admin";
import type { OutboxDrain } from "../types";
import { createEmailOutboxDrain } from "./drain";

export type CreateEmailOutboxDrainFromEnvInput = {
  env?: EmailEnv;
  /** Tests stub uniquement — interdit en live. */
  outbox?: EmailOutboxRepository;
};

export async function createEmailOutboxDrainFromEnv(
  input: CreateEmailOutboxDrainFromEnvInput = {},
): Promise<OutboxDrain> {
  const env = input.env ?? loadEmailEnv();

  if (env.mode === "disabled") {
    return createEmailOutboxDrain({
      outbox: {
        async insertQueued() {
          throw new Error("email_drain_disabled");
        },
        async findByIdempotencyKey() {
          return null;
        },
        async findById() {
          return null;
        },
        async findByProviderMessageId() {
          return null;
        },
        async claimForProcessing() {
          return null;
        },
        async markSent() {
          throw new Error("email_drain_disabled");
        },
        async markFailedRetryable() {
          throw new Error("email_drain_disabled");
        },
        async markFailedTerminal() {
          throw new Error("email_drain_disabled");
        },
        async markDeadLetter() {
          throw new Error("email_drain_disabled");
        },
        async listClaimable() {
          return [];
        },
      },
      env,
    });
  }

  if (env.mode === "live") {
    if (input.outbox) {
      throw new Error(
        "email_outbox_drain_live_forbids_injected_memory_repository",
      );
    }
    const client = await createAdminClient();
    const outbox = createSupabaseEmailOutboxRepository(
      client as unknown as EmailPersistenceClient,
    );
    return createEmailOutboxDrain({
      outbox,
      env,
      provider: createEmailProviderFromEnv(env),
    });
  }

  // stub — local only
  if (!input.outbox) {
    throw new Error(
      "email_outbox_drain_stub_requires_injected_outbox_repository",
    );
  }
  return createEmailOutboxDrain({
    outbox: input.outbox,
    env,
    provider: createEmailProviderFromEnv(env),
  });
}
