export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function AuthorizationCancelPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gris-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-gris-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-nuit">
          Configuration interrompue
        </h1>
        <p className="mt-2 text-sm text-gris-500">
          Cette page ne modifie aucune autorisation et ne déclenche aucun
          paiement. Revenez à la page précédente pour demander une vérification
          serveur de l’état réel, ou fermez cette page.
        </p>
      </div>
    </main>
  );
}
