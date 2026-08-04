import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.generated";

import {
  NOTIFICATION_PREFERENCE_DEFAULTS,
  toNotificationPreferences,
  type NotificationPreferences,
} from "./catalogue";

/**
 * Lecture / écriture des préférences de notification.
 *
 * Le tenant n'apparaît dans AUCUNE signature : la lecture passe par le client
 * utilisateur sous RLS, l'écriture par une RPC `security definer` qui redérive
 * le prestataire de `auth.uid()`. Un identifiant fourni par l'appelant n'aurait
 * nulle part où entrer.
 */

type UserClient = SupabaseClient<Database>;

/**
 * Aucune ligne ⇒ défauts. Une erreur de lecture ⇒ défauts également, parce que
 * l'écran de réglages doit rester consultable ; le comportement affiché reste
 * alors celui du runtime, donc jamais un état inventé.
 */
export async function getNotificationPreferences(
  supabase: UserClient,
): Promise<NotificationPreferences> {
  const { data, error } = await supabase
    .from("notification_preference")
    .select("email_reminder_before_due, email_payment_failed")
    .maybeSingle();

  if (error) {
    return { ...NOTIFICATION_PREFERENCE_DEFAULTS };
  }

  return toNotificationPreferences(data);
}

export type NotificationPreferencesWriteResult =
  | { ok: true; preferences: NotificationPreferences }
  | { ok: false };

export async function setNotificationPreferences(
  supabase: UserClient,
  preferences: NotificationPreferences,
): Promise<NotificationPreferencesWriteResult> {
  const { data, error } = await supabase.rpc(
    "set_current_prestataire_notification_preferences",
    {
      p_email_reminder_before_due: preferences.reminderBeforeDue,
      p_email_payment_failed: preferences.paymentFailed,
    },
  );

  if (error || !data) {
    return { ok: false };
  }

  return { ok: true, preferences: toNotificationPreferences(data) };
}
