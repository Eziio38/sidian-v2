import {
  AUTOMATIC_EXECUTION_GUARD_VERSION,
  PAYMENT_RUNTIME_CURRENCY,
} from "./constants";
import type {
  AutomaticPaymentChecklistInput,
  ChecklistGateResult,
  ChecklistResult,
} from "./types";

function fail(
  gates: ChecklistGateResult[],
  gate: ChecklistGateResult,
): ChecklistResult {
  gates.push(gate);
  return {
    ok: false,
    gates,
    code: gate.code!,
    detail: gate.detail ?? gate.code!,
  };
}

/**
 * Checklist déterministe 03 §4 — jamais déléguée au modèle.
 * Fail-closed : toute porte incomplete refuse le mouvement d'argent.
 */
export function evaluateAutomaticPaymentChecklist(
  input: AutomaticPaymentChecklistInput,
): ChecklistResult {
  const gates: ChecklistGateResult[] = [];

  if (!input.paymentsEnabled) {
    return fail(gates, {
      gate: "payments_enabled",
      ok: false,
      code: "PAYMENTS_DISABLED",
      detail: "NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED is not true",
    });
  }
  gates.push({ gate: "payments_enabled", ok: true });

  if (input.guardVersion !== AUTOMATIC_EXECUTION_GUARD_VERSION) {
    return fail(gates, {
      gate: "guard_version",
      ok: false,
      code: "CHECKLIST_INCOMPLETE",
      detail: "automatic_execution_guard_version mismatch",
    });
  }
  gates.push({ gate: "guard_version", ok: true });

  const { creance } = input;
  if (
    creance.archivedAt !== null ||
    (creance.etat !== "OUVERTE" && creance.etat !== "PARTIELLEMENT_REGLEE")
  ) {
    return fail(gates, {
      gate: "creance_state",
      ok: false,
      code: "INVALID_CREANCE_STATE",
      detail: `creance.etat=${creance.etat}`,
    });
  }
  gates.push({ gate: "creance_state", ok: true });

  if (
    creance.devise !== PAYMENT_RUNTIME_CURRENCY ||
    input.requestedCurrency !== PAYMENT_RUNTIME_CURRENCY
  ) {
    return fail(gates, {
      gate: "currency",
      ok: false,
      code: "UNSUPPORTED_CURRENCY",
      detail: `devise=${creance.devise} requested=${input.requestedCurrency}`,
    });
  }
  gates.push({ gate: "currency", ok: true });

  if (
    !Number.isSafeInteger(input.requestedAmountCents) ||
    input.requestedAmountCents <= 0 ||
    input.requestedAmountCents > creance.remainingCents
  ) {
    return fail(gates, {
      gate: "remaining_balance",
      ok: false,
      code: "AMOUNT_EXCEEDS_REMAINING",
      detail: `requested=${input.requestedAmountCents} remaining=${creance.remainingCents}`,
    });
  }
  gates.push({ gate: "remaining_balance", ok: true });

  // L'agent / scanner doit viser le solde restant exact au MVP (pas de partial inventé).
  if (input.requestedAmountCents !== creance.remainingCents) {
    return fail(gates, {
      gate: "amount_match",
      ok: false,
      code: "AMOUNT_MISMATCH",
      detail: "requested amount must equal remaining balance",
    });
  }
  gates.push({ gate: "amount_match", ok: true });

  if (input.activeAttempt) {
    return fail(gates, {
      gate: "no_active_attempt",
      ok: false,
      code: "ACTIVE_ATTEMPT_EXISTS",
      detail: `active_attempt=${input.activeAttempt.id}`,
    });
  }
  gates.push({ gate: "no_active_attempt", ok: true });

  const dossierEtat = input.dossier?.etat ?? null;
  if (
    dossierEtat === "PAUSE_LITIGE" ||
    dossierEtat === "ESCALADE_HUMAINE"
  ) {
    return fail(gates, {
      gate: "followup_state",
      ok: false,
      code: "FOLLOWUP_BLOCKED",
      detail: `dossier_suivi.etat=${dossierEtat}`,
    });
  }
  gates.push({ gate: "followup_state", ok: true });

  const auth = input.authorization;
  if (
    !auth ||
    auth.etat !== "ACTIVE" ||
    auth.isDefault !== true ||
    auth.legacyIncomplete !== false ||
    !auth.stripeAccountId ||
    !auth.stripeCustomerId ||
    !auth.stripePaymentMethodId ||
    !auth.acceptedAt ||
    !auth.authorizedAt ||
    !auth.authorizationTextVersion ||
    !auth.authorizationChannel ||
    auth.prestataireId !== creance.prestataireId ||
    auth.clientPayeurId !== creance.clientPayeurId
  ) {
    return fail(gates, {
      gate: "authorization",
      ok: false,
      code: "AUTHORIZATION_INELIGIBLE",
      detail: "default ACTIVE authorization with complete snapshots required",
    });
  }
  gates.push({ gate: "authorization", ok: true });
  gates.push({ gate: "scope", ok: true });

  if (auth.type === "sepa_core_mandate") {
    return fail(gates, {
      gate: "sepa_closed",
      ok: false,
      code: "SEPA_PRENOTIFICATION_REQUIRED",
      detail: "SEPA off-session closed until prenotification validated",
    });
  }
  if (auth.type !== "card_off_session") {
    return fail(gates, {
      gate: "sepa_closed",
      ok: false,
      code: "AUTHORIZATION_INELIGIBLE",
      detail: `unsupported authorization type=${auth.type}`,
    });
  }
  gates.push({ gate: "sepa_closed", ok: true });

  const connect = input.connect;
  if (
    !connect ||
    connect.stripeAccountId !== auth.stripeAccountId ||
    !connect.chargesEnabled ||
    connect.restricted ||
    !connect.cardPaymentsActive
  ) {
    return fail(gates, {
      gate: "connect_payable",
      ok: false,
      code: "CONNECT_NOT_PAYABLE",
      detail: "live Connect card rail not eligible",
    });
  }
  gates.push({ gate: "connect_payable", ok: true });

  // Produit : aucun parametre regle dédié au plafond auto-débit → fail-closed.
  if (
    !input.productAutoDebitRulesReady ||
    input.autoDebitCeilingCents === null ||
    !Number.isSafeInteger(input.autoDebitCeilingCents) ||
    input.autoDebitCeilingCents <= 0 ||
    input.requestedAmountCents > input.autoDebitCeilingCents
  ) {
    return fail(gates, {
      gate: "regle_ceiling",
      ok: false,
      code: "REGLE_AUTO_DEBIT_CEILING_UNDEFINED",
      detail:
        "auto-debit ceiling rule product incomplete — refusing money movement",
    });
  }
  gates.push({ gate: "regle_ceiling", ok: true });

  return {
    ok: true,
    gates,
    authorizationId: auth.id,
    stripeAccountId: auth.stripeAccountId,
    stripeCustomerId: auth.stripeCustomerId,
    stripePaymentMethodId: auth.stripePaymentMethodId,
    amountCents: input.requestedAmountCents,
    remainingCents: creance.remainingCents,
  };
}
