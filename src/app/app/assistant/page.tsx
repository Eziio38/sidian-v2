import { ConversationalWorkspace } from "@/components/assistant";
import { isDemoStateId } from "@/components/assistant/demo-states";
import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { requireConfirmedUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

type AssistantPageProps = {
  searchParams: Promise<{ demo?: string }>;
};

function firstNameFrom(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const token = value.trim().split(/\s+/)[0];
  return token || fallback;
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

  return (
    <ConversationalWorkspace
      key={demoState ?? "live"}
      userFirstName={userFirstName}
      userDisplayName={prestataire.nom || userFirstName}
      demoState={demoState}
    />
  );
}
