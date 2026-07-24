/**
 * Règles de verdict G1-A — alignées sur docs/agent/09_AGENT_EVALUATIONS.md §1.2
 * avec garde anti faux-PASS (E-015).
 *
 * exact           → PASS ou FAIL
 * partial|analog|none → BLOCKED (même si bindings verts)
 * not_applicable  → NOT_APPLICABLE (justification obligatoire)
 * binding en échec → FAIL (preuve d’exécution cassée)
 */

export const VERDICTS = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  BLOCKED: "BLOCKED",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

/**
 * @param {{
 *   coverageKind: "exact" | "partial" | "analog" | "none" | "not_applicable",
 *   bindingResults: Array<{ ok: boolean, exit_code?: number, error?: string }>,
 *   naJustification?: string,
 * }} input
 */
export function decideVerdict(input) {
  const { coverageKind, bindingResults, naJustification } = input;

  if (coverageKind === "not_applicable") {
    if (!naJustification || !String(naJustification).trim()) {
      return {
        verdict: VERDICTS.FAIL,
        false_pass_guard: "na_without_justification",
        detail: "NOT_APPLICABLE exige coverage.na_justification non vide.",
      };
    }
    return {
      verdict: VERDICTS.NOT_APPLICABLE,
      false_pass_guard: null,
      detail: "Hors périmètre justifié.",
    };
  }

  const failedBindings = bindingResults.filter((b) => !b.ok);
  if (failedBindings.length > 0) {
    return {
      verdict: VERDICTS.FAIL,
      false_pass_guard: "binding_failed",
      detail: `${failedBindings.length} binding(s) en échec.`,
    };
  }

  if (coverageKind === "exact") {
    if (bindingResults.length === 0) {
      return {
        verdict: VERDICTS.FAIL,
        false_pass_guard: "exact_without_bindings",
        detail: "coverage.kind=exact exige au moins un binding exécutable.",
      };
    }
    return {
      verdict: VERDICTS.PASS,
      false_pass_guard: null,
      detail: "Couverture exacte et bindings verts.",
    };
  }

  if (
    coverageKind === "partial" ||
    coverageKind === "analog" ||
    coverageKind === "none"
  ) {
    return {
      verdict: VERDICTS.BLOCKED,
      false_pass_guard: `${coverageKind}_cannot_pass`,
      detail:
        coverageKind === "none"
          ? "Aucune preuve exécutable équivalente ; composant agent absent."
          : "Preuves existantes non équivalentes au scénario EVAL ; PASS interdit.",
    };
  }

  return {
    verdict: VERDICTS.FAIL,
    false_pass_guard: "unknown_coverage_kind",
    detail: `coverage.kind inconnu: ${coverageKind}`,
  };
}

export function summarizeVerdicts(entries) {
  const summary = {
    pass: 0,
    fail: 0,
    blocked: 0,
    not_applicable: 0,
  };
  for (const entry of entries) {
    switch (entry.verdict) {
      case VERDICTS.PASS:
        summary.pass += 1;
        break;
      case VERDICTS.FAIL:
        summary.fail += 1;
        break;
      case VERDICTS.BLOCKED:
        summary.blocked += 1;
        break;
      case VERDICTS.NOT_APPLICABLE:
        summary.not_applicable += 1;
        break;
      default:
        summary.fail += 1;
    }
  }
  return summary;
}
