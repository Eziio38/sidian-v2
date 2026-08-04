"use server";

import { revalidatePath } from "next/cache";

import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { requireConfirmedUser } from "@/lib/auth/session";
import { configureCurrentPrestataireProfile } from "@/lib/profile/profile";
import { prestataireProfileSchema } from "@/lib/profile/schemas";
import { createClient } from "@/lib/supabase/server";

export type ProfileActionResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
      fieldErrors?: Record<string, string[]>;
    };

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function configureProfileAction(
  _previous: ProfileActionResult | undefined,
  formData: FormData,
): Promise<ProfileActionResult> {
  const user = await requireConfirmedUser();
  const parsed = prestataireProfileSchema.safeParse({
    nom: formString(formData, "nom"),
    profilAgent: formString(formData, "profilAgent"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Vérifiez les informations de votre profil.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const supabase = await createClient();
    await ensurePrestataireForUser(supabase, user);
    await configureCurrentPrestataireProfile(supabase, parsed.data);
    revalidatePath("/app");
    revalidatePath("/app/demarrage");
    revalidatePath("/app/parametres");
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: "Impossible d’enregistrer votre profil pour le moment.",
    };
  }
}
