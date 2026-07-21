"use client";

type AppErrorProps = {
  error: Error & { digest?: string };
  unstable_retry: () => void;
};

export default function AppError({ error, unstable_retry }: AppErrorProps) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gris-50 px-4 py-12">
      <section className="w-full max-w-xl rounded-xl border border-gris-200 bg-white p-6 sm:p-8">
        <p className="text-sm font-semibold text-sidian-blue">Sidian</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-nuit">
          Cet écran n’a pas pu être chargé
        </h1>
        <p className="mt-3 max-w-lg text-sm leading-relaxed text-gris-500">
          Vos données n’ont pas été modifiées. Vous pouvez relancer le chargement
          ou revenir à votre espace dans quelques instants.
        </p>
        {error.digest ? (
          <p className="mt-3 text-xs text-gris-500">
            Référence de diagnostic : {error.digest}
          </p>
        ) : null}
        <button
          type="button"
          onClick={unstable_retry}
          className="mt-6 inline-flex min-h-10 items-center justify-center rounded-lg bg-sidian-blue px-4 text-sm font-medium text-white transition-colors hover:bg-[#315fd9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
        >
          Réessayer
        </button>
      </section>
    </main>
  );
}
