export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Parcours Checkout annulé : aucun débit, le lien reste utilisable. */
export default function CheckoutCancelPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gris-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-gris-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-gris-900">Paiement annulé</h1>
        <p className="mt-2 text-sm text-gris-600">
          Aucun montant n’a été débité. Vous pouvez reprendre le paiement à tout
          moment depuis votre lien.
        </p>
      </div>
    </main>
  );
}
