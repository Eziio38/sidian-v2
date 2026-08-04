/**
 * Traduction HTTP des erreurs typées du stockage de documents.
 *
 * Séparé des routes pour que la table de correspondance soit testable sans
 * démarrer Next : un refus de format (415) et une panne de stockage (503) ne
 * doivent jamais être confondus, sinon l'interface ne peut pas dire
 * honnêtement à l'utilisateur si son fichier est refusé ou si le service est
 * momentanément indisponible.
 */

import type { DocumentError, DocumentErrorCode } from "./errors";

/** En-têtes communs : une réponse portant une URL signée ne doit jamais être mise en cache. */
export const DOCUMENT_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
} as const;

const STATUS_BY_CODE: Record<DocumentErrorCode, number> = {
  document_filename_invalid: 400,
  document_input_invalid: 400,
  document_empty: 400,
  document_mime_not_allowed: 415,
  document_too_large: 413,
  document_not_found: 404,
  document_forbidden: 403,
  document_status_conflict: 409,
  document_object_missing: 409,
  document_quarantined: 422,
  document_storage_unavailable: 503,
  // Aucune extraction n'existe : le jour où une route l'exposerait, 501 dit
  // « non implémenté », jamais « échec temporaire ».
  document_extraction_unavailable: 501,
};

/**
 * Messages sortants.
 *
 * Les codes « infrastructure » ne réutilisent JAMAIS `error.message` : celui-ci
 * transporte le texte brut d'une RPC ou du stockage (chemins, noms de
 * fonctions, contraintes) et n'a rien à faire dans une réponse navigateur.
 * Les refus métier, eux, sont déjà rédigés en français par le service et
 * doivent parvenir tels quels : ils expliquent à l'utilisateur quoi changer.
 */
const OPAQUE_MESSAGE_BY_CODE: Partial<Record<DocumentErrorCode, string>> = {
  document_storage_unavailable:
    "Le stockage des documents est momentanément indisponible.",
  document_forbidden: "Cette action n’est pas autorisée.",
  document_not_found: "Document introuvable.",
  document_status_conflict:
    "Ce document n’est plus dans un état permettant cette opération.",
  document_object_missing:
    "Le contenu de ce fichier n’a pas été reçu par le stockage.",
};

export function documentErrorStatus(code: DocumentErrorCode): number {
  return STATUS_BY_CODE[code] ?? 500;
}

export function documentErrorMessage(error: DocumentError): string {
  return OPAQUE_MESSAGE_BY_CODE[error.code] ?? error.message;
}

export function documentErrorResponse(error: DocumentError): Response {
  return Response.json(
    { code: error.code, message: documentErrorMessage(error) },
    {
      status: documentErrorStatus(error.code),
      headers: DOCUMENT_NO_STORE_HEADERS,
    },
  );
}
