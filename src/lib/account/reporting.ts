/**
 * Formulation honnête d'une clôture de compte.
 *
 * Le point sensible de tout ce module est là : la clôture n'efface pas tout.
 * Ces fonctions existent pour que l'interface ne puisse pas écrire « votre
 * compte a été entièrement supprimé » sans passer par une phrase qui dit ce
 * qui reste réellement en base et pourquoi.
 */

import type { AccountClosureReport } from "./types";

export const ACCOUNT_CLOSURE_LEGAL_NOTICE =
  "Vos factures, paiements et clients associés sont conservés : la loi impose de garder les pièces comptables. Le reste de votre compte a été anonymisé.";

export function buildAccountExportFilename(generatedAt: Date): string {
  const stamp = generatedAt.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `sidian-export-${stamp}.json`;
}

/**
 * Résumé destiné à l'utilisateur. Chaque écart réel (octets non retirés,
 * accès non révoqué) produit une phrase — un échec partiel ne doit jamais
 * ressembler à un succès.
 */
export function summariseAccountClosure(
  report: AccountClosureReport,
): string[] {
  if (report.alreadyClosed) {
    return ["Ce compte était déjà clôturé.", ACCOUNT_CLOSURE_LEGAL_NOTICE];
  }

  const lines = [
    "Votre compte est clôturé et vos données personnelles ont été anonymisées.",
    ACCOUNT_CLOSURE_LEGAL_NOTICE,
  ];

  if (report.storageObjectsCount > 0 && !report.storageObjectsRemoved) {
    lines.push(
      "Vos documents ont été retirés de l’application, mais leurs fichiers n’ont pas pu être effacés du stockage. Contactez le support pour finaliser cette suppression.",
    );
  }

  if (!report.authIdentityRevoked) {
    lines.push(
      "Votre accès n’a pas pu être révoqué complètement. Contactez le support sans attendre.",
    );
  }

  return lines;
}
