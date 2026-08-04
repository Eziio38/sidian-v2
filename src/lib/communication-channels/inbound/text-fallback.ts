import type { CommunicationActionKey } from "./actions";

/**
 * Fallback textuel strict — pas de similarité floue, pas de LLM.
 * Accepte uniquement des formes exactes normalisées.
 */
export function normalizeActionText(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[.!?…]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const EXACT_MAP: Readonly<Record<string, CommunicationActionKey>> = {
  oui: "payment_received_yes",
  non: "payment_received_no",
  "paiement partiel": "payment_received_partial",
  partiel: "payment_received_partial",
  "je verifie": "payment_received_checking",
};

/**
 * Mappe un texte libre vers une action, ou null si ambigu.
 * « oui merci » / « je crois que oui » → null (fail closed).
 */
export function mapExactTextToAction(
  raw: string,
): CommunicationActionKey | null {
  const normalized = normalizeActionText(raw);
  return EXACT_MAP[normalized] ?? null;
}
