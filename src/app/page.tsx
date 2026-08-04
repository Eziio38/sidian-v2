import { redirect } from "next/navigation";

import { redirectIfAuthenticated } from "@/lib/auth/session";

/**
 * Racine du domaine — jamais destinée à afficher du contenu elle-même.
 * Un visiteur déjà connecté rejoint directement /app ; sinon, l'écran de
 * connexion. L'ancien écran « Socle technique initialisé » (statut de build)
 * n'a jamais été routé ailleurs depuis le tout premier scaffold du projet.
 */
export default async function Home() {
  await redirectIfAuthenticated();
  redirect("/connexion");
}
