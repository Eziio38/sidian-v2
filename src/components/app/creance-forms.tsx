"use client";

import { useActionState, useId, useState } from "react";

import { AuthField } from "@/components/auth/auth-field";
import { AuthSubmitButton } from "@/components/auth/auth-submit-button";
import { createCreationKeyMachine } from "@/lib/clients/creation-key";

type ActionResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

type ClientOption = { id: string; nom: string };

type CreanceFormProps = {
  action: (
    prev: ActionResult | undefined,
    formData: FormData,
  ) => Promise<ActionResult>;
  clients: ClientOption[];
  initial?: {
    id?: string;
    clientPayeurId?: string;
    clientNom?: string;
    montantEuros?: string;
    devise?: string;
    dateEcheance?: string;
    libelle?: string;
    referenceExterne?: string;
  };
  submitLabel: string;
};

export function CreanceForm({
  action,
  clients,
  initial,
  submitLabel,
}: CreanceFormProps) {
  const reactId = useId();
  const prefix = `paiement-${initial?.id ?? reactId}`;
  const isEdit = Boolean(initial?.id);
  const isCreate = !isEdit;
  const [keyMachine] = useState(() =>
    isCreate ? createCreationKeyMachine() : null,
  );
  const [creationKey, setCreationKey] = useState(
    () => keyMachine?.getKey() ?? "",
  );
  const [formEpoch, setFormEpoch] = useState(0);
  const currentClientId = initial?.clientPayeurId;
  const currentClientSelectable =
    !currentClientId || clients.some((client) => client.id === currentClientId);

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

  if (clients.length === 0 && !isEdit) {
    return (
      <p className="rounded-xl border border-gris-200 bg-white p-5 text-sm text-gris-500">
        Ajoutez d&apos;abord un client pour créer un paiement à recevoir.
      </p>
    );
  }

  if (isEdit && currentClientId && !currentClientSelectable) {
    return (
      <div
        className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-nuit"
        role="status"
        data-testid="paiement-client-bloque"
      >
        <p className="font-medium">Modification bloquée</p>
        <p className="mt-2 text-gris-500">
          Le client actuel
          {initial?.clientNom ? ` (« ${initial.clientNom} ») ` : " "}
          n&apos;est plus sélectionnable. Aucune réaffectation automatique
          n&apos;est effectuée. Archivez ce paiement à recevoir ou rétablissez
          le client avant de modifier le brouillon.
        </p>
      </div>
    );
  }

  return (
    <form
      key={isCreate ? formEpoch : initial?.id}
      action={formAction}
      className="space-y-4 rounded-xl border border-gris-200 bg-white p-5"
    >
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      {isCreate ? (
        <input
          type="hidden"
          name="creationKey"
          value={creationKey}
          data-testid="paiement-creation-key"
        />
      ) : null}

      <div className="space-y-1.5">
        <label
          htmlFor={`${prefix}-clientPayeurId`}
          className="block text-sm font-medium text-nuit"
        >
          Client
        </label>
        <select
          id={`${prefix}-clientPayeurId`}
          name="clientPayeurId"
          defaultValue={isEdit ? (currentClientId ?? "") : ""}
          className="block w-full rounded-lg border border-gris-200 bg-white px-3 py-2.5 text-sm text-nuit shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sidian-blue"
          required
          aria-describedby={
            state?.ok === false && state.fieldErrors?.clientPayeurId?.[0]
              ? `${prefix}-clientPayeurId-error`
              : undefined
          }
        >
          {!isEdit ? (
            <option value="" disabled>
              Sélectionnez un client
            </option>
          ) : null}
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.nom}
            </option>
          ))}
        </select>
        {state?.ok === false && state.fieldErrors?.clientPayeurId?.[0] ? (
          <p
            role="alert"
            id={`${prefix}-clientPayeurId-error`}
            className="text-sm text-red-600"
          >
            {state.fieldErrors.clientPayeurId[0]}
          </p>
        ) : null}
      </div>

      <AuthField
        id={`${prefix}-libelle`}
        name="libelle"
        label="Libellé"
        defaultValue={initial?.libelle ?? ""}
        error={state?.ok === false ? state.fieldErrors?.libelle?.[0] : undefined}
      />
      <AuthField
        id={`${prefix}-montantEuros`}
        name="montantEuros"
        label="Montant (EUR)"
        inputMode="decimal"
        placeholder="500.00"
        defaultValue={initial?.montantEuros ?? ""}
        error={
          state?.ok === false ? state.fieldErrors?.montantEuros?.[0] : undefined
        }
        required
      />
      <input type="hidden" name="devise" value="EUR" />
      <AuthField
        id={`${prefix}-dateEcheance`}
        name="dateEcheance"
        type="date"
        label="Date d'échéance"
        defaultValue={initial?.dateEcheance ?? ""}
        error={
          state?.ok === false ? state.fieldErrors?.dateEcheance?.[0] : undefined
        }
        required
      />
      <AuthField
        id={`${prefix}-referenceExterne`}
        name="referenceExterne"
        label="Référence informative"
        defaultValue={initial?.referenceExterne ?? ""}
        hint="Optionnel — ex. numéro de facture externe."
        error={
          state?.ok === false
            ? state.fieldErrors?.referenceExterne?.[0]
            : undefined
        }
      />

      {state?.ok === false ? (
        <p
          role="alert"
          id={`${prefix}-form-error`}
          className="text-sm text-red-600"
        >
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
