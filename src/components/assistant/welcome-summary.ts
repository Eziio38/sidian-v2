/**
 * Résumé d’accueil — présentation UI uniquement (montants déjà calculés côté serveur).
 */

export type WelcomeSummaryInput = {
  todayOutstandingCents: number;
  todayCount: number;
  overdueCount: number;
  attentionCount: number;
};

function formatEuroFromCents(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/**
 * Produit 1–2 lignes utiles pour l’empty state (pas de widgets).
 */
export function buildWelcomeSummaryLines(
  input: WelcomeSummaryInput,
): string[] {
  const amount = formatEuroFromCents(Math.max(0, input.todayOutstandingCents));
  const headline =
    input.todayCount <= 0
      ? "Aucun paiement attendu aujourd’hui."
      : input.todayCount === 1
        ? `${amount} est attendu aujourd’hui.`
        : `${amount} sont attendus aujourd’hui.`;

  const interventionNeeded = input.overdueCount + input.attentionCount;
  const detail =
    interventionNeeded <= 0
      ? "Aucun ne nécessite ton intervention."
      : interventionNeeded === 1
        ? "1 point nécessite ton attention."
        : `${interventionNeeded} points nécessitent ton attention.`;

  return [headline, detail];
}

export const FALLBACK_WELCOME_SUMMARY = [
  "Aucun paiement attendu aujourd’hui.",
  "Dis-moi ce que tu veux faire.",
] as const;
