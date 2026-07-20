import type { NextConfig } from "next";

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

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
