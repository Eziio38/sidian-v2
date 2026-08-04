/**
 * Résumé d’accueil — présentation UI uniquement (montants déjà calculés côté serveur).
 */

export type WelcomeDataState =
  | "none_due"
  | "due_calm"
  | "needs_attention"
  | "first_use"
  | "load_error";

export type WelcomeSummaryInput = {
  todayOutstandingCents: number;
  todayCount: number;
  overdueCount: number;
  attentionCount: number;
  /** Compte sans historique / premier usage. */
  isFirstUse?: boolean;
  /** Échec de chargement du dashboard. */
  loadError?: boolean;
};

export type WelcomeSituationCopy = {
  headline: string;
  detail: string | null;
};

export type WelcomeBriefLike = {
  id: string;
  label: string;
  value: string;
  hint?: string;
};

function formatEuroFromCents(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function resolveWelcomeDataState(
  input: WelcomeSummaryInput,
): WelcomeDataState {
  if (input.loadError) return "load_error";
  if (input.isFirstUse) return "first_use";
  const interventionNeeded = input.overdueCount + input.attentionCount;
  if (interventionNeeded > 0) return "needs_attention";
  if (input.todayCount > 0) return "due_calm";
  return "none_due";
}

export function welcomeSituationHeadline(
  dataState: WelcomeDataState,
): string {
  switch (dataState) {
    case "needs_attention":
      return "Votre attention est requise.";
    case "load_error":
      return "Je n’ai pas pu charger votre activité.";
    case "first_use":
      return "Sécurisons votre prochain règlement.";
    case "none_due":
      return "Rien ne nécessite votre intervention.";
    case "due_calm":
    default:
      return "Tout est sous contrôle.";
  }
}

/**
 * Produit 1–2 lignes utiles pour l’empty state (pas de widgets).
 */
export function buildWelcomeSummaryLines(
  input: WelcomeSummaryInput,
): string[] {
  const state = resolveWelcomeDataState(input);

  switch (state) {
    case "load_error":
      return ["Vous pouvez quand même démarrer une protection."];
    case "first_use":
      return ["Créez une protection pour verrouiller le prochain paiement."];
    case "needs_attention": {
      const interventionNeeded = input.overdueCount + input.attentionCount;
      if (input.todayCount > 0) {
        const amount = formatEuroFromCents(
          Math.max(0, input.todayOutstandingCents),
        );
        const due =
          input.todayCount === 1
            ? `${amount} arrive aujourd’hui.`
            : `${input.todayCount} échéances arrivent aujourd’hui.`;
        const attention =
          interventionNeeded === 1
            ? "1 point nécessite votre attention."
            : `${interventionNeeded} points nécessitent votre attention.`;
        return [`${due} ${attention}`];
      }
      return [
        interventionNeeded === 1
          ? "Une échéance nécessite votre attention."
          : `${interventionNeeded} échéances nécessitent votre attention.`,
      ];
    }
    case "due_calm": {
      const count = Math.max(1, input.todayCount);
      const followed =
        count === 1
          ? "1 paiement sera suivi cette semaine."
          : `${count} paiements seront suivis cette semaine.`;
      return [`${followed} Aucune action urgente.`];
    }
    case "none_due":
    default:
      return ["Sidian continue de surveiller vos échéances."];
  }
}

/**
 * Phrase contextuelle sous le salut — headline + détail (max 2 lignes).
 * Enrichit le détail avec les brief cards quand elles apportent un signal réel.
 */
export function buildWelcomeSituationCopy(params: {
  dataState: WelcomeDataState;
  summaryLines: string[];
  briefCards?: WelcomeBriefLike[];
}): WelcomeSituationCopy {
  const headline = welcomeSituationHeadline(params.dataState);
  const fromSummary = params.summaryLines
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");

  const cards = params.briefCards ?? [];
  const expected = cards.find((card) => card.id === "expected");
  const active = cards.find((card) => card.id === "active");
  const next = cards.find((card) => card.id === "next");

  const expectedHint = expected?.hint?.trim() ?? "";
  const paymentFollowed = expectedHint.match(/(\d+)\s*paiement/i);
  const activeValue = (active?.value ?? "").trim();
  const hasAction =
    activeValue !== "" &&
    activeValue !== "0" &&
    activeValue !== "—" &&
    !/^rien$/i.test(activeValue);
  const nextValue = (next?.value ?? "").trim();
  const hasNext =
    nextValue !== "" &&
    nextValue !== "Aucun" &&
    nextValue !== "—" &&
    nextValue !== "0";

  if (params.dataState === "due_calm" && paymentFollowed) {
    const count = Number(paymentFollowed[1]);
    const followed =
      count <= 1
        ? "1 paiement sera suivi cette semaine."
        : `${count} paiements seront suivis cette semaine.`;
    return {
      headline,
      detail: hasAction
        ? `${followed} Une action reste ouverte.`
        : `${followed} Aucune action urgente.`,
    };
  }

  if (params.dataState === "needs_attention" && hasNext) {
    return {
      headline,
      detail: fromSummary || `Prochain point : ${nextValue}.`,
    };
  }

  if (params.dataState === "none_due") {
    return {
      headline,
      detail: fromSummary || "Sidian continue de surveiller vos échéances.",
    };
  }

  return {
    headline,
    detail: fromSummary || null,
  };
}

export const FALLBACK_WELCOME_SUMMARY = [
  "3 paiements seront suivis cette semaine. Aucune action urgente.",
] as const;

/** Résumés de démo pour les 5 états data (empty state). */
export const DEMO_WELCOME_BY_STATE: Record<WelcomeDataState, string[]> = {
  none_due: ["Sidian continue de surveiller vos échéances."],
  due_calm: [
    "3 paiements seront suivis cette semaine. Aucune action urgente.",
  ],
  needs_attention: ["Deux échéances arrivent aujourd’hui."],
  first_use: [
    "Créez une protection pour verrouiller le prochain paiement.",
  ],
  load_error: ["Vous pouvez quand même démarrer une protection."],
};
