import type { EmailEnv } from "./env";
import {
  createEmailOutboxService,
  type EmailOutboxService,
  type EnqueueEmailInput,
} from "./outbox/service";
import {
  processEmailOutboxRecord,
  processQueuedEmailBatch,
  type ProcessEmailResult,
} from "./outbox/processor";
import type { EmailOutboxRepository } from "./outbox/repository";
import type { EmailProvider } from "./provider";
import type { EmailOutboxRecord, EmailTemplateKey } from "./types";

/**
 * Canal email domaine — jamais couplé à un vendor.
 * enqueue = intention persistée ; process* = livraison via EmailProvider.
 */
export type EmailChannel = {
  enqueue<K extends EmailTemplateKey>(
    input: EnqueueEmailInput<K>,
  ): Promise<EmailOutboxRecord>;
  process(outboxId: string): Promise<ProcessEmailResult>;
  processBatch(limit?: number): Promise<ProcessEmailResult[]>;
};

export function createEmailChannel(deps: {
  outbox: EmailOutboxRepository;
  env: EmailEnv;
  provider?: EmailProvider;
}): EmailChannel {
  const service: EmailOutboxService = createEmailOutboxService({
    outbox: deps.outbox,
    env: deps.env,
  });

  return {
    enqueue: (input) => service.enqueue(input),
    process: (outboxId) =>
      processEmailOutboxRecord({
        outboxId,
        outbox: deps.outbox,
        env: deps.env,
        provider: deps.provider,
      }),
    processBatch: (limit) =>
      processQueuedEmailBatch({
        outbox: deps.outbox,
        env: deps.env,
        provider: deps.provider,
        limit,
      }),
  };
}
