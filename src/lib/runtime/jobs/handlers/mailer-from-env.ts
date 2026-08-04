/**
 * Factory FromEnv du canal de relance — server-only (cron / workers).
 *
 * Ne lève jamais : une configuration email absente ou invalide ne doit pas
 * faire tomber le drain des `runtime_job`, qui traite aussi la clôture de
 * dossier — un effet purement interne, sans email. Elle produit un canal
 * explicitement indisponible ; les handlers de relance échouent alors avec un
 * code lisible, et la clôture continue de passer.
 */

import "server-only";

import { loadEmailEnv } from "../../../email/env";
import { createSupabaseEmailOutboxRepository } from "../../../email/outbox/supabase-repository";
import type { EmailPersistenceClient } from "../../../email/outbox/supabase-repository";
import { createAdminClient } from "../../../supabase/admin";
import type { RelanceMailer } from "../types";
import {
  createRelanceMailer,
  createUnavailableRelanceMailer,
  RELANCE_MAILER_ERROR_CODES,
  resolveRelanceMailerStatus,
} from "./mailer";

export async function createRelanceMailerFromEnv(): Promise<RelanceMailer> {
  let env;
  try {
    env = loadEmailEnv();
  } catch {
    // Le message d'erreur peut nommer des champs de configuration : on ne le
    // propage pas, seul un code stable remonte.
    return createUnavailableRelanceMailer(
      RELANCE_MAILER_ERROR_CODES.configInvalid,
    );
  }

  const status = resolveRelanceMailerStatus(env);
  if (!status.available) {
    // Aucun client Supabase n'est même ouvert : rien à enfiler.
    return createUnavailableRelanceMailer(status.errorCode);
  }

  // service_role : `email_outbox` n'est accessible qu'à ce rôle.
  const client = await createAdminClient();
  return createRelanceMailer({
    env,
    outbox: createSupabaseEmailOutboxRepository(
      client as unknown as EmailPersistenceClient,
    ),
  });
}
