import Link from "next/link";

import { AppShell } from "@/components/app/app-shell";
import { DashboardOverview } from "@/components/app/dashboard-overview";
import { ErrorState } from "@/components/feedback";
import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { requireConfirmedUser } from "@/lib/auth/session";
import { loadDashboard } from "@/lib/dashboard/load-dashboard";
import { createClient } from "@/lib/supabase/server";
import { UX_COPY } from "@/lib/ux/microcopy";

export default async function AppPage() {
  const user = await requireConfirmedUser();
  const supabase = await createClient();
  const prestataire = await ensurePrestataireForUser(supabase, user);

  let dashboard: Awaited<ReturnType<typeof loadDashboard>> | null = null;
  let loadError: string | null = null;

  try {
    dashboard = await loadDashboard(supabase, prestataire.id);
  } catch {
    loadError = UX_COPY.errorLoad.description;
  }

  return (
    <AppShell
      title="Tableau de bord"
      description={`Voici où en sont les paiements de ${prestataire.nom}.`}
      actions={
        <Link
          href="/app/paiements-a-recevoir"
          className="inline-flex min-h-10 items-center justify-center rounded-lg bg-sidian-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
        >
          Nouveau paiement
        </Link>
      }
    >
      {loadError ? (
        <ErrorState
          title="Tableau de bord indisponible"
          description={loadError}
          compact
        />
      ) : dashboard ? (
        <DashboardOverview dashboard={dashboard} />
      ) : null}
    </AppShell>
  );
}
