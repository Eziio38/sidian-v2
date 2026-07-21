import type { NextConfig } from "next";

type DeploymentAppUrlInput = {
  appUrl: string | undefined;
  vercelEnvironment: string | undefined;
  vercelUrl?: string | undefined;
  vercelBranchUrl?: string | undefined;
};

type DeploymentReadinessInput = DeploymentAppUrlInput & {
  sidianEnvironment: string | undefined;
  supabaseUrl: string | undefined;
  supabaseAnonKey: string | undefined;
  supabaseServiceRoleKey: string | undefined;
  supabaseProjectRef: string | undefined;
  supabaseEnvironmentAttestationJwt: string | undefined;
};

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

export function validateDeploymentAppUrl({
  appUrl,
  vercelEnvironment,
  vercelUrl,
  vercelBranchUrl,
}: DeploymentAppUrlInput): void {
  if (vercelEnvironment !== "preview" && vercelEnvironment !== "production") {
    return;
  }

  try {
    if (!appUrl) throw new Error("missing_app_url");

    const parsed = new URL(appUrl);
    if (
      parsed.protocol !== "https:" ||
      isLocalHostname(parsed.hostname) ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("unsafe_app_url");
    }

    if (vercelEnvironment === "preview") {
      const allowedPreviewHostnames = new Set(
        [vercelUrl, vercelBranchUrl]
          .filter((value): value is string => Boolean(value))
          .map((value) => new URL(`https://${value}`).hostname),
      );
      if (
        allowedPreviewHostnames.size === 0 ||
        !allowedPreviewHostnames.has(parsed.hostname)
      ) {
        throw new Error("preview_app_url_mismatch");
      }
    }
  } catch {
    throw new Error(
      "NEXT_PUBLIC_APP_URL doit être une origine HTTPS publique en Preview et Production.",
    );
  }
}

export function validateDeploymentReadiness(
  input: DeploymentReadinessInput,
): void {
  if (
    input.vercelEnvironment !== "preview" &&
    input.vercelEnvironment !== "production"
  ) {
    return;
  }

  validateDeploymentAppUrl(input);

  const expectedEnvironment =
    input.vercelEnvironment === "production" ? "production" : "staging";
  if (input.sidianEnvironment !== expectedEnvironment) {
    throw new Error(
      "SIDIAN_ENVIRONMENT est manquant ou incohérent avec la cible Vercel.",
    );
  }

  if (
    !input.supabaseUrl ||
    !input.supabaseAnonKey?.trim() ||
    !input.supabaseServiceRoleKey?.trim() ||
    !/^[a-z0-9]{8,64}$/.test(input.supabaseProjectRef ?? "")
  ) {
    throw new Error(
      "Configuration Supabase de déploiement manquante ou invalide.",
    );
  }

  try {
    const parsedSupabaseUrl = new URL(input.supabaseUrl);
    const expectedHostnames = new Set([
      `${input.supabaseProjectRef}.supabase.co`,
      `${input.supabaseProjectRef}.supabase.in`,
    ]);
    if (
      parsedSupabaseUrl.protocol !== "https:" ||
      !expectedHostnames.has(parsedSupabaseUrl.hostname) ||
      parsedSupabaseUrl.username ||
      parsedSupabaseUrl.password ||
      parsedSupabaseUrl.port ||
      parsedSupabaseUrl.pathname !== "/" ||
      parsedSupabaseUrl.search ||
      parsedSupabaseUrl.hash
    ) {
      throw new Error("supabase_project_mismatch");
    }
  } catch {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL ne correspond pas au projet Supabase déclaré.",
    );
  }

  try {
    const payload = input.supabaseEnvironmentAttestationJwt?.split(".")[1];
    if (!payload) throw new Error("missing_attestation_payload");
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (
      claims.role !== "sidian_environment_attestor" ||
      claims.sidian_environment !== expectedEnvironment ||
      claims.sidian_project_ref !== input.supabaseProjectRef ||
      typeof claims.exp !== "number" ||
      claims.exp <= Math.floor(Date.now() / 1000)
    ) {
      throw new Error("attestation_claims_mismatch");
    }
  } catch {
    throw new Error(
      "Attestation Supabase de déploiement manquante ou incohérente.",
    );
  }
}

validateDeploymentReadiness({
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
  sidianEnvironment: process.env.SIDIAN_ENVIRONMENT,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  supabaseProjectRef: process.env.SIDIAN_SUPABASE_PROJECT_REF,
  supabaseEnvironmentAttestationJwt:
    process.env.SUPABASE_ENVIRONMENT_ATTESTATION_JWT,
  vercelEnvironment: process.env.VERCEL_ENV,
  vercelUrl: process.env.VERCEL_URL,
  vercelBranchUrl: process.env.VERCEL_BRANCH_URL,
});

function assertStripeBuildReadiness(): void {
  const enabled = process.env.NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED;
  if (enabled !== "true" && enabled !== "false") {
    throw new Error(
      "NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED doit être explicitement true ou false.",
    );
  }
  if (enabled === "false") return;

  const environment = process.env.SIDIAN_ENVIRONMENT;
  const mode = process.env.STRIPE_MODE;
  const secret = process.env.STRIPE_SECRET_KEY ?? "";
  const publishable = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
  const webhook = process.env.STRIPE_CONNECT_WEBHOOK_SECRET ?? "";
  const writerJwt = process.env.SUPABASE_STRIPE_BINDING_WRITER_JWT ?? "";
  const deploymentEnvironment =
    process.env.VERCEL_ENV === "production"
      ? "production"
      : process.env.VERCEL_ENV === "preview"
        ? "staging"
        : "local";
  const expectedMode = deploymentEnvironment === "production" ? "live" : "test";
  let writerClaims: { role?: unknown; sidian_environment?: unknown; exp?: unknown } = {};
  try {
    const payload = writerJwt.split(".")[1];
    if (!payload) throw new Error("missing_payload");
    writerClaims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as typeof writerClaims;
  } catch {
    throw new Error("Readiness Stripe incomplète ou incohérente pour ce déploiement.");
  }
  if (
    environment !== deploymentEnvironment ||
    mode !== expectedMode ||
    !secret.startsWith(`sk_${expectedMode}_`) ||
    !publishable.startsWith(`pk_${expectedMode}_`) ||
    !/^whsec_\S+$/.test(webhook) ||
    writerClaims.role !== "stripe_customer_binding_writer" ||
    writerClaims.sidian_environment !== environment ||
    typeof writerClaims.exp !== "number" ||
    writerClaims.exp <= Math.floor(Date.now() / 1000)
  ) {
    throw new Error("Readiness Stripe incomplète ou incohérente pour ce déploiement.");
  }
}

assertStripeBuildReadiness();

export function buildContentSecurityPolicy(
  nodeEnvironment: string | undefined = process.env.NODE_ENV,
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): string {
  const isDevelopment = nodeEnvironment === "development";
  const supabaseOrigins: string[] = [];
  try {
    if (supabaseUrl) {
      const parsedSupabaseUrl = new URL(supabaseUrl);
      if (
        parsedSupabaseUrl.protocol === "https:" &&
        (parsedSupabaseUrl.hostname.endsWith(".supabase.co") ||
          parsedSupabaseUrl.hostname.endsWith(".supabase.in"))
      ) {
        supabaseOrigins.push(
          parsedSupabaseUrl.origin,
          `wss://${parsedSupabaseUrl.hostname}`,
        );
      }
    }
  } catch {
    // La validation de déploiement échoue séparément ; la CSP reste fermée.
  }
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    [
      "connect-src 'self'",
      ...supabaseOrigins,
      ...(isDevelopment
        ? [
            "http://localhost:*",
            "http://127.0.0.1:*",
            "ws://localhost:*",
            "ws://127.0.0.1:*",
          ]
        : []),
    ].join(" "),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com https://connect.stripe.com",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(nodeEnvironment === "production"
      ? ["upgrade-insecure-requests"]
      : []),
  ];

  return `${directives.join("; ")};`;
}

export const globalSecurityHeaders = [
  { key: "Content-Security-Policy", value: buildContentSecurityPolicy() },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Frame-Options", value: "DENY" },
];

export const publicPaymentRouteSource = "/p/:path*";

export const authSensitiveRouteSources = [
  "/connexion",
  "/inscription",
  "/inscription/verifier-email",
  "/mot-de-passe-oublie",
  "/reinitialiser-mot-de-passe",
  "/auth/:path*",
] as const;

export const authSensitiveRouteHeaders = [
  {
    key: "Cache-Control",
    value: "private, no-cache, no-store, must-revalidate, max-age=0",
  },
  { key: "Pragma", value: "no-cache" },
  { key: "Expires", value: "0" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

export const publicPaymentRouteHeaders = [
  {
    key: "Cache-Control",
    value: "private, no-store, max-age=0, must-revalidate",
  },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: globalSecurityHeaders,
      },
      {
        source: publicPaymentRouteSource,
        headers: publicPaymentRouteHeaders,
      },
      ...authSensitiveRouteSources.map((source) => ({
        source,
        headers: authSensitiveRouteHeaders,
      })),
    ];
  },
};

export default nextConfig;
