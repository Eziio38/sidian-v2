"use client";

import { useActionState, useId } from "react";

import type { PaymentReconciliationActionResult } from "@/app/actions/payment-reconciliation";
import { Button } from "@/design-system";

import styles from "./form-layout.module.css";

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
      className={styles.form}
    >
      <input type="hidden" name="receivableId" value={receivableId} />
      <Button
        type="submit"
        variant="secondary"
        loading={pending}
        loadingLabel="Vérification Stripe…"
        className={styles.submit}
      >
        Vérifier avec Stripe
      </Button>
      {state ? (
        <p
          id={statusId}
          role={state.ok ? "status" : "alert"}
          className={`${styles.formStatus} ${
            state.ok && state.status !== "human_required"
              ? styles.formSuccess
              : state.ok
                ? ""
                : styles.formError
          }`}
        >
          {state.ok
            ? state.message
            : "La vérification n’a pas pu aboutir. Réessaie dans un instant."}
        </p>
      ) : null}
    </form>
  );
}
