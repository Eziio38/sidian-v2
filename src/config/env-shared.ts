import type { ZodError } from "zod";

export function formatEnvValidationError(
  scope: string,
  error: ZodError,
): string {
  const details = error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");

  return `[${scope}] Variables d'environnement invalides : ${details}`;
}

export function getAppEnvironment(): string {
  if (process.env.VERCEL_ENV) {
    return process.env.VERCEL_ENV;
  }

  if (process.env.NODE_ENV === "production") {
    return "production";
  }

  return "local";
}
