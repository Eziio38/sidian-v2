"use client";

import { useActionState, useId } from "react";

import type { PaymentReconciliationActionResult } from "@/app/actions/payment-reconciliation";

type ReconciliationAction = (
  previous: PaymentReconciliationActionResult | undefined,
  formData: FormData,
) => Promise<PaymentReconciliationActionResult>;

export function PaymentReconciliationButton({
  receivableId,
  action,
}: {
  receivableId: string;
  action: ReconciliationAction;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const statusId = useId();

  return (
    <form
      action={formAction}
      aria-describedby={state ? statusId : undefined}
    >
      <input type="hidden" name="receivableId" value={receivableId} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-gris-200 bg-white px-4 text-sm font-medium text-nuit transition-colors hover:border-sidian-blue hover:text-sidian-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Vérification Stripe…" : "Vérifier avec Stripe"}
      </button>
      {state ? (
        <p
          id={statusId}
          role={state.ok ? "status" : "alert"}
          className={`mt-2 text-sm leading-relaxed ${
            state.ok && state.status !== "human_required"
              ? "text-emerald-700"
              : state.ok
                ? "text-amber-700"
                : "text-red-700"
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

