"use client";

import { useActionState } from "react";

import type { PayActionState } from "./pay-action";

const MESSAGES: Record<string, string> = {
  not_payable:
    "Ce paiement n’est pas disponible pour le moment. Réessayez plus tard ou contactez l’émetteur.",
  rate_limited: "Trop de tentatives. Merci de patienter quelques minutes.",
  retry: "Préparation en cours. Merci de réessayer dans un instant.",
  not_found: "Ce lien de paiement n’est plus valide.",
  error: "Une erreur est survenue. Merci de réessayer plus tard.",
};

// Messages plus précis pour les cas non_payable détectés au moment du clic
// (revérification live du compte, quota, paiement déjà en cours…).
const NOT_PAYABLE_REASON_MESSAGES: Record<string, string> = {
  archived: "Ce paiement n’est plus disponible.",
  not_open: "Ce paiement n’est plus disponible.",
  already_settled: "Ce paiement a déjà été réglé. Merci !",
  unsupported_currency: "Ce paiement n’est pas disponible pour le moment.",
  account_not_configured:
    "Le paiement en ligne n’est pas encore activé pour ce prestataire. Réessayez un peu plus tard.",
  account_not_payable:
    "Aucun moyen de paiement n’est disponible pour le moment. Réessayez plus tard ou contactez l’émetteur.",
  account_check_unavailable:
    "La disponibilité du paiement ne peut pas être vérifiée maintenant. Réessayez dans quelques instants.",
  pending_payment:
    "Un paiement est déjà en cours de traitement. Revenez sur ce lien pour vérifier son état.",
};

export const PUBLIC_PAYMENT_RESUME_STORAGE_KEY = "sidian.public-payment.resume-path";

export function resumePathForToken(token: string): string | null {
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? `/p/${token}` : null;
}

function messageFor(state: PayActionState): string {
  if (!state) return "";
  if (state.status === "not_payable" && state.reason) {
    return NOT_PAYABLE_REASON_MESSAGES[state.reason] ?? MESSAGES.not_payable;
  }
  return MESSAGES[state.status] ?? MESSAGES.error;
}

export function PayButton({
  token,
  action,
}: {
  token: string;
  action: (
    prevState: PayActionState,
    formData: FormData,
  ) => Promise<PayActionState>;
}) {
  const [state, formAction, pending] = useActionState<PayActionState, FormData>(
    action,
    null,
  );
  const resumePath = resumePathForToken(token);

  return (
    <form
      action={formAction}
      className="space-y-3"
      onSubmit={() => {
        if (!resumePath) return;
        try {
          sessionStorage.setItem(PUBLIC_PAYMENT_RESUME_STORAGE_KEY, resumePath);
        } catch {
          // La reprise reste optionnelle ; le serveur revérifie toujours le lien.
        }
      }}
    >
      <input type="hidden" name="token" value={token} />
      <button
        type="submit"
        disabled={pending}
        aria-disabled={pending}
        aria-busy={pending}
        className="min-h-11 w-full rounded-lg bg-sidian-blue px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Redirection…" : "Régler maintenant"}
      </button>
      {state ? (
        <p role="alert" className="text-sm text-red-700">
          {messageFor(state)}
        </p>
      ) : null}
    </form>
  );
}
