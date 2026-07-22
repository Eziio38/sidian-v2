"use client";

import { useActionState } from "react";

import {
  FUTURE_PAYMENT_AUTHORIZATION_TITLE,
  futurePaymentAuthorizationText,
} from "@/lib/stripe/authorizations/consent";

import type { AuthorizationDecisionState } from "./authorization-actions";

const MESSAGES: Record<
  Exclude<AuthorizationDecisionState, null>["status"],
  string
> = {
  declined:
    "Votre choix est enregistré. Vous continuerez à régler chaque paiement depuis son lien.",
  consent_required: "Veuillez confirmer votre accord avant de continuer.",
  not_available:
    "Cette autorisation n’est pas disponible. Aucun moyen de paiement n’a été enregistré.",
  expired:
    "Cette proposition a expiré. Aucun moyen de paiement n’a été enregistré.",
  rate_limited: "Trop de tentatives. Merci de patienter quelques minutes.",
  retry: "Préparation en cours. Merci de réessayer dans un instant.",
  error: "La configuration est momentanément indisponible. Aucun nouveau paiement n’a été déclenché.",
};

export function AuthorizationProposal({
  rawToken,
  sourceCheckoutSessionId,
  prestataireNom,
  initialPaymentProcessing,
  action,
}: {
  rawToken: string;
  sourceCheckoutSessionId: string;
  prestataireNom: string;
  initialPaymentProcessing: boolean;
  action: (
    previous: AuthorizationDecisionState,
    formData: FormData,
  ) => Promise<AuthorizationDecisionState>;
}) {
  const [state, formAction, pending] = useActionState<
    AuthorizationDecisionState,
    FormData
  >(action, null);

  if (state?.status === "declined") {
    return (
      <p className="mt-6 rounded-xl bg-gris-50 p-4 text-left text-sm text-gris-500">
        {MESSAGES.declined}
      </p>
    );
  }

  return (
    <section
      aria-labelledby="future-payment-title"
      className="mt-7 border-t border-gris-200 pt-6 text-left"
    >
      <h2
        id="future-payment-title"
        className="text-base font-semibold text-nuit"
      >
        {FUTURE_PAYMENT_AUTHORIZATION_TITLE}
      </h2>
      {initialPaymentProcessing ? (
        <p className="mt-2 text-sm font-medium text-nuit">
          Votre paiement initial est toujours en cours de traitement. Vous
          pouvez néanmoins configurer séparément vos prochains règlements.
        </p>
      ) : null}
      <p className="mt-2 text-sm leading-6 text-gris-500">
        Carte et compte bancaire resteront proposés uniquement s’ils sont
        réellement disponibles dans le compte Stripe de {prestataireNom}. Vous
        pourrez choisir sur l’écran sécurisé Stripe.
      </p>

      <form action={formAction} className="mt-4 space-y-4">
        <input type="hidden" name="authorization_token" value={rawToken} />
        <input
          type="hidden"
          name="source_session_id"
          value={sourceCheckoutSessionId}
        />
        <label className="flex items-start gap-3 text-sm leading-6 text-gris-500">
          <input
            type="checkbox"
            name="consent"
            value="accepted"
            className="mt-1 size-4 shrink-0"
          />
          <span>{futurePaymentAuthorizationText(prestataireNom)}</span>
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="submit"
            name="decision"
            value="accept"
            disabled={pending}
            className="rounded-xl bg-nuit px-4 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {pending ? "Préparation…" : "Configurer avec Stripe"}
          </button>
          <button
            type="submit"
            name="decision"
            value="decline"
            disabled={pending}
            formNoValidate
            className="rounded-xl border border-gris-200 bg-white px-4 py-3 text-sm font-medium text-gris-500 transition hover:bg-gris-50 disabled:opacity-60"
          >
            Continuer sans autoriser
          </button>
        </div>
        {state ? (
          <p role="alert" className="text-sm text-red-700">
            {MESSAGES[state.status]}
          </p>
        ) : null}
      </form>
    </section>
  );
}
