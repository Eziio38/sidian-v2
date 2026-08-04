"use client";

import { useActionState, useId, useState } from "react";

import { AuthField } from "@/components/auth/auth-field";
import { AuthSubmitButton } from "@/components/auth/auth-submit-button";
import { Button } from "@/design-system";
import { createCreationKeyMachine } from "@/lib/clients/creation-key";

import styles from "./form-layout.module.css";
type ActionResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

type ClientFormProps = {
  action: (
    prev: ActionResult | undefined,
    formData: FormData,
  ) => Promise<ActionResult>;
  initial?: { id?: string; nom?: string; email?: string };
  submitLabel: string;
  conversationId?: string;
};

export function ClientForm({
  action,
  initial,
  submitLabel,
  conversationId,
}: ClientFormProps) {
  const reactId = useId();
  const prefix = `client-${initial?.id ?? reactId}`;
  const isCreate = !initial?.id;
  const [keyMachine] = useState(() =>
    isCreate ? createCreationKeyMachine() : null,
  );
  const [creationKey, setCreationKey] = useState(
    () => keyMachine?.getKey() ?? "",
  );
  const [formEpoch, setFormEpoch] = useState(0);

  const boundAction = async (
    prev: ActionResult | undefined,
    formData: FormData,
  ): Promise<ActionResult> => {
    const result = await action(prev, formData);
    if (keyMachine) {
      const nextKey = keyMachine.applyActionResult(result);
      setCreationKey(nextKey);
      if (result.ok) {
        setFormEpoch((epoch) => epoch + 1);
      }
    }
    return result;
  };

  const [state, formAction] = useActionState(boundAction, undefined);

  return (
    <form
      key={isCreate ? formEpoch : "edit"}
      action={formAction}
      className={styles.form}
      aria-describedby={
        state?.ok === false ? `${prefix}-form-error` : undefined
      }
    >
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      {isCreate && conversationId ? (
        <input type="hidden" name="conversationId" value={conversationId} />
      ) : null}
      {isCreate ? (
        <input
          type="hidden"
          name="creationKey"
          value={creationKey}
          data-testid="client-creation-key"
        />
      ) : null}
      <AuthField
        id={`${prefix}-nom`}
        name="nom"
        label="Nom"
        defaultValue={initial?.nom ?? ""}
        error={state?.ok === false ? state.fieldErrors?.nom?.[0] : undefined}
        required
      />
      <AuthField
        id={`${prefix}-email`}
        name="email"
        type="email"
        label="Email"
        defaultValue={initial?.email ?? ""}
        error={state?.ok === false ? state.fieldErrors?.email?.[0] : undefined}
        required
      />
      {state?.ok === false ? (
        <p
          role="alert"
          className={`${styles.formStatus} ${styles.formError}`}
          id={`${prefix}-form-error`}
        >
          {state.message}
        </p>
      ) : null}
      {/* Région live montée en permanence : voir `.sidian-live-region`. */}
      <p
        role="status"
        className={`sidian-live-region ${styles.formStatus} ${styles.formSuccess}`}
      >
        {state?.ok === true ? "Enregistré." : ""}
      </p>
      <AuthSubmitButton>{submitLabel}</AuthSubmitButton>
    </form>
  );
}

type ArchiveButtonProps = {
  action: (
    prev: ActionResult | undefined,
    formData: FormData,
  ) => Promise<ActionResult>;
  id: string;
  label: string;
};

export function ArchiveButton({ action, id, label }: ArchiveButtonProps) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const reactId = useId();

  return (
    <form
      action={formAction}
      className={styles.inlineForm}
      aria-describedby={
        state?.ok === false ? `${reactId}-archive-error` : undefined
      }
    >
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        variant="destructive"
        size="sm"
        disabled={pending}
        loading={pending}
        loadingLabel="Archivage…"
      >
        {label}
      </Button>
      {state?.ok === false ? (
        <p
          role="alert"
          id={`${reactId}-archive-error`}
          className={`${styles.formStatus} ${styles.formError}`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
