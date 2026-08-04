"use client";

import { useActionState, useId } from "react";

import { ConfirmIrreversible } from "@/components/feedback";
import { UX_COPY } from "@/lib/ux/microcopy";
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
  const copy = UX_COPY.irreversibleCancelPayment;

  return (
    <div aria-describedby={state ? `${id}-status` : undefined}>
      <ConfirmIrreversible
        title={copy.title}
        description={copy.description}
        confirmLabel={pending ? "Annulation…" : "Annuler le paiement à recevoir"}
        useNativeConfirm
        formAction={formAction}
        pending={pending}
        formChildren={
          <input type="hidden" name="receivableId" value={receivableId} />
        }
      />
      {state ? (
        <p
          id={`${id}-status`}
          role={state.ok ? "status" : "alert"}
          className={`mt-2 text-sm ${state.ok ? "text-emerald-700" : "text-red-600"}`}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
