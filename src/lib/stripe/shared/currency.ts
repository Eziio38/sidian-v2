import "server-only";

/** Devise Stripe MVP — exclusivement EUR (minuscules côté API Stripe). */
export const MVP_CURRENCY = "eur" as const;

export type MvpCurrency = typeof MVP_CURRENCY;

export function assertMvpCurrency(
  currency: string,
): asserts currency is MvpCurrency {
  if (currency.trim().toLowerCase() !== MVP_CURRENCY) {
    throw new Error("stripe_currency_not_eur");
  }
}

/** Devise créance produit (majuscules) → refuse avant tout appel Stripe. */
export function assertCreanceDeviseEur(devise: string): void {
  if (devise.trim().toUpperCase() !== "EUR") {
    throw new Error("creance_devise_not_eur");
  }
}
