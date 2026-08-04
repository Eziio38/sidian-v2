"use server";

import { getAuthenticatedUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isThemePreference } from "@/lib/theme/theme";
import { writeThemePreferenceCookie } from "@/lib/theme/theme-server";

export type ThemeActionResult = { ok: boolean };

/**
 * Enregistre la préférence d'apparence.
 *
 * Deux niveaux, volontairement distincts :
 *  - le cookie, immédiat, qui survit à un rechargement même sans session ;
 *  - la colonne `prestataire.theme_preference`, durable et propre au compte.
 *
 * Aucun identifiant de propriétaire n'est accepté depuis l'appelant : la RPC
 * dérive le prestataire de `auth.uid()`.
 */
export async function setThemePreferenceAction(
  preference: unknown,
): Promise<ThemeActionResult> {
  if (!isThemePreference(preference)) {
    return { ok: false };
  }

  await writeThemePreferenceCookie(preference);

  const user = await getAuthenticatedUser();
  if (!user) {
    // Route publique ou session expirée : le repli local suffit, et aucune
    // erreur ne doit remonter à l'utilisateur pour un choix d'affichage.
    return { ok: true };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc(
      "set_current_prestataire_theme_preference",
      { p_theme: preference },
    );
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}
