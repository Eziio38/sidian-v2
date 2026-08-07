/**
 * Accès anticipé — barrière d'entrée sur les parcours qui engagent de l'argent.
 *
 * Un email confirmé était jusqu'ici la seule condition pour ouvrir un compte
 * Stripe Connect et émettre des demandes de paiement. L'inscription étant
 * libre, n'importe qui pouvait donc encaisser sous la marque Sidian.
 *
 * La liste est pilotée par `SIDIAN_EARLY_ACCESS_EMAILS`. Trois états :
 *
 *   - variable absente ou vide   -> barrière DÉSACTIVÉE (développement local,
 *                                   tests, et tout environnement qui n'a pas
 *                                   encore besoin de restreindre) ;
 *   - variable renseignée        -> seules les adresses listées passent ;
 *   - variable renseignée mais   -> personne ne passe. Une barrière mal
 *     illisible ou vide après       configurée doit se fermer, jamais s'ouvrir :
 *     nettoyage                     c'est le seul comportement qui ne trahit
 *                                   pas silencieusement son intention.
 */

const ENV_KEY = "SIDIAN_EARLY_ACCESS_EMAILS";

export const EARLY_ACCESS_DENIED_MESSAGE =
  "Sidian est en accès anticipé. Cette adresse n'y est pas encore autorisée — écrivez-nous pour rejoindre la liste.";

export class EarlyAccessDeniedError extends Error {
  readonly code = "early_access_denied";

  constructor() {
    super(EARLY_ACCESS_DENIED_MESSAGE);
    this.name = "EarlyAccessDeniedError";
  }
}

function readRawAllowlist(): string | null {
  const raw = process.env[ENV_KEY];
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** La barrière est-elle active dans cet environnement ? */
export function isEarlyAccessEnforced(): boolean {
  return readRawAllowlist() !== null;
}

function parseAllowlist(raw: string): readonly string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * Lève `EarlyAccessDeniedError` si l'adresse n'est pas autorisée.
 *
 * Ne renvoie rien : le seul chemin qui continue est celui de l'autorisation.
 * Accepte `null`/`undefined` pour que les appelants n'aient pas à déréférencer
 * un utilisateur dont l'email peut manquer — une adresse absente est refusée
 * quand la barrière est active.
 */
export function assertEarlyAccess(email: string | null | undefined): void {
  if (!isEarlyAccessAllowed(email)) {
    throw new EarlyAccessDeniedError();
  }
}

/**
 * Variante sans exception, pour les appelants qui construisent eux-mêmes leur
 * réponse (route handlers, actions à état de retour typé).
 */
export function isEarlyAccessAllowed(email: string | null | undefined): boolean {
  const raw = readRawAllowlist();
  if (raw === null) {
    return true;
  }

  const allowlist = parseAllowlist(raw);
  if (allowlist.length === 0) {
    // Variable renseignée mais vide une fois nettoyée : configuration cassée.
    return false;
  }

  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  return normalized.length > 0 && allowlist.includes(normalized);
}
