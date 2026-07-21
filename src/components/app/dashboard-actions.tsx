import Link from "next/link";

import type { DashboardAction } from "@/lib/dashboard/dashboard-model";

type DashboardActionsProps = {
  actions: DashboardAction[];
};

export function DashboardActions({ actions }: DashboardActionsProps) {
  const visibleActions = actions.slice(0, 5);

  return (
    <section
      aria-labelledby="dashboard-actions-title"
      className="overflow-hidden rounded-xl border border-gris-200 bg-white"
    >
      <div className="flex items-center justify-between gap-4 border-b border-gris-100 px-5 py-4">
        <div>
          <h2
            id="dashboard-actions-title"
            className="text-base font-bold tracking-[-0.015em] text-nuit"
          >
            Actions requises
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-gris-500">
            Les décisions qui nécessitent votre intervention.
          </p>
        </div>
        <span
          className={
            actions.length > 0
              ? "inline-flex min-w-6 items-center justify-center rounded-full bg-red-50 px-2 py-1 text-xs font-semibold tabular-nums text-red-700"
              : "inline-flex min-w-6 items-center justify-center rounded-full bg-gris-100 px-2 py-1 text-xs font-semibold tabular-nums text-gris-500"
          }
          aria-label={`${actions.length} action${actions.length === 1 ? "" : "s"} requise${actions.length === 1 ? "" : "s"}`}
        >
          {actions.length}
        </span>
      </div>

      {actions.length === 0 ? (
        <p className="bg-emerald-50 px-5 py-4 text-sm leading-relaxed text-emerald-800">
          Aucune validation ni intervention en attente.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-gris-100">
            {visibleActions.map((action) => (
              <li
                key={action.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-nuit">{action.title}</p>
                    <span
                      className={
                        action.priority === "urgent"
                          ? "rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700"
                          : "rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700"
                      }
                    >
                      {action.priority === "urgent" ? "Prioritaire" : "À voir"}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-gris-500">
                    {action.description}
                  </p>
                </div>
                <Link
                  href={
                    action.target === "approvals"
                      ? "/app/approbations"
                      : "/app/paiements-a-recevoir"
                  }
                  className="shrink-0 text-sm font-semibold text-sidian-blue underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
                  aria-label={`${action.target === "approvals" ? "Ouvrir les approbations" : "Ouvrir les paiements à recevoir"} pour ${action.description}`}
                >
                  Ouvrir
                </Link>
              </li>
            ))}
          </ul>
          {actions.length > visibleActions.length ? (
            <p className="border-t border-gris-100 px-5 py-3 text-xs text-gris-500">
              {actions.length - visibleActions.length} autre
              {actions.length - visibleActions.length === 1 ? "" : "s"} action
              {actions.length - visibleActions.length === 1 ? "" : "s"} à
              consulter dans les espaces concernés.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
