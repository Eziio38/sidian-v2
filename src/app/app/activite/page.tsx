import { AppShell } from "@/components/app/app-shell";
import { DashboardEvents } from "@/components/app/dashboard-events";
import { EmptyState, ErrorState } from "@/components/feedback";
import { ButtonLink } from "@/design-system";
import { listApprovalRequests } from "@/lib/approvals/approvals";
import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { requireConfirmedUser } from "@/lib/auth/session";
import { loadDashboard } from "@/lib/dashboard/load-dashboard";
import { createClient } from "@/lib/supabase/server";
import { UX_COPY } from "@/lib/ux/microcopy";

export default async function ActivitePage() {
  const user = await requireConfirmedUser();
  const supabase = await createClient();
  const prestataire = await ensurePrestataireForUser(supabase, user);

  let events: Awaited<ReturnType<typeof loadDashboard>>["events"] = [];
  let loadError: string | null = null;

  try {
    const dashboard = await loadDashboard(supabase, prestataire.id);
    events = dashboard.events;
  } catch {
    loadError = UX_COPY.errorLoad.description;
  }

  /*
   * La page Approbations est volontairement absente de la navigation
   * permanente (voir LEGACY_NAV_LABELS) : un point d'entrée fixe vers une page
   * presque toujours vide n'aide personne. Elle doit néanmoins rester
   * atteignable, sans quoi les décisions humaines demandées par l'agent sont
   * invisibles. On l'expose donc ici, et uniquement quand une décision attend
   * réellement.
   */
  let pendingApprovals = 0;
  try {
    const requests = await listApprovalRequests(supabase);
    pendingApprovals = requests.filter((r) => r.status === "pending").length;
  } catch {
    // Une approbation illisible ne doit pas casser la page Activité.
  }

  return (
    <AppShell
      title="Activité"
      description="Les événements récents sur tes protections et paiements."
      userDisplayName={prestataire.nom}
      userEmail={prestataire.email}
      actions={
        pendingApprovals > 0 ? (
          <ButtonLink href="/app/approbations">
            {pendingApprovals === 1
              ? "1 décision à prendre"
              : `${pendingApprovals} décisions à prendre`}
          </ButtonLink>
        ) : undefined
      }
    >
      {loadError ? (
        <ErrorState
          compact
          title={UX_COPY.errorLoad.title}
          description={loadError}
        />
      ) : events.length === 0 ? (
        <EmptyState
          title="Aucune activité pour l’instant"
          description="Dès qu’un paiement, une confirmation ou une décision arrive, tu la verras ici."
        />
      ) : (
        <DashboardEvents events={events} />
      )}
    </AppShell>
  );
}
