import "server-only";

/**
 * Extrait l'adresse IP cliente des en-têtes normalisés par Vercel pour le rate
 * limiting. `x-forwarded-for` est volontairement ignoré : hors garantie de la
 * plateforme, son premier élément peut être fourni par l'appelant.
 *
 * Vercel injecte `x-vercel-forwarded-for` et `x-real-ip`. Hors de ce proxy de
 * confiance, toutes les requêtes partagent un sujet déterministe et les quotas
 * par token restent la défense principale.
 * Valeur brute jamais persistée : elle n'est utilisée que pour dériver un
 * pseudonyme serveur (cf. pseudonymizeRateLimitSubject). Repli non vide stable.
 */
export function clientIpFromHeaders(
  headers: Headers,
  trustedVercelProxy = process.env.VERCEL === "1",
): string {
  if (!trustedVercelProxy) return "untrusted-proxy";

  for (const trustedHeader of ["x-vercel-forwarded-for", "x-real-ip"] as const) {
    const value = headers.get(trustedHeader);
    const first = value?.split(",")[0]?.trim();
    if (first) return first;
  }
  return "untrusted-proxy";
}
