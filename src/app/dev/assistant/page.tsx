import { notFound } from "next/navigation";

import { ConversationalWorkspace } from "@/components/assistant";
import { isDemoStateId } from "@/components/assistant/demo-states";
import {
  DEMO_WELCOME_BY_STATE,
  type WelcomeDataState,
} from "@/components/assistant/welcome-summary";

export const dynamic = "force-dynamic";

/**
 * Preview locale G1-O — jamais exposée en production déployée.
 * Ouverture locale :
 * - `pnpm exec next dev --webpack -H 127.0.0.1 -p 3020`
 * - ou `SIDIAN_ALLOW_DEV_ASSISTANT_PREVIEW=1 pnpm exec next start -H 127.0.0.1 -p 3030`
 * Ne contourne pas `/app/assistant` (auth obligatoire).
 *
 * Query :
 * - `demo=A|B|C|D|E` — états conversation
 * - `data=none_due|due_calm|needs_attention|first_use|load_error` — empty state data (surtout demo A)
 */
type DevAssistantPreviewPageProps = {
  searchParams: Promise<{
    demo?: string;
    viewport?: string;
    data?: string;
    nav?: string;
    composer?: string;
    capture?: string;
  }>;
};

function isAssistantPreviewAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.SIDIAN_ALLOW_DEV_ASSISTANT_PREVIEW === "1";
}

function isWelcomeDataState(
  value: string | null | undefined,
): value is WelcomeDataState {
  return (
    value === "none_due" ||
    value === "due_calm" ||
    value === "needs_attention" ||
    value === "first_use" ||
    value === "load_error"
  );
}

/** Mappe demo A–E vers un état data distinct pour QA visuelle empty. */
function dataStateForDemo(
  demo: string,
  explicit?: WelcomeDataState,
): WelcomeDataState {
  if (explicit) return explicit;
  switch (demo) {
    case "A":
      return "due_calm";
    case "B":
      return "none_due";
    case "C":
      return "needs_attention";
    case "D":
      return "first_use";
    case "E":
      return "load_error";
    default:
      return "due_calm";
  }
}

export default async function DevAssistantPreviewPage({
  searchParams,
}: DevAssistantPreviewPageProps) {
  if (!isAssistantPreviewAllowed()) {
    notFound();
  }

  const params = await searchParams;
  const demoState = isDemoStateId(params.demo) ? params.demo : "A";
  const viewport =
    params.viewport === "mobile" ||
    params.viewport === "tablet" ||
    params.viewport === "desktop"
      ? params.viewport
      : undefined;
  const welcomeDataState = dataStateForDemo(
    demoState,
    isWelcomeDataState(params.data) ? params.data : undefined,
  );
  const defaultMobileNavOpen = params.nav === "open";

  const workspace = (
    <ConversationalWorkspace
      key={`${demoState}-${viewport ?? "auto"}-${welcomeDataState}-${params.nav ?? "nav"}-${params.composer ?? "composer"}`}
      userFirstName="Lucie"
      userDisplayName="Lucie Martin"
      userEmail="lucie.martin@sidian.fr"
      userPlan="Early Access"
      sidebarOnboardingFacts={{
        hasClient: welcomeDataState !== "first_use",
        hasImportedInvoice: welcomeDataState !== "first_use",
        hasDossier: welcomeDataState !== "first_use",
      }}
      demoState={demoState}
      viewport={viewport}
      summaryLines={DEMO_WELCOME_BY_STATE[welcomeDataState]}
      welcomeDataState={welcomeDataState}
      paymentSummary={{
        confirmedCount: welcomeDataState === "first_use" ? 0 : 2,
        confirmedAmountLabel:
          welcomeDataState === "first_use" ? "0 €" : "4 100 €",
        processingCount: welcomeDataState === "first_use" ? 0 : 1,
        processingAmountLabel:
          welcomeDataState === "first_use" ? "0 €" : "1 200 €",
        upcomingCount: welcomeDataState === "first_use" ? 0 : 3,
        upcomingAmountLabel:
          welcomeDataState === "first_use" ? "0 €" : "3 650 €",
        nextPaymentLabel:
          welcomeDataState === "first_use"
            ? undefined
            : "Dupont Conseil · 2 450 €",
      }}
      welcomeBriefCards={[
        {
          id: "expected",
          label: "Cette semaine",
          value: welcomeDataState === "first_use" ? "0 €" : "3 650 €",
          hint:
            welcomeDataState === "first_use"
              ? "Crée ta première protection"
              : "3 paiements suivis",
        },
        {
          id: "active",
          label: "À traiter",
          value:
            welcomeDataState === "needs_attention"
              ? "2"
              : welcomeDataState === "first_use"
                ? "0"
                : "Rien",
          hint:
            welcomeDataState === "needs_attention"
              ? "2 actions demandent ton attention"
              : welcomeDataState === "first_use"
                ? "Aucune action encore"
                : "Aucune action requise",
        },
        {
          id: "next",
          label: "Prochain",
          value: welcomeDataState === "first_use" ? "À préciser" : "Dupont Conseil",
          hint:
            welcomeDataState === "first_use"
              ? "Pas encore d’échéance"
              : "2 450 €",
        },
      ]}
      defaultMobileNavOpen={defaultMobileNavOpen}
      composerPreviewState={params.composer === "drop" ? "drop" : undefined}
      initialComposerValue={
        params.composer === "long"
          ? "Analyse les paiements suivis pour ce mois, identifie ceux qui demandent mon attention, puis prépare un plan d’action clair en distinguant ce que Sidian peut faire maintenant de ce qui nécessite encore ma validation. Commence par le client le plus urgent et garde chaque étape courte."
          : undefined
      }
      previewComposerOffset={params.capture === "mobile" ? 24 : undefined}
    />
  );

  // L’in-app browser QA applique un DPR inverse au viewport mobile. Ce wrapper,
  // activé uniquement par la route locale de capture, restitue les 390 × 844 px
  // complets sans modifier le rendu produit.
  if (params.capture === "mobile") {
    return (
      <div
        style={{
          width: "85%",
          height: "100%",
          zoom: 0.85,
        }}
      >
        {workspace}
      </div>
    );
  }

  return workspace;
}
