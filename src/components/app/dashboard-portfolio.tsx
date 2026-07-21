import type { DashboardModel } from "@/lib/dashboard/dashboard-model";
import {
  formatDashboardDate,
  formatEuroCents,
} from "@/lib/dashboard/format";

type DashboardPortfolioProps = {
  portfolio: DashboardModel["portfolio"];
  disputedCents: number;
};

export function DashboardPortfolio({
  portfolio,
  disputedCents,
}: DashboardPortfolioProps) {
  return (
    <aside
      aria-labelledby="dashboard-portfolio-title"
      className="rounded-xl border border-gris-200 bg-white p-5 lg:sticky lg:top-6"
    >
      <h2
        id="dashboard-portfolio-title"
        className="text-base font-bold tracking-[-0.015em] text-nuit"
      >
        Portefeuille suivi
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-gris-500">
        Une lecture compacte de votre activité en cours.
      </p>

      <dl className="mt-5 divide-y divide-gris-100 border-y border-gris-100">
        <div className="flex items-center justify-between gap-4 py-3">
          <dt className="text-sm text-gris-500">Paiements actifs</dt>
          <dd className="font-semibold tabular-nums text-nuit">
            {portfolio.activeCount}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <dt className="text-sm text-gris-500">Brouillons</dt>
          <dd className="font-semibold tabular-nums text-nuit">
            {portfolio.draftCount}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <dt className="text-sm text-gris-500">Litiges</dt>
          <dd className="font-semibold tabular-nums text-nuit">
            {portfolio.disputeCount}
          </dd>
        </div>
      </dl>

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-nuit">Prochaine échéance</h3>
        {portfolio.nextDueDate === null ? (
          <p className="mt-2 text-sm leading-relaxed text-gris-500">
            Aucune échéance à venir hors litige.
          </p>
        ) : (
          <div className="mt-2">
            <p className="font-semibold tabular-nums text-nuit">
              {formatDashboardDate(portfolio.nextDueDate)}
            </p>
            <p className="mt-1 text-sm tabular-nums text-gris-500">
              {formatEuroCents(portfolio.nextDueCents)} · {portfolio.nextDueCount}{" "}
              paiement{portfolio.nextDueCount === 1 ? "" : "s"}
            </p>
          </div>
        )}
      </div>

      {portfolio.disputeCount > 0 ? (
        <div className="mt-5 rounded-lg bg-red-50 p-3">
          <p className="text-sm font-semibold text-red-700">
            {formatEuroCents(disputedCents)} en litige
          </p>
          <p className="mt-1 text-xs leading-relaxed text-red-700">
            Inclus dans le total à recevoir, mais exclu des retards automatiques.
          </p>
        </div>
      ) : null}

      <p className="mt-5 border-t border-gris-100 pt-4 text-xs leading-relaxed text-gris-500">
        Le MVP reflète uniquement les règlements enregistrés dans Sidian. Les
        virements externes ne sont pas détectés automatiquement.
      </p>
    </aside>
  );
}
