"use server";

/**
 * Actions serveur RGPD : export des données et clôture du compte.
 *
 * Aucune des deux ne prend d'identifiant de compte. Le tenant vient de la
 * session serveur, et les RPC sous-jacentes le redérivent de `auth.uid()` :
 * un paramètre hostile ne peut désigner ni exporter ni clôturer le compte d'un
 * autre prestataire.
 *
 * La surface d'interface (page Paramètres) appartient à un autre chantier :
 * ce module n'expose que les actions et leurs types de retour.
 */

import { closeAccount, exportAccountData } from "@/lib/account/service";
import {
  buildAccountExportFilename,
  summariseAccountClosure,
} from "@/lib/account/reporting";
import type {
  AccountClosureReport,
  AccountExport,
} from "@/lib/account/types";
import { requireConfirmedUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type AccountExportActionResult =
  | {
      ok: true;
      filename: string;
      /** JSON déjà sérialisé, prêt à être proposé au téléchargement. */
      content: string;
      export: AccountExport;
    }
  | { ok: false; message: string };

export type AccountClosureActionResult =
  | {
      ok: true;
      report: AccountClosureReport;
      /** Phrases à afficher telles quelles — elles disent ce qui reste conservé. */
      summary: string[];
    }
  | { ok: false; message: string };

/**
 * Produit l'export JSON des données du prestataire authentifié.
 *
 * Contenu : profil, clients, créances, tentatives de paiement, paiements,
 * conversations, messages, et **métadonnées** des documents. Le contenu des
 * fichiers n'y figure pas — il se télécharge depuis l'application, et l'export
 * le dit explicitement plutôt que de laisser croire à une copie complète.
 */
export async function exportAccountDataAction(): Promise<AccountExportActionResult> {
  await requireConfirmedUser();

  const supabase = await createClient();
  const result = await exportAccountData(supabase);

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  return {
    ok: true,
    filename: buildAccountExportFilename(new Date()),
    content: JSON.stringify(result.value, null, 2),
    export: result.value,
  };
}

/**
 * Clôture le compte : anonymisation de l'identité, effacement du contenu
 * conversationnel, suppression des documents, révocation d'accès.
 *
 * ATTENTION — ce n'est PAS un effacement complet. Les pièces comptables
 * (clients, créances, paiements) sont conservées au titre de l'obligation
 * légale de conservation. Le rapport retourné en porte le décompte et
 * `summary` contient la phrase à afficher : ne jamais présenter cette action
 * comme une suppression totale.
 *
 * `confirmation` doit reprendre exactement l'adresse email du compte. Ce
 * garde-fou est délibéré : l'opération est irréversible et aucune réouverture
 * n'est implémentée.
 */
export async function closeAccountAction(
  _previous: AccountClosureActionResult | undefined,
  formData: FormData,
): Promise<AccountClosureActionResult> {
  const user = await requireConfirmedUser();

  const rawConfirmation = formData.get("confirmation");
  const confirmation =
    typeof rawConfirmation === "string" ? rawConfirmation.trim() : "";
  const expected = (user.email ?? "").trim();

  if (
    expected === "" ||
    confirmation.toLocaleLowerCase("fr") !== expected.toLocaleLowerCase("fr")
  ) {
    return {
      ok: false,
      message:
        "Saisissez l’adresse email de votre compte pour confirmer la clôture.",
    };
  }

  const supabase = await createClient();
  const admin = await createAdminClient();

  const result = await closeAccount({
    session: supabase,
    admin,
    userId: user.id,
  });

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  return {
    ok: true,
    report: result.value,
    summary: summariseAccountClosure(result.value),
  };
}
