"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireConfirmedUser } from "@/lib/auth/session";
import { decideApprovalRequest } from "@/lib/approvals/approvals";
import { createClient } from "@/lib/supabase/server";

export type ApprovalActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

const decisionSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
});

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function decideApprovalAction(
  _previous: ApprovalActionResult | undefined,
  formData: FormData,
): Promise<ApprovalActionResult> {
  await requireConfirmedUser();
  const parsed = decisionSchema.safeParse({
    id: formString(formData, "id"),
    decision: formString(formData, "decision"),
  });

  if (!parsed.success) {
    return { ok: false, message: "Demande d’approbation introuvable." };
  }

  try {
    const supabase = await createClient();
    const status = await decideApprovalRequest(
      supabase,
      parsed.data.id,
      parsed.data.decision,
    );
    revalidatePath("/app");
    revalidatePath("/app/approbations");

    if (status === "expired") {
      return {
        ok: false,
        message: "Cette demande a expiré avant la décision. La liste a été actualisée.",
      };
    }

    return {
      ok: true,
      message: status === "approved" ? "Décision validée." : "Demande refusée.",
    };
  } catch {
    return {
      ok: false,
      message: "Impossible d’enregistrer la décision pour le moment.",
    };
  }
}
