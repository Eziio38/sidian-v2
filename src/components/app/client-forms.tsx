"use client";

import { useActionState, useId, useState } from "react";

import { AuthField } from "@/components/auth/auth-field";
import { AuthSubmitButton } from "@/components/auth/auth-submit-button";
import { createCreationKeyMachine } from "@/lib/clients/creation-key";

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
};

export function ClientForm({ action, initial, submitLabel }: ClientFormProps) {
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
      className="space-y-4 rounded-xl border border-gris-200 bg-white p-5"
    >
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}
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
        <p role="alert" className="text-sm text-red-600" id={`${prefix}-form-error`}>
          {state.message}
        </p>
      ) : null}
      {state?.ok === true ? (
        <p className="text-sm text-emerald-700">Enregistré.</p>
      ) : null}
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
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="text-sm text-red-600 hover:underline disabled:opacity-50"
      >
        {pending ? "Archivage…" : label}
      </button>
      {state?.ok === false ? (
        <p
          role="alert"
          id={`${reactId}-archive-error`}
          className="mt-1 text-xs text-red-600"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
