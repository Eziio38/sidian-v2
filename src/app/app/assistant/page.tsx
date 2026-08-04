import { ConversationalWorkspace } from "@/components/assistant";
import type { SidebarOnboardingFacts } from "@/components/app/app-sidebar";
import type { WelcomeBriefCard } from "@/components/assistant/welcome-state";
import type { PaymentSummaryData } from "@/components/assistant/types";
import {
  resolveDisplayName,
  resolveGreetingFirstName,
} from "@/components/assistant/greeting";
import {
  buildWelcomeSummaryLines,
  FALLBACK_WELCOME_SUMMARY,
  resolveWelcomeDataState,
  type WelcomeDataState,
} from "@/components/assistant/welcome-summary";
import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { requireConfirmedUser } from "@/lib/auth/session";
import { loadDashboard } from "@/lib/dashboard/load-dashboard";
import { formatEuroCents } from "@/lib/dashboard/format";
import { createClient } from "@/lib/supabase/server";
import { listConversationHistory } from "@/lib/assistant-conversations";
import { listConversationProjects } from "@/lib/assistant-projects";

type WelcomeBundle = {
  lines: string[];
  dataState: WelcomeDataState;
  briefCards: WelcomeBriefCard[];
  paymentSummary: PaymentSummaryData;
};

type SidebarAccountContext = {
  onboardingFacts?: SidebarOnboardingFacts;
  planLabel?: string;
};

type AssistantPageProps = {
  searchParams: Promise<{ action?: string }>;
};

function planLabelFromPricingVersion(value: string | null): string | undefined {
  if (value === "early_solo") return "Early Access";
  return undefined;
}

async function loadSidebarAccountContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  prestataireId: string,
): Promise<SidebarAccountContext> {
  const [clients, importedInvoices, dossiers, account] = await Promise.all([
    supabase
      .from("client_payeur")
      .select("id", { count: "exact", head: true })
      .is("archived_at", null),
    supabase
      .from("creance")
      .select("id", { count: "exact", head: true })
      .eq("origine", "facture_externe")
      .is("archived_at", null),
    supabase
      .from("dossier_suivi")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("prestataire")
      .select("pricing_version")
      .eq("id", prestataireId)
      .maybeSingle(),
  ]);

  const hasOnboardingError = [
    clients.error,
    importedInvoices.error,
    dossiers.error,
  ].some(Boolean);

  return {
    onboardingFacts: hasOnboardingError
      ? undefined
      : {
          hasClient: (clients.count ?? 0) > 0,
          hasImportedInvoice: (importedInvoices.count ?? 0) > 0,
          hasDossier: (dossiers.count ?? 0) > 0,
        },
    planLabel: account.error
      ? undefined
      : planLabelFromPricingVersion(account.data?.pricing_version ?? null),
  };
}

async function loadWelcomeSummary(
  supabase: Awaited<ReturnType<typeof createClient>>,
  prestataireId: string,
): Promise<WelcomeBundle> {
  try {
    const dashboard = await loadDashboard(supabase, prestataireId);
    const todayItems = dashboard.deadlines.filter(
      (deadline) => deadline.status === "today",
    );
    const todayOutstandingCents = todayItems.reduce(
      (sum, item) => sum + item.outstandingCents,
      0,
    );
    const isFirstUse =
      dashboard.portfolio.activeCount === 0 &&
      dashboard.portfolio.draftCount === 0 &&
      dashboard.deadlines.length === 0 &&
      dashboard.actions.length === 0 &&
      dashboard.totals.receivableCents === 0;
    const upcomingItems = dashboard.deadlines.filter(
      (deadline) =>
        deadline.status === "today" || deadline.status === "upcoming",
    );
    const nextPayment = upcomingItems[0];
    const input = {
      todayOutstandingCents,
      todayCount: todayItems.length,
      overdueCount: dashboard.totals.overdueCount,
      attentionCount: dashboard.actions.length,
      isFirstUse,
    };
    return {
      lines: buildWelcomeSummaryLines(input),
      dataState: resolveWelcomeDataState(input),
      briefCards: [
        {
          id: "expected",
          label: "Cette semaine",
          value: formatEuroCents(dashboard.totals.receivableCents),
          hint:
            dashboard.portfolio.activeCount === 1
              ? "1 paiement suivi"
              : dashboard.portfolio.activeCount > 1
                ? `${dashboard.portfolio.activeCount} paiements suivis`
                : "Aucun montant en attente",
        },
        {
          id: "active",
          label: "À traiter",
          value:
            dashboard.actions.length === 0
              ? "Rien"
              : String(dashboard.actions.length),
          hint:
            dashboard.actions.length === 0
              ? "Aucune action requise"
              : dashboard.actions.length === 1
                ? "1 action demande ton attention"
                : `${dashboard.actions.length} actions demandent ton attention`,
        },
        {
          id: "next",
          label: "Prochain",
          value:
            todayItems[0]?.clientName ??
            (dashboard.deadlines[0]?.clientName ?? "—"),
          hint:
            todayItems[0]
              ? formatEuroCents(todayItems[0].outstandingCents)
              : dashboard.deadlines[0]
                ? formatEuroCents(dashboard.deadlines[0].outstandingCents)
                : "Pas encore d’échéance",
        },
      ],
      paymentSummary: {
        confirmedCount: dashboard.totals.confirmedCount,
        confirmedAmountLabel: formatEuroCents(
          dashboard.totals.confirmedCents,
        ),
        processingCount: dashboard.totals.processingCount,
        processingAmountLabel: formatEuroCents(
          dashboard.totals.processingCents,
        ),
        upcomingCount: upcomingItems.length,
        upcomingAmountLabel: formatEuroCents(
          upcomingItems.reduce(
            (total, payment) => total + payment.outstandingCents,
            0,
          ),
        ),
        nextPaymentLabel: nextPayment
          ? `${nextPayment.clientName} · ${formatEuroCents(nextPayment.outstandingCents)}`
          : undefined,
      },
    };
  } catch {
    return {
      lines: buildWelcomeSummaryLines({
        todayOutstandingCents: 0,
        todayCount: 0,
        overdueCount: 0,
        attentionCount: 0,
        loadError: true,
      }),
      dataState: "load_error",
      briefCards: [
        {
          id: "expected",
          label: "Cette semaine",
          value: "À préciser",
          hint: "Données momentanément indisponibles",
        },
        {
          id: "active",
          label: "À traiter",
          value: "À préciser",
          hint: "Données momentanément indisponibles",
        },
        {
          id: "next",
          label: "Prochain",
          value: "À préciser",
          hint: "Réessaie dans un instant",
        },
      ],
      paymentSummary: {
        confirmedCount: 0,
        confirmedAmountLabel: "Indisponible",
        processingCount: 0,
        processingAmountLabel: "Indisponible",
        upcomingCount: 0,
        upcomingAmountLabel: "Indisponible",
      },
    };
  }
}

export default async function AssistantPage({
  searchParams,
}: AssistantPageProps) {
  const params = await searchParams;
  const initialAction =
    params.action === "create_protection"
      ? ("create_protection" as const)
      : undefined;
  const user = await requireConfirmedUser();
  const supabase = await createClient();
  const prestataire = await ensurePrestataireForUser(supabase, user);

  const metadata = user.user_metadata ?? {};
  const userFirstName = resolveGreetingFirstName({
    firstName:
      typeof metadata.first_name === "string" ? metadata.first_name : null,
    fullName:
      typeof metadata.full_name === "string" ? metadata.full_name : null,
    displayName:
      typeof metadata.display_name === "string" ? metadata.display_name : null,
  });

  // Jamais email / local-part — uniquement un vrai nom d’affichage.
  const userDisplayName = resolveDisplayName({
    displayName:
      typeof metadata.display_name === "string" ? metadata.display_name : null,
    fullName:
      typeof metadata.full_name === "string" ? metadata.full_name : null,
    firstName:
      typeof metadata.first_name === "string" ? metadata.first_name : null,
    fallback: userFirstName ?? "Profil",
  });

  const welcome = await loadWelcomeSummary(supabase, prestataire.id);
  const sidebarAccountContext = await loadSidebarAccountContext(
    supabase,
    prestataire.id,
  );

  // Fallback lines never empty
  const summaryLines =
    welcome.lines.length > 0 ? welcome.lines : [...FALLBACK_WELCOME_SUMMARY];
  let conversationHistory: Awaited<
    ReturnType<typeof listConversationHistory>
  > = [];
  let conversationProjects: Awaited<
    ReturnType<typeof listConversationProjects>
  > = [];
  let knownClients: Array<{ id: string; name: string; email?: string }> = [];
  try {
    conversationHistory = await listConversationHistory(
      supabase,
      prestataire.id,
    );
  } catch {
    conversationHistory = [];
  }
  try {
    conversationProjects = await listConversationProjects(
      supabase,
      prestataire.id,
    );
  } catch {
    conversationProjects = [];
  }
  try {
    const { data, error } = await supabase
      .from("client_payeur")
      .select("id, nom, email")
      .eq("prestataire_id", prestataire.id)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    knownClients = (data ?? []).map((client) => ({
      id: client.id,
      name: client.nom,
      email: client.email,
    }));
  } catch {
    knownClients = [];
  }

  return (
    <ConversationalWorkspace
      key={user.id}
      userFirstName={userFirstName}
      userDisplayName={userDisplayName}
      userEmail={prestataire.email}
      userPlan={sidebarAccountContext.planLabel}
      sidebarOnboardingFacts={sidebarAccountContext.onboardingFacts}
      summaryLines={summaryLines}
      welcomeDataState={welcome.dataState}
      welcomeBriefCards={welcome.briefCards}
      paymentSummary={welcome.paymentSummary}
      initialConversationHistory={conversationHistory}
      initialConversationProjects={conversationProjects}
      initialKnownClients={knownClients}
      initialAction={initialAction}
    />
  );
}
