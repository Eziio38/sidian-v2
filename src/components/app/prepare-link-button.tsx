"use client";

import { useActionState } from "react";

import {
  openPaymentReceivableAction,
  type PrepareLinkResult,
} from "@/app/actions/clients-creances";

export function PrepareLinkButton({ creanceId }: { creanceId: string }) {
  const [state, action, pending] = useActionState<
    PrepareLinkResult | undefined,
    FormData
  >(openPaymentReceivableAction, undefined);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="creanceId" value={creanceId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-gris-300 px-3 py-1.5 text-sm font-medium text-nuit transition hover:bg-gris-50 disabled:opacity-60"
      >
        {pending ? "Préparation…" : "Préparer le lien de paiement"}
      </button>

      {state?.ok && state.shareUrl ? (
        <div className="space-y-1">
          <label className="text-xs text-gris-500">
            Lien de paiement à partager
          </label>
          <input
            readOnly
            value={state.shareUrl}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full rounded-lg border border-gris-200 bg-gris-50 px-2 py-1.5 text-xs text-nuit"
          />
          <p className="text-xs text-amber-700">
            Ce lien n’est affiché qu’une seule fois. Copiez-le maintenant.
          </p>
        </div>
      ) : null}

      {state?.ok && state.alreadyPrepared ? (
        <p className="text-xs text-gris-500">
          Un lien de paiement actif existe déjà pour ce paiement à recevoir.
        </p>
      ) : null}

      {state && !state.ok ? (
        <p role="alert" className="text-xs text-red-700">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
