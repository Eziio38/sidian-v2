"use client";

import { useActionState } from "react";

import { payAction, type PayActionState } from "./pay-action";

const MESSAGES: Record<string, string> = {
  not_payable:
    "Ce paiement n’est pas disponible pour le moment. Réessayez plus tard ou contactez l’émetteur.",
  rate_limited: "Trop de tentatives. Merci de patienter quelques minutes.",
  retry: "Préparation en cours. Merci de réessayer dans un instant.",
  not_found: "Ce lien de paiement n’est plus valide.",
  error: "Une erreur est survenue. Merci de réessayer plus tard.",
};

export function PayButton({ token }: { token: string }) {
  const [state, action, pending] = useActionState<PayActionState, FormData>(
    payAction,
    null,
  );

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-gris-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-gris-700 disabled:opacity-60"
      >
        {pending ? "Redirection…" : "Payer maintenant"}
      </button>
      {state ? (
        <p role="alert" className="text-sm text-red-700">
          {MESSAGES[state.status] ?? MESSAGES.error}
        </p>
      ) : null}
    </form>
  );
}
