"use client";

import { useActionState, useId, useState } from "react";

import type { WorkflowActionResult } from "@/app/actions/receivable-workflows";
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
      <div className="space-y-1.5">
        <label htmlFor={`${id}-target`} className="block text-sm font-medium text-nuit">
          État du suivi
        </label>
        <select
          id={`${id}-target`}
          name="targetState"
          value={targetState}
          onChange={(event) => setTargetState(event.target.value as FollowUpState)}
          className="block min-h-10 w-full rounded-lg border border-gris-200 bg-white px-3 text-sm text-nuit focus-visible:outline focus-visible:outline-2 focus-visible:outline-sidian-blue"
        >
          {targets.map((state) => (
            <option key={state} value={state}>
              {LABELS[state]}
            </option>
          ))}
        </select>
      </div>
      {targetState !== "CLOS" ? (
        <div className="space-y-1.5">
          <label htmlFor={`${id}-date`} className="block text-sm font-medium text-nuit">
            Prochaine date d’action
          </label>
          <input
            id={`${id}-date`}
            type="date"
            name="nextActionDate"
            defaultValue={nextActionDate}
            className="block min-h-10 w-full rounded-lg border border-gris-200 bg-white px-3 text-sm text-nuit focus-visible:outline focus-visible:outline-2 focus-visible:outline-sidian-blue"
          />
        </div>
      ) : (
        <input type="hidden" name="nextActionDate" value="" />
      )}
      <div className="space-y-1.5">
        <label htmlFor={`${id}-reason`} className="block text-sm font-medium text-nuit">
          Motif {reasonRequired ? "requis" : "facultatif"}
        </label>
        <textarea
          id={`${id}-reason`}
          name="escalationReason"
          defaultValue={followUp.escalationReason ?? ""}
          required={reasonRequired}
          maxLength={500}
          rows={3}
          className="block w-full resize-y rounded-lg border border-gris-200 bg-white px-3 py-2 text-sm text-nuit focus-visible:outline focus-visible:outline-2 focus-visible:outline-sidian-blue"
        />
      </div>
      <button
        type="submit"
        disabled={updatePending}
        className="inline-flex min-h-10 items-center justify-center rounded-lg bg-sidian-blue px-4 text-sm font-medium text-white transition-colors hover:bg-[#315fd9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue disabled:opacity-60"
      >
        {updatePending ? "Enregistrement…" : "Mettre à jour le suivi"}
      </button>
      <ActionMessage state={updateState} id={`${id}-update-status`} />
    </form>
  );
}
