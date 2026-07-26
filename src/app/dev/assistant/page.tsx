import { notFound } from "next/navigation";

import { ConversationalWorkspace } from "@/components/assistant";
import { isDemoStateId } from "@/components/assistant/demo-states";

export const dynamic = "force-dynamic";

/**
 * Preview locale G1-O — jamais exposée en production déployée.
 * Ouverture locale :
 * - `pnpm exec next dev --webpack -H 127.0.0.1 -p 3020`
 * - ou `SIDIAN_ALLOW_DEV_ASSISTANT_PREVIEW=1 pnpm exec next start -H 127.0.0.1 -p 3030`
 * Ne contourne pas `/app/assistant` (auth obligatoire).
 */
type DevAssistantPreviewPageProps = {
  searchParams: Promise<{ demo?: string; viewport?: string }>;
};

function isAssistantPreviewAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.SIDIAN_ALLOW_DEV_ASSISTANT_PREVIEW === "1";
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

  return (
    <ConversationalWorkspace
      key={`${demoState}-${viewport ?? "auto"}`}
      userFirstName="Lucie"
      userDisplayName="Lucie Martin"
      demoState={demoState}
      viewport={viewport}
    />
  );
}
