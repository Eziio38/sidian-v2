import Link from "next/link";

import type { DashboardDeadline } from "@/lib/dashboard/dashboard-model";
import {
  formatDashboardDate,
  formatEuroCents,
} from "@/lib/dashboard/format";

type DashboardDeadlinesProps = {
  deadlines: DashboardDeadline[];
  draftCount: number;
};

const STATUS_PRESENTATION: Record<
  DashboardDeadline["status"],
  { label: string; className: string }
> = {
  overdue: {
    label: "En retard",
    className: "bg-red-50 text-red-700",
  },
  today: {
    label: "Aujourd’hui",
    className: "bg-amber-50 text-amber-700",
  },
  upcoming: {
    label: "À venir",
    className: "bg-gris-100 text-gris-500",
  },
  disputed: {
    label: "Litige",
    className: "bg-red-50 text-red-700",
  },
};

export function DashboardDeadlines({
  deadlines,
  draftCount,
}: DashboardDeadlinesProps) {
  return (
    <section
      aria-labelledby="dashboard-deadlines-title"
      className="overflow-hidden rounded-xl border border-gris-200 bg-white"
    >
      <div className="flex flex-col gap-3 border-b border-gris-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            id="dashboard-deadlines-title"
            className="text-base font-bold tracking-[-0.015em] text-nuit"
          >
            Échéances à suivre
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-gris-500">
            Un montant en traitement reste dans le solde tant que Stripe ne l’a
            pas confirmé.
          </p>
        </div>
        <Link
          href="/app/paiements-a-recevoir"
          className="shrink-0 text-sm font-semibold text-sidian-blue underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
        >
          Voir tous les paiements
        </Link>
      </div>

      {deadlines.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="font-semibold text-nuit">Aucune échéance active</p>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-gris-500">
            {draftCount > 0
              ? `${draftCount} brouillon${draftCount === 1 ? " est" : "s sont"} encore à finaliser avant de pouvoir suivre un règlement.`
              : "Créez un paiement à recevoir pour suivre son échéance et laisser Sidian gérer la communication."}
          </p>
        </div>
      ) : (
        <>
          <div
            aria-hidden="true"
            className="hidden grid-cols-[minmax(0,1fr)_9rem_8rem] gap-4 border-b border-gris-100 bg-gris-50 px-5 py-3 text-[11px] font-medium uppercase tracking-[0.06em] text-gris-500 sm:grid"
          >
            <span>Paiement</span>
            <span>Échéance</span>
            <span className="text-right">Solde</span>
          </div>
          <ul className="dashboard-card-scroll max-h-[34rem] divide-y divide-gris-100 overflow-y-auto">
            {deadlines.map((deadline) => {
              const status = STATUS_PRESENTATION[deadline.status];
              return (
                <li
                  key={deadline.id}
                  className="grid min-h-16 gap-3 px-5 py-4 transition-colors hover:bg-gris-50 sm:grid-cols-[minmax(0,1fr)_9rem_8rem] sm:items-center sm:gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold text-nuit">
                        {deadline.clientName}
                      </p>
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${status.className}`}
                      >
                        {status.label}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm text-gris-500">
                      {deadline.label}
                    </p>
                    {deadline.confirmedCents > 0 ? (
                      <p className="mt-1 text-xs tabular-nums text-emerald-700">
                        {formatEuroCents(deadline.confirmedCents)} confirmé
                      </p>
                    ) : null}
                  </div>

                  <time
                    dateTime={deadline.dueDate}
                    className="text-sm tabular-nums text-gris-500"
                  >
                    {formatDashboardDate(deadline.dueDate)}
                  </time>

                  <div className="sm:text-right">
                    <p className="font-semibold tabular-nums text-nuit">
                      {formatEuroCents(deadline.outstandingCents)}
                    </p>
                    {deadline.processingCents > 0 ? (
                      <p className="mt-1 text-xs tabular-nums text-amber-700">
                        {formatEuroCents(deadline.processingCents)} en traitement
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-gris-500">à recevoir</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
