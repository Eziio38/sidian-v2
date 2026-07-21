export default function AppLoading() {
  return (
    <main
      className="min-h-dvh bg-gris-50 px-4 py-8 sm:px-6 lg:px-8 lg:py-10"
      aria-busy="true"
      aria-label="Chargement de votre espace Sidian"
    >
      <div className="mx-auto max-w-6xl animate-pulse motion-reduce:animate-none">
        <div className="h-8 w-52 rounded-lg bg-gris-200" />
        <div className="mt-3 h-4 w-full max-w-xl rounded bg-gris-100" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-28 rounded-xl bg-white" />
          ))}
        </div>
        <div className="mt-6 h-72 rounded-xl bg-white" />
      </div>
      <p className="sr-only">Chargement en cours…</p>
    </main>
  );
}
