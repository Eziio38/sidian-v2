/**
 * Source de candidats scanners pour le cron.
 * Lit creance / dossier_suivi / regle / tentatives via service_role.
 *
 * Fail-closed `not_configured` uniquement si credentials Supabase admin
 * absents — pas de stub métier qui masquerait un câblage manquant.
 */

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { RuntimeError } from "../errors";
import type { ScannerCandidateSource } from "../scanners/candidates";
import {
  createSupabaseScannerCandidateSource,
  type ScannerCandidateQueryClient,
} from "../scanners/supabase-candidate-source";

export const SCANNER_CANDIDATE_SOURCE_STATUS = "supabase" as const;

export function isScannerCandidateAdminConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    Boolean(env.SUPABASE_SERVICE_ROLE_KEY) &&
    Boolean(env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}

export type CreateScannerCandidateSourceFromEnvInput = {
  /** Injection tests / partage client admin déjà créé. */
  client?: ScannerCandidateQueryClient;
};

/**
 * Branche la projection SQL réelle dès que l’admin Supabase est disponible.
 */
export async function createScannerCandidateSourceFromEnv(
  input: CreateScannerCandidateSourceFromEnvInput = {},
): Promise<ScannerCandidateSource> {
  if (input.client) {
    return createSupabaseScannerCandidateSource(input.client);
  }

  if (!isScannerCandidateAdminConfigured()) {
    throw new RuntimeError(
      "not_configured",
      "scanner_candidate_source_requires_supabase_admin",
    );
  }

  const client = (await createAdminClient()) as unknown as ScannerCandidateQueryClient;
  return createSupabaseScannerCandidateSource(client);
}
