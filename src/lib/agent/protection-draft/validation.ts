/**
 * G1-M — validation email / montant / échéance (déterministe).
 */

import {
  eurosToCentsExact,
  MONTANT_CENTS_MAX,
  MONTANT_CENTS_MIN,
  parseMontantEurosInput,
} from "@/lib/clients/schemas";

import { ProtectionDraftError } from "./errors";

const EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function canonicalizeDraftEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (
    email.length === 0 ||
    email.length > 254 ||
    /\s/.test(email) ||
    !EMAIL_RE.test(email)
  ) {
    throw new ProtectionDraftError("PROTECTION_DRAFT_VALIDATION_FAILED", {
      message: "email_invalid",
    });
  }
  return email;
}

export function normalizeClientName(raw: string): string {
  const nom = raw.trim().replace(/\s+/g, " ");
  if (nom.length === 0) {
    throw new ProtectionDraftError("PROTECTION_DRAFT_VALIDATION_FAILED", {
      message: "nom_required",
    });
  }
  return nom.length > 200 ? nom.slice(0, 200) : nom;
}

/** Montant déjà en unités mineures (centimes). */
export function validateAmountMinor(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < MONTANT_CENTS_MIN ||
    value > MONTANT_CENTS_MAX
  ) {
    throw new ProtectionDraftError("PROTECTION_DRAFT_VALIDATION_FAILED", {
      message: "montant_invalid",
    });
  }
  return value;
}

/** Parse une chaîne montant euros → centimes. */
export function parseAmountEurosToMinor(raw: string): number {
  try {
    return eurosToCentsExact(parseMontantEurosInput(raw));
  } catch {
    throw new ProtectionDraftError("PROTECTION_DRAFT_VALIDATION_FAILED", {
      message: "montant_invalid",
    });
  }
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function validateIsoDate(raw: string): string {
  const m = ISO_DATE_RE.exec(raw.trim());
  if (!m) {
    throw new ProtectionDraftError("PROTECTION_DRAFT_VALIDATION_FAILED", {
      message: "date_echeance_invalid",
    });
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new ProtectionDraftError("PROTECTION_DRAFT_VALIDATION_FAILED", {
      message: "date_echeance_invalid",
    });
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    throw new ProtectionDraftError("PROTECTION_DRAFT_VALIDATION_FAILED", {
      message: "date_echeance_invalid",
    });
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function validateCurrency(raw: string): "EUR" {
  const c = raw.trim().toUpperCase();
  if (c !== "EUR") {
    throw new ProtectionDraftError("PROTECTION_DRAFT_VALIDATION_FAILED", {
      message: "devise_unsupported",
    });
  }
  return "EUR";
}
