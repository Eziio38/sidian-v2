const DEFAULT_REDIRECT_PATH = "/app";

const ALLOWED_REDIRECT_PATHS = new Set([
  "/app",
  "/connexion",
  "/reinitialiser-mot-de-passe",
  "/inscription/verifier-email",
]);

export function resolveSafeRedirectPath(
  candidate: string | null | undefined,
): string {
  if (!candidate) {
    return DEFAULT_REDIRECT_PATH;
  }

  if (!candidate.startsWith("/") || candidate.startsWith("//")) {
    return DEFAULT_REDIRECT_PATH;
  }

  const [pathname] = candidate.split("?");

  if (!ALLOWED_REDIRECT_PATHS.has(pathname)) {
    return DEFAULT_REDIRECT_PATH;
  }

  return pathname;
}
