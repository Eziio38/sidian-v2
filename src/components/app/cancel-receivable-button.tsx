"use client";

import { useActionState, useId } from "react";

import type { WorkflowActionResult } from "@/app/actions/receivable-workflows";

type WorkflowAction = (
  previous: WorkflowActionResult | undefined,
  formData: FormData,
) => Promise<WorkflowActionResult>;

export function CancelReceivableButton({
  receivableId,
  action,
}: {
  receivableId: string;
  action: WorkflowAction;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const id = useId();

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm("Annuler ce paiement à recevoir ? Cette action révoquera son lien actif.")) {
          event.preventDefault();
        }
      }}
      aria-describedby={state ? `${id}-status` : undefined}
    >
      <input type="hidden" name="receivableId" value={receivableId} />
      <button
        type="submit"
        disabled={pending}
        className="text-sm font-medium text-red-700 underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-600 disabled:opacity-60"
      >
        {pending ? "Annulation…" : "Annuler le paiement à recevoir"}
      </button>
      {state ? (
        <p
          id={`${id}-status`}
          role={state.ok ? "status" : "alert"}
          className={`mt-2 text-sm ${state.ok ? "text-emerald-700" : "text-red-600"}`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
