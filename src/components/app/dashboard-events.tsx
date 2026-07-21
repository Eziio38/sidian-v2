import type { DashboardEvent } from "@/lib/dashboard/dashboard-model";
import {
  formatDashboardDateTime,
  formatEuroCents,
} from "@/lib/dashboard/format";

type DashboardEventsProps = {
  events: DashboardEvent[];
};

const TONE_CLASS: Record<DashboardEvent["tone"], string> = {
  neutral: "bg-gris-200",
  success: "bg-emerald-600",
  warning: "bg-amber-600",
  danger: "bg-red-600",
};

export function DashboardEvents({ events }: DashboardEventsProps) {
  return (
    <section
      aria-labelledby="dashboard-events-title"
      className="overflow-hidden rounded-xl border border-gris-200 bg-white"
    >
      <div className="border-b border-gris-100 px-5 py-4">
        <h2
          id="dashboard-events-title"
          className="text-base font-bold tracking-[-0.015em] text-nuit"
        >
          Derniers événements
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-gris-500">
          États financiers et décisions enregistrés par Sidian.
        </p>
      </div>

      {events.length === 0 ? (
        <p className="px-5 py-6 text-sm leading-relaxed text-gris-500">
          Les confirmations de paiement et demandes de validation apparaîtront
          ici.
        </p>
      ) : (
        <ol className="divide-y divide-gris-100">
          {events.map((event) => (
            <li
              key={event.id}
              className="flex items-start gap-3 px-5 py-4"
            >
              <span
                className={`mt-1.5 size-2 shrink-0 rounded-full ${TONE_CLASS[event.tone]}`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                  <p className="font-semibold text-nuit">{event.title}</p>
                  <time
                    dateTime={event.occurredAt}
                    className="shrink-0 text-xs tabular-nums text-gris-500"
                  >
                    {formatDashboardDateTime(event.occurredAt)}
                  </time>
                </div>
                <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <p className="truncate text-sm text-gris-500">
                    {event.description}
                  </p>
                  {event.amountCents !== null ? (
                    <p className="shrink-0 text-sm font-medium tabular-nums text-nuit">
                      {formatEuroCents(event.amountCents)}
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
