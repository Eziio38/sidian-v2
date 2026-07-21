import type { DashboardModel } from "@/lib/dashboard/dashboard-model";
import { formatEuroCents } from "@/lib/dashboard/format";

type DashboardSummaryProps = {
  totals: DashboardModel["totals"];
};

export function DashboardSummary({ totals }: DashboardSummaryProps) {
  return (
    <section aria-labelledby="dashboard-financial-summary">
      <h2 id="dashboard-financial-summary" className="sr-only">
        Synthèse financière
      </h2>
      <dl className="grid overflow-hidden rounded-xl border border-gris-200 bg-white sm:grid-cols-2 xl:grid-cols-4">
        <div className="border-b border-gris-100 p-4 sm:border-r xl:border-b-0">
          <dt className="text-[13px] font-medium text-gris-500">À recevoir</dt>
          <dd className="mt-2 text-[26px] font-bold tabular-nums tracking-[-0.03em] text-nuit">
            {formatEuroCents(totals.receivableCents)}
          </dd>
          <p className="mt-1 text-xs leading-relaxed text-gris-500">
            Solde après règlements confirmés, litiges inclus
          </p>
        </div>

        <div className="border-b border-gris-100 p-4 xl:border-b-0 xl:border-r">
          <dt className="text-[13px] font-medium text-gris-500">Confirmés</dt>
          <dd className="mt-2 text-[26px] font-bold tabular-nums tracking-[-0.03em] text-emerald-700">
            {formatEuroCents(totals.confirmedCents)}
          </dd>
          <p className="mt-1 text-xs leading-relaxed text-gris-500">
            Cumul · {totals.confirmedCount} règlement
            {totals.confirmedCount === 1 ? "" : "s"} enregistré
            {totals.confirmedCount === 1 ? "" : "s"}
          </p>
        </div>

        <div className="border-b border-gris-100 p-4 sm:border-r sm:border-b-0">
          <dt className="text-[13px] font-medium text-gris-500">
            En traitement
          </dt>
          <dd className="mt-2 text-[26px] font-bold tabular-nums tracking-[-0.03em] text-amber-700">
            {formatEuroCents(totals.processingCents)}
          </dd>
          <p className="mt-1 text-xs leading-relaxed text-gris-500">
            {totals.processingCount} tentative
            {totals.processingCount === 1 ? "" : "s"}, non déduite
            {totals.processingCount === 1 ? "" : "s"} du solde
          </p>
        </div>

        <div className="p-4">
          <dt className="text-[13px] font-medium text-gris-500">En retard</dt>
          <dd className="mt-2 text-[26px] font-bold tabular-nums tracking-[-0.03em] text-nuit">
            {formatEuroCents(totals.overdueCents)}
          </dd>
          <p className="mt-1 text-xs leading-relaxed text-gris-500">
            {totals.overdueCount} échéance
            {totals.overdueCount === 1 ? "" : "s"} dépassée
            {totals.overdueCount === 1 ? "" : "s"}, hors litiges
          </p>
        </div>
      </dl>
    </section>
  );
}
