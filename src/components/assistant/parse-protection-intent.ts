/**
 * Extraction légère d’une intention protection depuis un message libre (démo UI).
 * Pas de règle métier backend — uniquement pour préremplir le parcours conversationnel.
 */

const MONTHS =
  "janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre";

export type ParsedProtectionIntent = {
  clientName?: string;
  amountLabel?: string;
  dueDateLabel?: string;
};

function formatAmount(raw: string): string {
  const normalized = raw.replace(",", ".").replace(/\s/g, "");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return `${raw} €`;
  return `${new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2,
  }).format(value)} €`;
}

export function parseProtectionIntent(text: string): ParsedProtectionIntent | null {
  const source = text.trim();
  if (source.length < 8) return null;

  const lower = source.toLocaleLowerCase("fr");
  const looksLikeIntent =
    lower.includes("client") ||
    lower.includes("facture") ||
    lower.includes("protection") ||
    lower.includes("montant") ||
    lower.includes("échéance") ||
    lower.includes("echeance");

  if (!looksLikeIntent) return null;

  const result: ParsedProtectionIntent = {};

  const named =
    source.match(
      /(?:se\s+nomme|nommé[e]?|appelé[e]?|s['’]appelle)\s+([A-Za-zÀ-ÿ][\wÀ-ÿ'-]*)/i,
    ) ??
    source.match(
      /nouveau\s+client(?:\s+qui)?(?:\s+se\s+nomme)?\s+([A-Za-zÀ-ÿ][\wÀ-ÿ'-]*)/i,
    );

  // « Thibault client Chiant » → le client est Thibault (avant « client »).
  const personBeforeClient = source.match(
    /(?:^|[\s,;:!?])([A-Za-zÀ-ÿ][\wÀ-ÿ'-]*(?:\s+[A-Za-zÀ-ÿ][\wÀ-ÿ'-]*){0,2})\s+client\b/i,
  );

  const afterClient =
    named || personBeforeClient
      ? null
      : source.match(
          /client\s+(?:qui\s+)?(?:se\s+nomme\s+)?([A-Za-zÀ-ÿ][\wÀ-ÿ'-]*)/i,
        );

  const stopword =
    /^(qui|avec|pour|de|du|une|un|la|le|les|des|mon|ma|mes|nouveau|nouvelle|j['’]ai|jai)$/i;

  function normalizePersonName(raw: string): string | null {
    const parts = raw
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length === 0) return null;
    if (parts.some((part) => stopword.test(part))) {
      return null;
    }
    return parts
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  const rawName =
    named?.[1] ?? personBeforeClient?.[1] ?? afterClient?.[1] ?? null;
  if (rawName) {
    const name = normalizePersonName(rawName);
    if (name) result.clientName = name;
  }

  const amount =
    source.match(
      /(?:facture|montant|pour)\s+(?:de\s+)?(\d+(?:[.,]\d+)?)\s*€?/i,
    ) ?? source.match(/\b(\d+(?:[.,]\d+)?)\s*€/);

  if (amount?.[1]) {
    result.amountLabel = formatAmount(amount[1]);
  }

  const date =
    source.match(
      new RegExp(
        `(?:date|échéance|echeance)\\s+(?:au|le|pour)?\\s*(\\d{1,2}\\s+(?:${MONTHS})(?:\\s+\\d{4})?)`,
        "i",
      ),
    ) ??
    source.match(
      new RegExp(`\\bau\\s+(\\d{1,2}\\s+(?:${MONTHS})(?:\\s+\\d{4})?)`, "i"),
    ) ??
    source.match(
      new RegExp(`\\ble\\s+(\\d{1,2}\\s+(?:${MONTHS})(?:\\s+\\d{4})?)`, "i"),
    );

  if (date?.[1]) {
    result.dueDateLabel = date[1]
      .trim()
      .replace(
        new RegExp(`\\b(${MONTHS})\\b`, "i"),
        (match) => match.toLocaleLowerCase("fr"),
      );
  }

  if (!result.clientName && !result.amountLabel && !result.dueDateLabel) {
    return null;
  }

  return result;
}

export function countParsedFields(intent: ParsedProtectionIntent): number {
  return [intent.clientName, intent.amountLabel, intent.dueDateLabel].filter(
    Boolean,
  ).length;
}
