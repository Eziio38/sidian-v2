import { describe, expect, it } from "vitest";

import nextConfig, {
  buildContentSecurityPolicy,
  authSensitiveRouteHeaders,
  authSensitiveRouteSources,
  globalSecurityHeaders,
  publicPaymentRouteHeaders,
  validateDeploymentAppUrl,
  validateDeploymentReadiness,
} from "../../next.config";

describe("sécurité HTTP globale", () => {
  it("applique les en-têtes défensifs sans affaiblir les pages /p/*", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(globalSecurityHeaders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "Content-Security-Policy" }),
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        {
          key: "Referrer-Policy",
          value: "strict-origin-when-cross-origin",
        },
      ]),
    );
    expect(publicPaymentRouteHeaders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "Cache-Control",
          value: expect.stringContaining("no-store"),
        }),
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ]),
    );

    const rules = await nextConfig.headers?.();
    expect(rules?.map((rule) => rule.source)).toEqual([
      "/:path*",
      "/p/:path*",
      ...authSensitiveRouteSources,
    ]);
    expect(authSensitiveRouteHeaders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "Cache-Control",
          value: expect.stringContaining("no-store"),
        }),
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ]),
    );
  });

  it("autorise Supabase et les redirections Checkout sans ouvrir les frames", () => {
    const policy = buildContentSecurityPolicy(
      "production",
      "https://abcdefghijklmnopqrst.supabase.co",
    );

    expect(policy).toContain(
      "connect-src 'self' https://abcdefghijklmnopqrst.supabase.co wss://abcdefghijklmnopqrst.supabase.co",
    );
    expect(policy).not.toContain("*.supabase.co");
    expect(policy).toContain(
      "form-action 'self' https://checkout.stripe.com https://connect.stripe.com",
    );
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("n'autorise eval et Supabase local qu'en développement", () => {
    const policy = buildContentSecurityPolicy("development");

    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("http://127.0.0.1:*");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });
});

describe("URL publique des déploiements Vercel", () => {
  it("accepte une origine HTTPS publique en Preview", () => {
    expect(() =>
      validateDeploymentAppUrl({
        appUrl: "https://sidian-preview.example.test",
        vercelEnvironment: "preview",
        vercelUrl: "sidian-preview.example.test",
      }),
    ).not.toThrow();
  });

  it.each([
    undefined,
    "http://sidian-preview.example.test",
    "https://localhost:3000",
    "https://sidian-preview.example.test/path",
    "https://user:password@sidian-preview.example.test",
  ])("refuse une origine non sûre hors local (%s)", (appUrl) => {
    expect(() =>
      validateDeploymentAppUrl({
        appUrl,
        vercelEnvironment: "preview",
        vercelUrl: "sidian-preview.example.test",
      }),
    ).toThrow(/origine HTTPS publique/);
  });

  it("laisse le serveur local utiliser localhost", () => {
    expect(() =>
      validateDeploymentAppUrl({
        appUrl: "http://localhost:3000",
        vercelEnvironment: undefined,
      }),
    ).not.toThrow();
  });

  const attestationPayload = Buffer.from(
    JSON.stringify({
      role: "sidian_environment_attestor",
      sidian_environment: "staging",
      sidian_project_ref: "abcdefghijklmnopqrst",
      exp: Math.floor(Date.now() / 1000) + 3_600,
    }),
    "utf8",
  ).toString("base64url");
  const validPreviewReadiness = {
    appUrl: "https://sidian-preview.example.test",
    vercelEnvironment: "preview",
    sidianEnvironment: "staging",
    supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
    supabaseAnonKey: "anon-preview",
    supabaseServiceRoleKey: "service-role-preview",
    supabaseProjectRef: "abcdefghijklmnopqrst",
    supabaseEnvironmentAttestationJwt: `header.${attestationPayload}.signature`,
    vercelUrl: "sidian-preview.example.test",
  } as const;

  it("lie explicitement une Preview au projet Supabase staging déclaré", () => {
    expect(() =>
      validateDeploymentReadiness(validPreviewReadiness),
    ).not.toThrow();
  });

  it("refuse qu'une Preview redirige vers une autre origine, notamment Production", () => {
    expect(() =>
      validateDeploymentReadiness({
        ...validPreviewReadiness,
        appUrl: "https://sidian.example.com",
      }),
    ).toThrow(/origine HTTPS publique/);
  });

  it.each([
    [
      { ...validPreviewReadiness, sidianEnvironment: "production" },
      /SIDIAN_ENVIRONMENT/,
    ],
    [
      { ...validPreviewReadiness, supabaseProjectRef: undefined },
      /Configuration Supabase/,
    ],
    [
      {
        ...validPreviewReadiness,
        supabaseUrl: "https://wrongprojectref123.supabase.co",
      },
      /ne correspond pas/,
    ],
    [
      { ...validPreviewReadiness, supabaseServiceRoleKey: "" },
      /Configuration Supabase/,
    ],
    [
      {
        ...validPreviewReadiness,
        supabaseEnvironmentAttestationJwt: undefined,
      },
      /Attestation Supabase/,
    ],
  ])("refuse un contrat Preview incohérent", (input, expectedError) => {
    expect(() => validateDeploymentReadiness(input)).toThrow(expectedError);
  });
});
