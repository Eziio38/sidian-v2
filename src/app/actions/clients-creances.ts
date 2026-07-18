"use server";

import {
  clientPayeurSchema,
  clientPayeurUpdateSchema,
  creanceCreateSchema,
  creanceDraftSchema,
  eurosToCentsExact,
  formatZodFieldErrors,
  uuidSchema,
  type FieldErrors,
} from "@/lib/clients/schemas";
import {
  archiveCreance,
  createCreanceDraft,
  updateCreanceDraft,
} from "@/lib/creances/creance";
import { requireConfirmedUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  archiveClientPayeur,
  createClientPayeur,
  updateClientPayeur,
} from "@/lib/clients/client-payeur";
import { revalidatePath } from "next/cache";

export type ActionResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: FieldErrors };

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function mapDomainError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  if (error.message === "CLIENT_HAS_ACTIVE_CREANCES") {
    return "Ce client a encore des paiements à recevoir actifs. Archivez-les d'abord.";
  }

  if (error.message === "idempotency_payload_conflict") {
    return "Une opération identique est déjà en cours avec des données différentes.";
  }

  return fallback;
}

export async function createClientPayeurAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  await requireConfirmedUser();
  const parsed = clientPayeurSchema.safeParse({
    nom: formString(formData, "nom"),
    email: formString(formData, "email"),
    creationKey: formString(formData, "creationKey"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Vérifiez les informations du client.",
      fieldErrors: formatZodFieldErrors(parsed.error),
    };
  }

  try {
    const supabase = await createClient();
    await createClientPayeur(supabase, parsed.data);
    revalidatePath("/app/clients");
    revalidatePath("/app/paiements-a-recevoir");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: mapDomainError(
        error,
        "Impossible d'enregistrer le client pour le moment.",
      ),
    };
  }
}

export async function updateClientPayeurAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  await requireConfirmedUser();
  const idParsed = uuidSchema.safeParse(formString(formData, "id"));
  const parsed = clientPayeurUpdateSchema.safeParse({
    nom: formString(formData, "nom"),
    email: formString(formData, "email"),
  });

  if (!idParsed.success || !parsed.success) {
    return {
      ok: false,
      message: "Vérifiez les informations du client.",
      fieldErrors: {
        ...(idParsed.success
          ? {}
          : { id: ["Identifiant invalide."] }),
        ...(parsed.success ? {} : formatZodFieldErrors(parsed.error)),
      },
    };
  }

  try {
    const supabase = await createClient();
    await updateClientPayeur(supabase, {
      id: idParsed.data,
      ...parsed.data,
    });
    revalidatePath("/app/clients");
    revalidatePath("/app/paiements-a-recevoir");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: mapDomainError(
        error,
        "Impossible de modifier le client pour le moment.",
      ),
    };
  }
}

export async function archiveClientPayeurAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  await requireConfirmedUser();
  const idParsed = uuidSchema.safeParse(formString(formData, "id"));

  if (!idParsed.success) {
    return { ok: false, message: "Client introuvable." };
  }

  try {
    const supabase = await createClient();
    await archiveClientPayeur(supabase, idParsed.data);
    revalidatePath("/app/clients");
    revalidatePath("/app/paiements-a-recevoir");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: mapDomainError(
        error,
        "Impossible d'archiver le client pour le moment.",
      ),
    };
  }
}

export async function createCreanceAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  await requireConfirmedUser();
  const parsed = creanceCreateSchema.safeParse({
    clientPayeurId: formString(formData, "clientPayeurId"),
    creationKey: formString(formData, "creationKey"),
    montantEuros: formString(formData, "montantEuros"),
    devise: formString(formData, "devise") || "EUR",
    dateEcheance: formString(formData, "dateEcheance"),
    libelle: formString(formData, "libelle"),
    referenceExterne: formString(formData, "referenceExterne"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Vérifiez les informations du paiement à recevoir.",
      fieldErrors: formatZodFieldErrors(parsed.error),
    };
  }

  try {
    const supabase = await createClient();
    await createCreanceDraft(supabase, {
      clientPayeurId: parsed.data.clientPayeurId,
      creationKey: parsed.data.creationKey,
      montantCents: eurosToCentsExact(parsed.data.montantEuros),
      dateEcheance: parsed.data.dateEcheance,
      devise: parsed.data.devise,
      libelle: parsed.data.libelle || null,
      referenceExterne: parsed.data.referenceExterne || null,
    });
    revalidatePath("/app/paiements-a-recevoir");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: mapDomainError(
        error,
        "Impossible d'enregistrer le paiement à recevoir pour le moment.",
      ),
    };
  }
}

export async function updateCreanceDraftAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  await requireConfirmedUser();
  const idParsed = uuidSchema.safeParse(formString(formData, "id"));
  const parsed = creanceDraftSchema.safeParse({
    clientPayeurId: formString(formData, "clientPayeurId"),
    montantEuros: formString(formData, "montantEuros"),
    devise: formString(formData, "devise") || "EUR",
    dateEcheance: formString(formData, "dateEcheance"),
    libelle: formString(formData, "libelle"),
    referenceExterne: formString(formData, "referenceExterne"),
  });

  if (!idParsed.success || !parsed.success) {
    return {
      ok: false,
      message: "Vérifiez les informations du paiement à recevoir.",
      fieldErrors: {
        ...(idParsed.success
          ? {}
          : { id: ["Identifiant invalide."] }),
        ...(parsed.success ? {} : formatZodFieldErrors(parsed.error)),
      },
    };
  }

  try {
    const supabase = await createClient();
    await updateCreanceDraft(supabase, idParsed.data, {
      clientPayeurId: parsed.data.clientPayeurId,
      montantCents: eurosToCentsExact(parsed.data.montantEuros),
      dateEcheance: parsed.data.dateEcheance,
      devise: parsed.data.devise,
      libelle: parsed.data.libelle || null,
      referenceExterne: parsed.data.referenceExterne || null,
    });
    revalidatePath("/app/paiements-a-recevoir");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: mapDomainError(
        error,
        "Impossible de modifier le brouillon pour le moment.",
      ),
    };
  }
}

export async function archiveCreanceAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  await requireConfirmedUser();
  const idParsed = uuidSchema.safeParse(formString(formData, "id"));

  if (!idParsed.success) {
    return { ok: false, message: "Paiement à recevoir introuvable." };
  }

  try {
    const supabase = await createClient();
    await archiveCreance(supabase, idParsed.data);
    revalidatePath("/app/paiements-a-recevoir");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: mapDomainError(
        error,
        "Impossible d'archiver le paiement à recevoir pour le moment.",
      ),
    };
  }
}
