/**
 * Adaptateurs UI pour protection.draft.converse / confirm.
 * Mapping présentation uniquement — délègue au mapper panneau (pas de règles métier).
 */

import {
  mapConfirmOutputToPanel,
  mapDraftOutputToPanel,
  type ProtectionDraftConfirmOutput,
  type ProtectionDraftToolOutput,
} from "./protection-panel";
import type {
  ActiveContextData,
  AssistantMessage,
  AssistantMessageAction,
  ProtectionContextData,
} from "./types";

export type ConverseToolOutput = ProtectionDraftToolOutput & {
  summary: string;
};

export type ConfirmToolOutput = ProtectionDraftConfirmOutput & {
  state: "TERMINE";
};

const READY_STATES = new Set([
  "BROUILLON_COMPLET",
  "RECAPITULATIF",
  "CONFIRMATION_EXPLICITE",
]);

export function isDraftReadyForConfirm(output: ConverseToolOutput): boolean {
  return (
    Boolean(output.confirmation_nonce) &&
    (READY_STATES.has(output.state) || output.missing_fields.length === 0)
  );
}

export function buildProtectionContextFromConverse(
  output: ConverseToolOutput,
): ProtectionContextData {
  const ready = isDraftReadyForConfirm(output);
  const panel = mapDraftOutputToPanel(output, {
    statusOverride: ready ? "analyzing" : undefined,
  });

  if (ready) {
    return {
      ...panel,
      statusLabel: "Prêt à confirmer",
      status: "draft",
      nextStepLabel: "Confirmation explicite",
      primaryActionLabel: "Confirmer et créer",
    };
  }

  return panel;
}

export function buildActiveContextFromConverse(
  output: ConverseToolOutput,
): ActiveContextData {
  return {
    id: `ctx-draft-${output.draft_id}`,
    type: "protection_draft",
    protection: buildProtectionContextFromConverse(output),
  };
}

export function buildAssistantMessageFromConverse(params: {
  messageId: string;
  output: ConverseToolOutput;
}): AssistantMessage {
  const { messageId, output } = params;
  const parts: string[] = [];

  if (output.pending_question?.trim()) {
    parts.push(output.pending_question.trim());
  } else if (output.summary?.trim()) {
    parts.push(output.summary.trim());
  } else {
    parts.push("J’ai noté ta demande.");
  }

  if (
    isDraftReadyForConfirm(output) &&
    output.summary?.trim() &&
    output.pending_question?.trim()
  ) {
    parts.push(output.summary.trim());
  }

  if (
    isDraftReadyForConfirm(output) &&
    !parts.some((part) => /confirm/i.test(part))
  ) {
    parts.push(
      "Rien ne sera envoyé avant ta confirmation.",
    );
  }

  const suggestions: string[] = [];
  for (const ambiguity of output.open_ambiguities ?? []) {
    for (const candidate of ambiguity.candidates ?? []) {
      if (suggestions.length >= 3) break;
      if (!suggestions.includes(candidate)) {
        suggestions.push(candidate);
      }
    }
  }

  const actions: AssistantMessageAction[] = [];
  if (isDraftReadyForConfirm(output) && output.confirmation_nonce) {
    actions.push({
      id: "confirm-protection",
      label: "Confirmer la protection",
      kind: "confirm_protection",
    });
    actions.push({
      id: "edit-protection",
      label: "Modifier",
      kind: "edit_protection",
    });
  }

  const protection = buildProtectionContextFromConverse(output);
  const hasDetectedData =
    protection.clientName !== "À préciser" ||
    protection.amountLabel !== "À préciser" ||
    (protection.dueDateLabel !== undefined &&
      protection.dueDateLabel !== "À préciser");
  const card =
    hasDetectedData || isDraftReadyForConfirm(output)
      ? {
          kind: "protection_draft" as const,
          title: isDraftReadyForConfirm(output)
            ? "Vérifie les informations"
            : "Informations de la facture",
          subtitle: isDraftReadyForConfirm(output)
            ? "La protection sera créée uniquement après ta confirmation."
            : "Les informations manquantes restent à compléter.",
          statusLabel: protection.statusLabel,
          meta: [
            { label: "Client", value: protection.clientName },
            { label: "Montant", value: protection.amountLabel },
            {
              label: "Échéance",
              value: protection.dueDateLabel ?? "À préciser",
            },
          ],
        }
      : undefined;

  return {
    id: messageId,
    role: "assistant",
    content: parts.join("\n\n"),
    suggestions: suggestions.length > 0 ? suggestions : undefined,
    actions: actions.length > 0 ? actions : undefined,
    card,
    status: "sent",
  };
}

export function buildAssistantMessageFromConfirm(params: {
  messageId: string;
  output: ConfirmToolOutput;
  protection?: ProtectionContextData | null;
}): AssistantMessage {
  const { messageId, output, protection } = params;
  const name = protection?.clientName?.trim() || "ton client";
  return {
    id: messageId,
    role: "assistant",
    content:
      output.outcome === "replay"
        ? `La protection ${name} était déjà créée.`
        : `C’est fait, la protection ${name} est créée.`,
    card: {
      kind: "protection",
      title: "Protection créée",
      subtitle: "Sidian suivra le règlement à l’échéance.",
      statusLabel: "Active",
      meta: [
        { label: "Client", value: name },
        { label: "Montant", value: protection?.amountLabel ?? "À préciser" },
        {
          label: "Échéance",
          value: protection?.dueDateLabel ?? "À préciser",
        },
      ],
    },
    status: "sent",
    actions: [
      {
        id: "open-protection",
        label: "Voir la protection",
        kind: "open_protection",
        href: `/app/paiements-a-recevoir/${output.creance_id}`,
      },
    ],
    protectionId: output.creance_id,
  };
}

export function buildActiveContextFromConfirm(params: {
  output: ConfirmToolOutput;
  previous?: ProtectionContextData | null;
}): ActiveContextData {
  const previous = params.previous ?? {
    clientName: "Client",
    statusLabel: "Brouillon",
    status: "draft" as const,
    amountLabel: "—",
  };

  const panel = mapConfirmOutputToPanel(params.output, previous);

  return {
    id: `ctx-protection-${params.output.creance_id}`,
    type: "protection",
    protection: panel,
  };
}

export function asConverseOutput(
  value: Record<string, unknown>,
): ConverseToolOutput | null {
  if (typeof value.draft_id !== "string" || !value.draft_id) return null;
  if (typeof value.state !== "string") return null;
  if (typeof value.summary !== "string") return null;
  if (!value.recap || typeof value.recap !== "object") return null;
  const recap = value.recap as Record<string, unknown>;
  return {
    draft_id: value.draft_id,
    state: value.state,
    missing_fields: Array.isArray(value.missing_fields)
      ? value.missing_fields.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    pending_question:
      typeof value.pending_question === "string" ? value.pending_question : null,
    open_ambiguities: Array.isArray(value.open_ambiguities)
      ? (value.open_ambiguities as ConverseToolOutput["open_ambiguities"])
      : [],
    recap: {
      client_name:
        typeof recap.client_name === "string" ? recap.client_name : null,
      client_email:
        typeof recap.client_email === "string" ? recap.client_email : null,
      expected_amount_minor:
        typeof recap.expected_amount_minor === "number"
          ? recap.expected_amount_minor
          : null,
      currency: typeof recap.currency === "string" ? recap.currency : null,
      due_date: typeof recap.due_date === "string" ? recap.due_date : null,
      libelle: typeof recap.libelle === "string" ? recap.libelle : null,
      reference_externe:
        typeof recap.reference_externe === "string"
          ? recap.reference_externe
          : null,
    },
    confirmation_nonce:
      typeof value.confirmation_nonce === "string"
        ? value.confirmation_nonce
        : null,
    summary: value.summary,
  };
}

export function asConfirmOutput(
  value: Record<string, unknown>,
): ConfirmToolOutput | null {
  if (typeof value.draft_id !== "string") return null;
  if (value.state !== "TERMINE") return null;
  if (value.outcome !== "created" && value.outcome !== "replay") return null;
  if (typeof value.client_payeur_id !== "string") return null;
  if (typeof value.creance_id !== "string") return null;
  return {
    outcome: value.outcome,
    draft_id: value.draft_id,
    state: "TERMINE",
    client_payeur_id: value.client_payeur_id,
    creance_id: value.creance_id,
  };
}
