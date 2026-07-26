import { ConversationalWorkspace } from "@/components/assistant";
import { isDemoStateId } from "@/components/assistant/demo-states";
import {
  buildWelcomeSummaryLines,
  FALLBACK_WELCOME_SUMMARY,
} from "@/components/assistant/welcome-summary";
import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { requireConfirmedUser } from "@/lib/auth/session";
import { loadDashboard } from "@/lib/dashboard/load-dashboard";
import { createClient } from "@/lib/supabase/server";

type AssistantPageProps = {
  searchParams: Promise<{ demo?: string }>;
};

function firstNameFrom(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const token = value.trim().split(/\s+/)[0];
  return token || fallback;
}

async function loadWelcomeSummary(
  supabase: Awaited<ReturnType<typeof createClient>>,
  prestataireId: string,
): Promise<string[]> {
  try {
    const dashboard = await loadDashboard(supabase, prestataireId);
    const todayItems = dashboard.deadlines.filter(
      (deadline) => deadline.status === "today",
    );
    const todayOutstandingCents = todayItems.reduce(
      (sum, item) => sum + item.outstandingCents,
      0,
    );
    return buildWelcomeSummaryLines({
      todayOutstandingCents,
      todayCount: todayItems.length,
      overdueCount: dashboard.totals.overdueCount,
      attentionCount: dashboard.actions.length,
    });
  } catch {
    return [...FALLBACK_WELCOME_SUMMARY];
  }
}

export default async function AssistantPage({ searchParams }: AssistantPageProps) {
  const user = await requireConfirmedUser();
  const supabase = await createClient();
  const prestataire = await ensurePrestataireForUser(supabase, user);
  const params = await searchParams;
  const demoState = isDemoStateId(params.demo) ? params.demo : undefined;

  const userFirstName = firstNameFrom(
    (user.user_metadata?.first_name as string | undefined) ??
      (user.user_metadata?.full_name as string | undefined) ??
      user.email?.split("@")[0],
    "Lucie",
  );

  const summaryLines = demoState
    ? [
        "3 650 € sont attendus aujourd’hui.",
        "Aucun ne nécessite ton intervention.",
      ]
    : await loadWelcomeSummary(supabase, prestataire.id);

  return (
    <ConversationalWorkspace
      key={demoState ?? "live"}
      userFirstName={userFirstName}
      userDisplayName={prestataire.nom || userFirstName}
      demoState={demoState}
      summaryLines={summaryLines}
    />
  );
}
