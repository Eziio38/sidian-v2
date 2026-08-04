import "server-only";

import { getPrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { createClient } from "@/lib/supabase/server";

export async function resolveAssistantConversationRequestContext() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user || !user.email_confirmed_at) return null;
  const prestataire = await getPrestataireForUser(supabase, user.id);
  if (!prestataire) return null;
  return { supabase, user, prestataire };
}
