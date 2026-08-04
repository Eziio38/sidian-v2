/**
 * Factory live fail-closed — drain audit Connect outbox.
 */

import "server-only";

import { createAdminClient } from "../../../supabase/admin";
import type { OutboxDrain } from "../types";
import { createPaymentConnectAuditOutboxDrain } from "./drain";

export async function createPaymentConnectAuditOutboxDrainFromEnv(): Promise<OutboxDrain> {
  const client = await createAdminClient();
  return createPaymentConnectAuditOutboxDrain({ client });
}
