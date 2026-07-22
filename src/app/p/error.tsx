"use client";

import { PublicPaymentShell } from "./public-payment-shell";

type PublicPaymentErrorProps = {
  error: Error & { digest?: string };
  unstable_retry: () => void;
};

export default function PublicPaymentError({
  unstable_retry,
}: PublicPaymentErrorProps) {
  return (
    <PublicPaymentShell centred>
      <h1 className="text-xl font-semibold tracking-[-0.02em] text-nuit">
        Le paiement ne peut pas être vérifié
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-gris-500">
        Cet écran ne confirme aucun règlement. Réessayez dans quelques instants
        pour obtenir l’état revérifié côté serveur.
      </p>
      <button
        type="button"
        onClick={unstable_retry}
        className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-sidian-blue px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
      >
        Réessayer
      </button>
    </PublicPaymentShell>
  );
}
