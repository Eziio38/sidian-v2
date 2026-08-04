import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import type { Database } from "@/types/database.generated";
import {
  DEFAULT_THEME_PREFERENCE,
  parseThemePreference,
  THEME_COOKIE_MAX_AGE_SECONDS,
  THEME_COOKIE_NAME,
  type ThemePreference,
} from "./theme";

/**
 * Préférence d'apparence connue du serveur.
 *
 * Le cookie est la seule source lisible au rendu du layout racine : celui-ci
 * couvre aussi les pages publiques (connexion, paiement client), où aucune
 * session n'existe. La base reste la source de vérité par compte ; le cookie
 * n'en est que la projection, réécrite à chaque connexion.
 */
export async function readThemePreferenceCookie(): Promise<ThemePreference> {
  try {
    const store = await cookies();
    return parseThemePreference(store.get(THEME_COOKIE_NAME)?.value);
  } catch {
    // `cookies()` échoue hors contexte de requête : le défaut produit s'applique.
    return DEFAULT_THEME_PREFERENCE;
  }
}

/**
 * Écrit la projection cookie.
 *
 * Non `HttpOnly` : le script anti-flash doit pouvoir la lire avant la première
 * peinture. La valeur n'est pas un secret — c'est un choix d'affichage.
 */
export async function writeThemePreferenceCookie(
  preference: ThemePreference,
): Promise<void> {
  const store = await cookies();
  store.set(THEME_COOKIE_NAME, preference, {
    path: "/",
    maxAge: THEME_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });
}

/**
 * Efface la préférence locale.
 *
 * Appelé à la déconnexion : sans cela, la préférence du compte précédent
 * resterait appliquée sur le poste, et deux comptes partageant un navigateur
 * ne seraient plus isolés.
 */
export async function clearThemePreferenceCookie(): Promise<void> {
  try {
    const store = await cookies();
    store.delete(THEME_COOKIE_NAME);
  } catch {
    // Rien à faire : un cookie non effacé n'est pas une erreur bloquante.
  }
}

/**
 * Aligne le cookie sur la préférence du compte qui vient de se connecter.
 *
 * Best-effort : une préférence d'affichage ne doit jamais faire échouer une
 * connexion. En cas d'échec, le repli local reste en place.
 */
export async function syncThemePreferenceCookieFromAccount(
  supabase: SupabaseClient<Database>,
): Promise<void> {
  try {
    const { data, error } = await supabase
      .from("prestataire")
      .select("theme_preference")
      .single();

    if (error || !data) return;
    await writeThemePreferenceCookie(
      parseThemePreference(data.theme_preference),
    );
  } catch {
    // Ignoré volontairement : voir ci-dessus.
  }
}
