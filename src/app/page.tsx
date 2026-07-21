import { getApplicationEnvironment } from "@/config/env-server";

export default function Home() {
  const environment = getApplicationEnvironment();

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16 sm:px-6">
      <section
        aria-labelledby="page-title"
        className="w-full max-w-md rounded-xl border border-gris-200 bg-white p-8 shadow-[0_8px_24px_rgba(13,17,23,0.08)]"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-gris-500">
          Socle technique
        </p>
        <h1
          id="page-title"
          className="mt-2 text-[32px] font-bold leading-[1.15] tracking-[-0.03em] text-nuit"
        >
          Sidian V2
        </h1>
        <p className="mt-3 text-sm leading-6 text-gris-500">
          Socle technique initialisé
        </p>
        <dl className="mt-8 space-y-4 border-t border-gris-100 pt-6">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-gris-500">Version</dt>
            <dd className="text-sm font-semibold tabular-nums text-nuit">0.1.0</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-gris-500">Environnement</dt>
            <dd className="text-sm font-semibold text-nuit">{environment}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
