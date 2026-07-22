import { PublicPaymentShell } from "./public-payment-shell";

export default function PublicPaymentNotFound() {
  return (
    <PublicPaymentShell centred>
      <h1 className="text-xl font-semibold tracking-[-0.02em] text-nuit">
        Lien de paiement indisponible
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-gris-500">
        Ce lien est incorrect, a été révoqué ou n’est plus valable. Demandez un
        nouveau lien au prestataire si vous devez encore régler ce paiement.
      </p>
    </PublicPaymentShell>
  );
}
