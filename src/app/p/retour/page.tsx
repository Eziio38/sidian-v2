export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retour de parcours Checkout. N'affirme jamais une confirmation de paiement :
 * la confirmation est pilotée par les webhooks PaymentIntent (SEPA différé).
 */
export default function CheckoutReturnPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gris-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-gris-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-gris-900">Merci</h1>
        <p className="mt-2 text-sm text-gris-600">
          Votre paiement est en cours de traitement. Vous recevrez une confirmation
          dès qu’il sera validé. Vous pouvez fermer cette page.
        </p>
      </div>
    </main>
  );
}
