import "server-only";

import { createClient } from "@supabase/supabase-js";

import {
  getApplicationEnvironment,
  getSupabaseEnvironmentAttestationEnv,
} from "@/config/env-server";
import type { Database } from "@/types/database.generated";

const ATTESTATION_TIMEOUT_MS = 5_000;
let successfulAttestation: Promise<void> | undefined;

type AttestationResult = {
  environment: "local" | "staging" | "production";
  project_ref: string;
};

function isAttestationResult(value: unknown): value is AttestationResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AttestationResult>;
  return (
    (candidate.environment === "local" ||
      candidate.environment === "staging" ||
      candidate.environment === "production") &&
    typeof candidate.project_ref === "string"
  );
}

async function verifySupabaseDeploymentEnvironment(): Promise<void> {
  const env = getSupabaseEnvironmentAttestationEnv();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATTESTATION_TIMEOUT_MS);
  const guardedFetch: typeof fetch = (input, init) =>
    fetch(input, { ...init, signal: controller.signal });

  try {
    const attestor = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        auth: { autoRefreshToken: false, persistSession: false },
        global: {
          headers: {
            Authorization: `Bearer ${env.SUPABASE_ENVIRONMENT_ATTESTATION_JWT}`,
          },
          fetch: guardedFetch,
        },
      },
    );
    const attestation = await attestor.rpc("attest_sidian_environment");
    if (
      attestation.error ||
      !isAttestationResult(attestation.data) ||
      attestation.data.environment !== env.SIDIAN_ENVIRONMENT ||
      attestation.data.project_ref !== env.SIDIAN_SUPABASE_PROJECT_REF
    ) {
      throw new Error("environment_attestation_failed");
    }

    const admin = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { fetch: guardedFetch },
      },
    );
    const serviceRoleProbe = await admin.rpc("service_role_healthcheck");
    if (serviceRoleProbe.error || serviceRoleProbe.data !== true) {
      throw new Error("service_role_attestation_failed");
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function assertSupabaseDeploymentEnvironment(): Promise<void> {
  if (getApplicationEnvironment() === "local") return;

  successfulAttestation ??= verifySupabaseDeploymentEnvironment().catch(
    (error) => {
      successfulAttestation = undefined;
      throw error;
    },
  );
  await successfulAttestation;
}

export function resetSupabaseEnvironmentAttestationForTests(): void {
  if (process.env.NODE_ENV !== "test") return;
  successfulAttestation = undefined;
}
