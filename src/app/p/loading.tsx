import { PublicPaymentShell } from "./public-payment-shell";

export default function PublicPaymentLoading() {
  return (
    <PublicPaymentShell>
      <div
        className="animate-pulse space-y-4 motion-reduce:animate-none"
        aria-busy="true"
        aria-label="Vérification du paiement"
      >
        <div className="h-4 w-40 rounded bg-gris-100" />
        <div className="h-8 w-64 max-w-full rounded bg-gris-200" />
        <div className="h-20 rounded-xl bg-gris-50" />
        <div className="space-y-3 pt-2">
          <div className="h-4 rounded bg-gris-100" />
          <div className="h-4 rounded bg-gris-100" />
          <div className="h-10 rounded bg-gris-200" />
        </div>
        <p className="sr-only">Vérification du paiement en cours…</p>
      </div>
    </PublicPaymentShell>
  );
}
