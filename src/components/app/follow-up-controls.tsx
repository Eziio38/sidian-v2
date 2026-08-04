"use client";

import { useActionState, useId, useState } from "react";

import type { WorkflowActionResult } from "@/app/actions/receivable-workflows";
import { Input, Select, Textarea } from "@/design-system";
import { allowedFollowUpTargets } from "@/lib/workflows/transitions";
import type { Database } from "@/types/database.generated";

type FollowUpState = Database["public"]["Enums"]["dossier_suivi_etat"];
type ReceivableState = Database["public"]["Enums"]["creance_etat"];

const LABELS: Record<FollowUpState, string> = {
  PREVENTION: "Prévention",
  ECHEANCE: "Échéance",
  SUIVI_AMIABLE: "Suivi amiable",
  PAUSE_LITIGE: "Pause pour litige",
  ATTENTE_CLIENT: "Attente du client",
  ATTENTE_PRESTATAIRE: "Votre réponse est attendue",
  ESCALADE_HUMAINE: "Examen humain",
  CLOS: "Clos",
};

type WorkflowAction = (
  previous: WorkflowActionResult | undefined,
  formData: FormData,
) => Promise<WorkflowActionResult>;

function ActionMessage({ state, id }: { state?: WorkflowActionResult; id: string }) {
  if (!state) return null;
  return (
    <p
      id={id}
      role={state.ok ? "status" : "alert"}
      className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-600"}`}
    >
      {state.message}
    </p>
  );
}

export function FollowUpControls({
  receivableId,
  receivableState,
  followUp,
  ensureAction,
  updateAction,
}: {
  receivableId: string;
  receivableState: ReceivableState;
  followUp: {
    state: FollowUpState;
    nextActionAt: string | null;
    escalationReason: string | null;
  } | null;
  ensureAction: WorkflowAction;
  updateAction: WorkflowAction;
}) {
  const id = useId();
  const [ensureState, ensureFormAction, ensurePending] = useActionState(
    ensureAction,
    undefined,
  );
  const [updateState, updateFormAction, updatePending] = useActionState(
    updateAction,
    undefined,
  );
  const initialTarget = followUp
    ? (allowedFollowUpTargets(followUp.state, receivableState)[0] ??
      followUp.state)
    : "PREVENTION";
  const [targetState, setTargetState] = useState<FollowUpState>(initialTarget);

  if (!followUp) {
    return (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-gris-500">
          Créez un dossier relationnel distinct de l’état financier pour suivre
          la prochaine étape sans modifier le solde.
        </p>
        <form action={ensureFormAction} aria-describedby={ensureState ? `${id}-ensure-status` : undefined}>
          <input type="hidden" name="receivableId" value={receivableId} />
          <button
            type="submit"
            disabled={ensurePending}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-gris-200 px-4 text-sm font-medium text-nuit transition-colors hover:border-sidian-blue hover:text-sidian-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue disabled:opacity-60"
          >
            {ensurePending ? "Création…" : "Créer le dossier"}
          </button>
        </form>
        <ActionMessage state={ensureState} id={`${id}-ensure-status`} />
      </div>
    );
  }

  const targets = allowedFollowUpTargets(followUp.state, receivableState);
  if (targets.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-gris-500">
        Ce dossier est clos. Son historique reste consultable.
      </p>
    );
  }

  const reasonRequired =
    targetState === "PAUSE_LITIGE" || targetState === "ESCALADE_HUMAINE";
  // Les champs du design system câblent aria-invalid + aria-describedby +
  // role="alert" dès qu'une erreur leur est passée : il suffit de la router.
  const fieldError = (name: string) =>
    updateState?.ok === false
      ? updateState.fieldErrors?.[name]?.[0]
      : undefined;
  const nextActionDate = followUp.nextActionAt
    ? followUp.nextActionAt.slice(0, 10)
    : "";

  return (
    <form
      action={updateFormAction}
      className="space-y-4"
      aria-describedby={updateState ? `${id}-update-status` : undefined}
    >
      <input type="hidden" name="receivableId" value={receivableId} />
      <Select
        id={`${id}-target`}
        name="targetState"
        label="État du suivi"
        value={targetState}
        onChange={(event) => setTargetState(event.target.value as FollowUpState)}
        error={fieldError("targetState")}
      >
        {targets.map((state) => (
          <option key={state} value={state}>
            {LABELS[state]}
          </option>
        ))}
      </Select>
      {targetState !== "CLOS" ? (
        <Input
          id={`${id}-date`}
          type="date"
          name="nextActionDate"
          label="Prochaine date d’action"
          defaultValue={nextActionDate}
          error={fieldError("nextActionDate")}
        />
      ) : (
        <input type="hidden" name="nextActionDate" value="" />
      )}
      <Textarea
        id={`${id}-reason`}
        name="escalationReason"
        label={`Motif ${reasonRequired ? "requis" : "facultatif"}`}
        defaultValue={followUp.escalationReason ?? ""}
        required={reasonRequired}
        maxLength={500}
        rows={3}
        error={fieldError("escalationReason")}
      />
      <button
        type="submit"
        disabled={updatePending}
        className="inline-flex min-h-10 items-center justify-center rounded-lg bg-sidian-blue px-4 text-sm font-medium text-white transition-colors hover:bg-sidian-blue-hover active:bg-sidian-blue-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue disabled:opacity-60"
      >
        {updatePending ? "Enregistrement…" : "Mettre à jour le suivi"}
      </button>
      <ActionMessage state={updateState} id={`${id}-update-status`} />
    </form>
  );
}
