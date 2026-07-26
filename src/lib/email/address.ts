import { createHash } from "node:crypto";

import { EmailError } from "./errors";

/**
 * Aligné validation SQL / protection-draft — formé canonique lower(btrim(...)).
 */
const EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function canonicalizeEmailAddress(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (
    email.length === 0 ||
    email.length > 254 ||
    /\s/.test(email) ||
    !EMAIL_RE.test(email)
  ) {
    throw new EmailError("email_invalid");
  }
  return email;
}

export function hashEmailAddress(canonicalEmail: string): string {
  return createHash("sha256").update(canonicalEmail).digest("hex");
}

export function canonicalizeOptionalDisplayName(
  raw: string | undefined | null,
): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return undefined;
  return name.length > 200 ? name.slice(0, 200) : name;
}
