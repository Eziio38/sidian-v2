import "server-only";

import { StripeDomainError } from "@/lib/stripe/shared/errors";

/**
 * Vérifie que l'opération cible le compte Connect attendu.
 * Empêche un événement ou un Account d'un autre merchant de muter le mauvais prestataire.
 */
export function assertConnectedScope(params: {
  expectedAccountId: string | null | undefined;
  actualAccountId: string | null | undefined;
  context: string;
}): void {
  const expected = params.expectedAccountId?.trim() ?? "";
  const actual = params.actualAccountId?.trim() ?? "";

  if (!expected || !actual || expected !== actual) {
    throw new StripeDomainError(
      "stripe_connected_scope_mismatch",
      `Scope Connect invalide (${params.context}).`,
    );
  }
}
