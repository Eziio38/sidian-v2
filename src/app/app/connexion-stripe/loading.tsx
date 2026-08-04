export default function ConnexionStripeLoading() {
  return (
    <div className="min-h-full bg-gris-50" aria-busy="true" aria-live="polite">
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <p className="text-sm font-medium text-gris-500">
          Vérification de votre compte Stripe…
        </p>
        <div className="mt-8 h-72 max-w-3xl animate-pulse rounded-xl bg-gris-100 motion-reduce:animate-none" />
      </main>
    </div>
  );
}
