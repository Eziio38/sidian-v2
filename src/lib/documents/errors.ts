/**
 * Erreurs typées du stockage de documents.
 *
 * Le service ne « throw » jamais vers l'appelant : il renvoie un
 * `DocumentResult`. Un refus de format ou de taille est un résultat métier
 * normal, pas un incident — le distinguer d'une panne réelle évite de faire
 * remonter une 500 pour un fichier simplement non pris en charge.
 */

export const DOCUMENT_ERROR_CODES = [
  "document_filename_invalid",
  "document_mime_not_allowed",
  "document_too_large",
  "document_empty",
  "document_input_invalid",
  "document_not_found",
  "document_forbidden",
  "document_status_conflict",
  "document_object_missing",
  "document_quarantined",
  "document_storage_unavailable",
  "document_extraction_unavailable",
] as const;

export type DocumentErrorCode = (typeof DOCUMENT_ERROR_CODES)[number];

export class DocumentError extends Error {
  readonly code: DocumentErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: DocumentErrorCode,
    message?: string,
    details: Record<string, unknown> = {},
  ) {
    super(message ?? code);
    this.name = "DocumentError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export type DocumentResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DocumentError };

export function documentSuccess<T>(value: T): DocumentResult<T> {
  return { ok: true, value };
}

export function documentFailure<T = never>(
  code: DocumentErrorCode,
  message?: string,
  details?: Record<string, unknown>,
): DocumentResult<T> {
  return { ok: false, error: new DocumentError(code, message, details) };
}

/**
 * Traduit une erreur inattendue du dépôt (réseau, RPC, RLS) en erreur typée.
 * Les codes métier remontés par les RPC SQL sont reconnus au message pour ne
 * pas perdre la cause réelle derrière un « indisponible » générique.
 */
export function toDocumentError(cause: unknown): DocumentError {
  if (cause instanceof DocumentError) return cause;

  const raw = cause instanceof Error ? cause.message : String(cause ?? "");
  const known: Array<[string, DocumentErrorCode]> = [
    ["document_not_found", "document_not_found"],
    ["document_object_missing", "document_object_missing"],
    ["document_status_conflict", "document_status_conflict"],
    ["document_mime_not_allowed", "document_mime_not_allowed"],
    ["document_size_out_of_range", "document_too_large"],
    ["document_creance_out_of_scope", "document_forbidden"],
    ["document_checksum_invalid", "document_input_invalid"],
    ["prestataire_not_found", "document_forbidden"],
    ["not_authenticated", "document_forbidden"],
  ];

  for (const [needle, code] of known) {
    if (raw.includes(needle)) {
      return new DocumentError(code, raw);
    }
  }

  return new DocumentError(
    "document_storage_unavailable",
    raw || "document_storage_unavailable",
  );
}
