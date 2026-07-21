import { describe, expect, it } from "vitest";

import { validateSupabaseEnvironmentAttestation } from "@/config/env-server";

function fakeAttestationJwt(input?: {
  environment?: string;
  projectRef?: string;
  expiresAt?: number;
}) {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    role: "sidian_environment_attestor",
    sidian_environment: input?.environment ?? "staging",
    sidian_project_ref: input?.projectRef ?? "abcdefghijklmnopqrst",
    exp: input?.expiresAt ?? Math.floor(Date.now() / 1000) + 3_600,
  })}.signature`;
}

const validInput = {
  NEXT_PUBLIC_SUPABASE_URL:
    "https://abcdefghijklmnopqrst.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_ENVIRONMENT_ATTESTATION_JWT: fakeAttestationJwt(),
  SIDIAN_ENVIRONMENT: "staging",
  SIDIAN_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
} as const;

describe("attestation Supabase de déploiement", () => {
  it("accepte des claims staging cohérents avant vérification distante", () => {
    expect(
      validateSupabaseEnvironmentAttestation(validInput, "staging"),
    ).toMatchObject({
      SIDIAN_ENVIRONMENT: "staging",
      SIDIAN_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
    });
  });

  it.each([
    {
      ...validInput,
      SUPABASE_ENVIRONMENT_ATTESTATION_JWT: fakeAttestationJwt({
        environment: "production",
      }),
    },
    {
      ...validInput,
      SUPABASE_ENVIRONMENT_ATTESTATION_JWT: fakeAttestationJwt({
        projectRef: "differentprojectref123",
      }),
    },
    {
      ...validInput,
      SUPABASE_ENVIRONMENT_ATTESTATION_JWT: fakeAttestationJwt({
        expiresAt: Math.floor(Date.now() / 1000) - 1,
      }),
    },
    { ...validInput, SUPABASE_ENVIRONMENT_ATTESTATION_JWT: "invalid" },
  ])("refuse une attestation auto-déclarée incohérente", (input) => {
    expect(() =>
      validateSupabaseEnvironmentAttestation(input, "staging"),
    ).toThrow(/Attestation Supabase/);
  });
});
