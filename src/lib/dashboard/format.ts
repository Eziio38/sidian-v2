const EURO_FORMATTER = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
});

const DATE_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatEuroCents(cents: number): string {
  return EURO_FORMATTER.format(cents / 100);
}

export function formatDashboardDate(date: string): string {
  return DATE_FORMATTER.format(new Date(`${date}T12:00:00.000Z`));
}

export function formatDashboardDateTime(timestamp: string): string {
  return DATE_TIME_FORMATTER.format(new Date(timestamp));
}
