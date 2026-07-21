"use client";

import { useActionState, useId } from "react";

import type { ApprovalActionResult } from "@/app/actions/approvals";

type ApprovalDecisionProps = {
  id: string;
  action: (
    previous: ApprovalActionResult | undefined,
    formData: FormData,
  ) => Promise<ApprovalActionResult>;
};

export function ApprovalDecision({ id, action }: ApprovalDecisionProps) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const statusId = useId();

  return (
    <form action={formAction} aria-describedby={state ? statusId : undefined}>
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          name="decision"
          value="approved"
          disabled={pending}
          className="inline-flex min-h-10 items-center justify-center rounded-lg bg-sidian-blue px-4 text-sm font-medium text-white transition-colors hover:bg-[#315fd9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Enregistrement…" : "Valider"}
        </button>
        <button
          type="submit"
          name="decision"
          value="rejected"
          disabled={pending}
          className="inline-flex min-h-10 items-center justify-center rounded-lg border border-gris-200 px-4 text-sm font-medium text-nuit transition-colors hover:border-nuit focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue disabled:cursor-not-allowed disabled:opacity-60"
        >
          Refuser
        </button>
      </div>
      {state ? (
        <p
          id={statusId}
          role={state.ok ? "status" : "alert"}
          className={`mt-2 text-sm ${state.ok ? "text-emerald-700" : "text-red-600"}`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
