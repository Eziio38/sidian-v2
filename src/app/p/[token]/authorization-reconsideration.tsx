"use client";

import { useActionState } from "react";

import type { ReconsiderationActionState } from "./authorization-reconsideration-action";

const MESSAGES = {
  not_available:
    "Cette option n’est pas disponible pour le moment. Aucun moyen n’a été enregistré.",
  rate_limited: "Trop de tentatives. Merci de patienter quelques minutes.",
  error:
    "La vérification est momentanément indisponible. Aucun moyen n’a été enregistré.",
};

export function AuthorizationReconsideration({
  paymentToken,
  action,
}: {
  paymentToken: string;
  action: (
    previous: ReconsiderationActionState,
    formData: FormData,
  ) => Promise<ReconsiderationActionState>;
}) {
  const [state, formAction, pending] = useActionState<
    ReconsiderationActionState,
    FormData
  >(action, null);
  return (
    <aside className="mt-6 border-t border-gris-100 pt-5 text-sm text-gris-500">
      <p>Vous aviez choisi de régler chaque échéance manuellement.</p>
      <form action={formAction} className="mt-2">
        <input type="hidden" name="payment_token" value={paymentToken} />
        <button
          type="submit"
          disabled={pending}
          className="font-medium text-nuit underline decoration-gris-200 underline-offset-4 hover:decoration-nuit disabled:opacity-60"
        >
          {pending
            ? "Vérification…"
            : "Configurer volontairement mes prochains paiements"}
        </button>
      </form>
      {state ? (
        <p role="alert" className="mt-2 text-red-700">
          {MESSAGES[state.status]}
        </p>
      ) : null}
    </aside>
  );
}
