/**
 * Ménage des téléversements jamais confirmés, branché sur le cron drains.
 *
 * Une ligne `document` réservée mais dont les octets ne sont jamais arrivés
 * (onglet fermé, réseau coupé) reste en `pending_upload`. Sans ce passage,
 * ces lignes s'accumulent indéfiniment et le bucket peut conserver des octets
 * orphelins. `purge_abandoned_document_uploads` est réservée à service_role :
 * elle est transverse à tous les tenants et n'est jamais joignable depuis une
 * session utilisateur.
 *
 * Module dédié, volontairement séparé de `src/lib/runtime/cron/runtime-jobs.ts`
 * pour que le câblage documents n'entre pas en collision avec le drain des
 * `runtime_job`.
 */

import "server-only";

import { logServerEvent } from "@/lib/observability/server-logger";
import { createAdminClient } from "@/lib/supabase/admin";

import { ABANDONED_DOCUMENT_UPLOAD_TTL_HOURS } from "./schemas";
import { cleanupAbandonedDocumentUploads } from "./service";
import { createSupabaseDocumentMaintenance } from "./supabase-repository";

const DEFAULT_PURGE_LIMIT = 200;
const MAX_PURGE_LIMIT = 1000;

export type DocumentUploadsPurgeSummary = {
  status: "completed" | "partial" | "failed" | "deadline_reached";
  reasonCode?: string;
  /** Lignes passées en `deleted`. */
  purged: number;
  /**
   * `false` quand les lignes ont été marquées mais que les octets n'ont pas pu
   * être retirés du bucket — l'écart est signalé, jamais masqué.
   */
  objectsRemoved: boolean;
  durationMs: number;
};

export type RunAbandonedDocumentUploadsPurgeInput = {
  requestId: string;
  limit?: number;
  olderThanHours?: number;
  isDeadlineExpired?: () => boolean;
};

export async function runAbandonedDocumentUploadsPurge(
  input: RunAbandonedDocumentUploadsPurgeInput,
): Promise<DocumentUploadsPurgeSummary> {
  const started = Date.now();

  if (input.isDeadlineExpired?.()) {
    return {
      status: "deadline_reached",
      reasonCode: "deadline_before_start",
      purged: 0,
      objectsRemoved: true,
      durationMs: 0,
    };
  }

  const limit = Math.min(
    MAX_PURGE_LIMIT,
    Math.max(1, Math.trunc(input.limit ?? DEFAULT_PURGE_LIMIT)),
  );

  try {
    const admin = await createAdminClient();
    const maintenance = createSupabaseDocumentMaintenance(admin);
    const result = await cleanupAbandonedDocumentUploads(maintenance, {
      olderThanHours:
        input.olderThanHours ?? ABANDONED_DOCUMENT_UPLOAD_TTL_HOURS,
      limit,
    });

    const durationMs = Math.max(0, Date.now() - started);

    if (!result.ok) {
      // Les lignes peuvent avoir été marquées supprimées sans que les octets
      // aient été retirés : c'est « partial », pas « completed ».
      const partial = result.error.code === "document_storage_unavailable";
      logServerEvent("warn", "document_uploads_purge_failed", {
        requestId: input.requestId,
        reasonCode: result.error.code,
        durationMs,
      });
      return {
        status: partial ? "partial" : "failed",
        reasonCode: result.error.code,
        purged: 0,
        objectsRemoved: false,
        durationMs,
      };
    }

    logServerEvent("info", "document_uploads_purged", {
      requestId: input.requestId,
      purged: result.value.purged,
      objectsRemoved: result.value.objectsRemoved,
      durationMs,
    });

    return {
      status: "completed",
      purged: result.value.purged,
      objectsRemoved: result.value.objectsRemoved,
      durationMs,
    };
  } catch (cause) {
    const durationMs = Math.max(0, Date.now() - started);
    const reasonCode =
      cause instanceof Error
        ? cause.message.slice(0, 80)
        : "document_purge_bootstrap_failed";
    logServerEvent("error", "document_uploads_purge_failed", {
      requestId: input.requestId,
      reasonCode,
      durationMs,
    });
    return {
      status: "failed",
      reasonCode,
      purged: 0,
      objectsRemoved: false,
      durationMs,
    };
  }
}
