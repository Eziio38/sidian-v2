import { DashboardActions } from "@/components/app/dashboard-actions";
import { DashboardDeadlines } from "@/components/app/dashboard-deadlines";
import { DashboardEvents } from "@/components/app/dashboard-events";
import { DashboardPortfolio } from "@/components/app/dashboard-portfolio";
import { DashboardSummary } from "@/components/app/dashboard-summary";
import type { DashboardModel } from "@/lib/dashboard/dashboard-model";

type DashboardOverviewProps = {
  dashboard: DashboardModel;
};

export function DashboardOverview({ dashboard }: DashboardOverviewProps) {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-6">
        <DashboardSummary totals={dashboard.totals} />
        <DashboardActions actions={dashboard.actions} />
        <DashboardDeadlines
          deadlines={dashboard.deadlines}
          draftCount={dashboard.portfolio.draftCount}
        />
        <DashboardEvents events={dashboard.events} />
      </div>
      <DashboardPortfolio
        portfolio={dashboard.portfolio}
        disputedCents={dashboard.totals.disputedCents}
      />
    </div>
  );
}
