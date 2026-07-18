import { z } from "zod";

function normalizeSpaces(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Contrat email MVP aligné SQL canonicalize_email. */
export function canonicalizeEmailInput(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isSidianEmail(canonical: string): boolean {
  if (!canonical || canonical.length > 254) return false;
  if (/\s/.test(canonical)) return false;

  const at = canonical.indexOf("@");
  if (at < 1) return false;

  const local = canonical.slice(0, at);
  const domain = canonical.slice(at + 1);

  if (!local || !domain) return false;
  if (local.length > 64 || domain.length > 253) return false;
  if (domain.includes("@")) return false;

  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return false;
  }

  if (!domain.includes(".")) return false;
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    return false;
  }

  const labels = domain.split(".");
  if (labels.length < 2) return false;

  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i];
    if (!label || label.length > 63) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
    if (!/^[a-z0-9-]+$/i.test(label)) return false;
    if (i === labels.length - 1 && !/^[a-z]{2,}$/i.test(label)) return false;
  }

  return true;
}

/**
 * Email structurellement valide (local ≤64, labels ≤63, TLD ≥2 lettres)
 * mais rejeté uniquement par `canonical.length > 254`.
 * Longueur totale exacte : 255.
 */
export const SIDIAN_EMAIL_INVALID_LENGTH_255 = (() => {
  const local = "a".repeat(64);
  const domain = `${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(58)}.com`;
  const email = `${local}@${domain}`;
  if (email.length !== 255) {
    throw new Error(
      `SIDIAN_EMAIL_INVALID_LENGTH_255: expected length 255, got ${email.length}`,
    );
  }
  return email;
})();

export const SIDIAN_EMAIL_INVALID_EXAMPLES = [
  "a@",
  "@example.com",
  "a b@example.com",
  "a@example",
  "",
  "   ",
  ".a@example.com",
  "a.@example.com",
  "a..b@example.com",
  "a@example..com",
  "a@-example.com",
  "a@example-.com",
  "a@exam_ple.com",
  `${"x".repeat(65)}@example.com`,
  "a@example.c",
  SIDIAN_EMAIL_INVALID_LENGTH_255,
] as const;

export const SIDIAN_EMAIL_VALID_EXAMPLES = [
  "a@example.com",
  "first.last@example.com",
  "first+tag@example.co.uk",
  "  Jean.Test@Example.COM ",
] as const;

/** Montant euros accepté : entier ou jusqu'à 2 décimales, séparateur `.` (`,` normalisé). */
export const MONTANT_EUROS_PATTERN = /^(0|[1-9]\d*)(\.\d{1,2})?$/;

export const MONTANT_CENTS_MIN = 1;
export const MONTANT_CENTS_MAX = 100_000_000; // 1 000 000,00 EUR

/**
 * Conversion exacte euros → centimes (pas de flottant monétaire).
 * Prérequis : chaîne déjà normalisée (`.` décimal, ≤ 2 décimales).
 */
export function eurosToCentsExact(montantEuros: string): number {
  if (!MONTANT_EUROS_PATTERN.test(montantEuros)) {
    throw new Error("montant_invalid");
  }

  const [wholePart, fractionPart = ""] = montantEuros.split(".");
  const whole = BigInt(wholePart);
  const fraction = BigInt((fractionPart + "00").slice(0, 2));
  const centsBig = whole * BigInt(100) + fraction;

  if (centsBig < BigInt(MONTANT_CENTS_MIN) || centsBig > BigInt(MONTANT_CENTS_MAX)) {
    throw new Error("montant_out_of_bounds");
  }

  const cents = Number(centsBig);
  if (!Number.isSafeInteger(cents)) {
    throw new Error("montant_unsafe");
  }

  return cents;
}

export function parseMontantEurosInput(raw: string): string {
  return raw.trim().replace(",", ".");
}

export const uuidSchema = z.string().uuid("Identifiant invalide.");

export const clientPayeurSchema = z.object({
  nom: z
    .string()
    .transform(normalizeSpaces)
    .pipe(
      z
        .string()
        .min(1, "Indiquez le nom du client.")
        .max(200, "Le nom est trop long."),
    ),
  email: z
    .string()
    .transform(canonicalizeEmailInput)
    .refine(isSidianEmail, "Adresse email invalide."),
  creationKey: uuidSchema,
});

export const clientPayeurUpdateSchema = clientPayeurSchema.omit({
  creationKey: true,
});

export const creanceDraftSchema = z.object({
  clientPayeurId: uuidSchema,
  creationKey: uuidSchema.optional(),
  montantEuros: z
    .string()
    .transform(parseMontantEurosInput)
    .pipe(
      z
        .string()
        .regex(MONTANT_EUROS_PATTERN, "Montant invalide.")
        .superRefine((value, ctx) => {
          try {
            eurosToCentsExact(value);
          } catch {
            ctx.addIssue({
              code: "custom",
              message:
                "Le montant doit être entre 0,01 € et 1 000 000,00 €.",
            });
          }
        }),
    ),
  devise: z
    .string()
    .trim()
    .pipe(z.literal("EUR", { error: "Seule la devise EUR est acceptée." })),
  dateEcheance: z
    .string()
    .trim()
    .pipe(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Date d'échéance invalide.")
        .refine((value) => {
          const [y, m, d] = value.split("-").map(Number);
          const date = new Date(Date.UTC(y, m - 1, d));
          return (
            date.getUTCFullYear() === y &&
            date.getUTCMonth() === m - 1 &&
            date.getUTCDate() === d &&
            y >= 2000 &&
            y <= 2100
          );
        }, "Date d'échéance invalide."),
    ),
  libelle: z.string().transform(normalizeSpaces).pipe(z.string().max(200)),
  referenceExterne: z
    .string()
    .transform(normalizeSpaces)
    .pipe(z.string().max(200)),
});

export const creanceCreateSchema = creanceDraftSchema.extend({
  creationKey: uuidSchema,
});

export type ClientPayeurInput = z.infer<typeof clientPayeurSchema>;
export type CreanceDraftInput = z.infer<typeof creanceDraftSchema>;

/** @deprecated utiliser eurosToCentsExact */
export function eurosToCents(montantEuros: string): number {
  return eurosToCentsExact(parseMontantEurosInput(montantEuros));
}

export type FieldErrors = Record<string, string[]>;

export function formatZodFieldErrors(error: z.ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {};

  for (const issue of error.issues) {
    const key = issue.path[0];

    if (typeof key !== "string") {
      continue;
    }

    fieldErrors[key] ??= [];
    fieldErrors[key].push(issue.message);
  }

  return fieldErrors;
}
