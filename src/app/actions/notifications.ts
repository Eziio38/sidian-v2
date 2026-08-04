"use server";

/**
 * Action serveur des préférences de notification.
 *
 * Elle ne prend aucun identifiant de compte : la RPC sous-jacente redérive le
 * prestataire de `auth.uid()`. Un `prestataireId` glissé dans le `FormData`
 * n'aurait aucun effet — il n'est jamais lu.
 */

import { revalidatePath } from "next/cache";

import { requireConfirmedUser } from "@/lib/auth/session";
import { readNotificationPreferencesFromFormData } from "@/lib/notification-preferences";
import { setNotificationPreferences } from "@/lib/notification-preferences/server";
import { createClient } from "@/lib/supabase/server";

export type NotificationPreferencesActionResult =
  | { ok: true }
  | { ok: false; message: string };

export async function updateNotificationPreferencesAction(
  _previous: NotificationPreferencesActionResult | undefined,
  formData: FormData,
): Promise<NotificationPreferencesActionResult> {
  await requireConfirmedUser();

  // Une case décochée n'est pas envoyée par le navigateur : l'absence vaut
  // désactivation explicite, jamais « inchangé ».
  const preferences = readNotificationPreferencesFromFormData(formData);

  try {
    const supabase = await createClient();
    const result = await setNotificationPreferences(supabase, preferences);

    if (!result.ok) {
      return {
        ok: false,
        message:
          "Impossible d’enregistrer tes préférences de notification pour le moment.",
      };
    }

    revalidatePath("/app/parametres");
    return { ok: true };
  } catch {
    return {
      ok: false,
      message:
        "Impossible d’enregistrer tes préférences de notification pour le moment.",
    };
  }
}
