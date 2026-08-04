/**
 * Libellés français des relances — déterministes et testables.
 *
 * Ces libellés partent en clair dans un email : ils ne doivent dépendre ni de
 * la locale du serveur, ni du fuseau de la machine. D'où la locale et le
 * fuseau passés explicitement à `Intl`.
 */

/**
 * Montant en centimes → libellé monétaire français.
 *
 * La devise vient de la créance, jamais d'une constante : afficher « € » sur
 * une créance libellée dans une autre devise serait un mensonge de montant.
 * Une devise inexploitable retombe sur un format neutre plutôt que de lever —
 * un email juste vaut mieux qu'une relance perdue.
 */
export function formatMontantLabel(cents: number, devise: string): string {
  const amount = cents / 100;
  const currency = devise.trim().toUpperCase();
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${new Intl.NumberFormat("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)} ${currency}`;
  }
}

const LONG_DATE = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  // UTC : `date_echeance` est une date civile, pas un instant.
  timeZone: "UTC",
});

const CIVIL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Date civile `YYYY-MM-DD` → forme longue française (« 3 août 2026 »).
 * Une entrée non parsable est renvoyée telle quelle : mieux vaut une date
 * technique lisible qu'un « Invalid Date » envoyé à un client.
 */
export function formatDateEcheanceLabel(isoDate: string): string {
  const trimmed = isoDate.trim();
  const match = trimmed.match(CIVIL_DATE_RE);
  if (!match) return trimmed;
  const timestamp = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  if (!Number.isFinite(timestamp)) return trimmed;
  return LONG_DATE.format(new Date(timestamp));
}
