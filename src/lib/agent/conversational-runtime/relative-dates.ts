/**
 * G1-N — résolution de dates relatives avec date de référence explicite.
 * Date ambiguë → ambiguïté (question utilisateur), jamais d’invention.
 */

import type { OpenAmbiguity } from "@/lib/agent/protection-draft";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toReferenceDate(referenceNowIso: string): string {
  const d = new Date(referenceNowIso);
  if (Number.isNaN(d.getTime())) {
    const fallback = new Date();
    return `${fallback.getUTCFullYear()}-${pad2(fallback.getUTCMonth() + 1)}-${pad2(fallback.getUTCDate())}`;
  }
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function endOfMonth(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m!, 0));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export type RelativeDateResolution =
  | { ok: true; iso: string }
  | { ok: false; ambiguity: OpenAmbiguity };

/**
 * Résout une expression relative FR courante.
 * Expressions non reconnues / ambiguës → question utilisateur.
 */
export function resolveRelativeDate(
  expression: string,
  referenceDate: string,
): RelativeDateResolution {
  const t = expression.trim().toLowerCase().replace(/\s+/g, " ");

  if (/^20\d{2}-\d{2}-\d{2}$/.test(t)) {
    return { ok: true, iso: t };
  }

  const inDaysMatch = t.match(/(?:dans|d['’]ici)\s+(\d+)\s+jours?/);
  if (inDaysMatch) {
    return { ok: true, iso: addDays(referenceDate, Number(inDaysMatch[1])) };
  }

  if (/^(aujourd['’]hui|today)$/.test(t)) {
    return { ok: true, iso: referenceDate };
  }

  if (/^(demain|tomorrow)$/.test(t)) {
    return { ok: true, iso: addDays(referenceDate, 1) };
  }

  if (/fin\s+du\s+mois|fin\s+de\s+mois/.test(t)) {
    return { ok: true, iso: endOfMonth(referenceDate) };
  }

  if (
    /bient[oô]t|plus\s+tard|quand\s+il|asap|dès\s+que|des\s+que|à\s+définir|a\s+definir/.test(
      t,
    )
  ) {
    return {
      ok: false,
      ambiguity: {
        kind: "due_date",
        message:
          "Date d’échéance ambiguë — précisez une date (AAAA-MM-JJ) ou un délai clair (ex. dans 15 jours).",
      },
    };
  }

  return {
    ok: false,
    ambiguity: {
      kind: "due_date",
      message: `Date non résolue (« ${expression.slice(0, 80)} ») — précisez AAAA-MM-JJ (réf. ${referenceDate}).`,
    },
  };
}
