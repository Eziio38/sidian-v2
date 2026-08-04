import "server-only";

import { getPrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { createClient } from "@/lib/supabase/server";

import { createSupabaseDocumentRepository } from "./supabase-repository";
import type { DocumentRepository, DocumentSession } from "./types";

/**
 * Contexte serveur des routes documents.
 *
 * Le tenant est TOUJOURS dérivé de la session (cookie SSR → `auth.getUser()` →
 * `prestataire.user_id`). Aucun identifiant fourni par l'appelant n'entre ici :
 * les RPC `document` refont d'ailleurs la même dérivation côté SQL, ce contexte
 * ne sert qu'à répondre 401 avant d'atteindre la base.
 *
 * Le dépôt est construit sur le client **session**, jamais sur service_role :
 * les policies du bucket et la RLS restent la dernière ligne de défense.
 */
export type DocumentRequestContext = {
  repository: DocumentRepository;
  session: DocumentSession;
};

export async function resolveDocumentRequestContext(): Promise<DocumentRequestContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user || !user.email_confirmed_at) return null;

  let prestataire;
  try {
    prestataire = await getPrestataireForUser(supabase, user.id);
  } catch {
    // Lookup en échec = on ne sait pas qui appelle : refus, jamais de repli.
    return null;
  }
  if (!prestataire) return null;

  return {
    repository: createSupabaseDocumentRepository(supabase),
    session: { prestataireId: prestataire.id, userId: user.id },
  };
}
