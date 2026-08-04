import {
  DocumentError,
  documentFailure,
  documentSuccess,
  toDocumentError,
  type DocumentResult,
} from "./errors";
import {
  DOCUMENT_DOWNLOAD_URL_MAX_TTL_SECONDS,
  DOCUMENT_DOWNLOAD_URL_TTL_SECONDS,
  DOCUMENT_MAX_SIZE_BYTES,
  ABANDONED_DOCUMENT_UPLOAD_TTL_HOURS,
  cleanupAbandonedUploadsSchema,
  confirmDocumentUploadSchema,
  documentFilenameSchema,
  documentSizeBytesSchema,
  downloadDocumentSchema,
  isAllowedDocumentMimeType,
  listDocumentsSchema,
  normaliseDocumentMimeType,
} from "./schemas";
import type {
  DocumentDownloadUrl,
  DocumentMaintenanceRepository,
  DocumentRecord,
  DocumentRepository,
  DocumentUploadTicket,
  ListDocumentsInput,
  RegisterDocumentUploadInput,
} from "./types";

/**
 * Service de stockage de documents.
 *
 * Aucune fonction ne prend d'identifiant de tenant : le dépôt est déjà lié à
 * une session serveur. Aucune fonction ne lève : les refus de format, de
 * taille ou de portée sont des résultats typés.
 */

function firstZodMessage(error: unknown, fallback: string): string {
  const issues = (error as { issues?: Array<{ message?: string }> })?.issues;
  return issues?.[0]?.message ?? fallback;
}

/**
 * Validation champ par champ plutôt qu'un `parse` global : le code d'erreur
 * doit dire *pourquoi* le fichier est refusé, sinon l'interface ne peut pas
 * expliquer à l'utilisateur ce qu'il doit changer.
 */
export function validateRegisterDocumentUploadInput(
  input: RegisterDocumentUploadInput,
): DocumentResult<{
  filename: string;
  mimeType: string;
  sizeBytes: number;
  creanceId: string | null;
}> {
  const filename = documentFilenameSchema.safeParse(input.filename);
  if (!filename.success) {
    return documentFailure(
      "document_filename_invalid",
      firstZodMessage(filename.error, "Nom de fichier invalide."),
    );
  }

  const size = documentSizeBytesSchema.safeParse(input.sizeBytes);
  if (!size.success) {
    if (
      typeof input.sizeBytes === "number" &&
      Number.isInteger(input.sizeBytes) &&
      input.sizeBytes > DOCUMENT_MAX_SIZE_BYTES
    ) {
      return documentFailure(
        "document_too_large",
        "Le fichier dépasse la limite autorisée.",
        { maxSizeBytes: DOCUMENT_MAX_SIZE_BYTES, sizeBytes: input.sizeBytes },
      );
    }
    if (input.sizeBytes === 0) {
      return documentFailure("document_empty", "Le fichier est vide.");
    }
    return documentFailure(
      "document_input_invalid",
      firstZodMessage(size.error, "Taille de fichier invalide."),
    );
  }

  if (!isAllowedDocumentMimeType(input.mimeType ?? "")) {
    return documentFailure(
      "document_mime_not_allowed",
      "Ce format de fichier n’est pas pris en charge.",
      { mimeType: normaliseDocumentMimeType(input.mimeType ?? "") },
    );
  }

  const creanceId = input.creanceId ?? null;
  if (creanceId !== null && !isUuid(creanceId)) {
    return documentFailure(
      "document_input_invalid",
      "Identifiant de créance invalide.",
    );
  }

  return documentSuccess({
    filename: filename.data,
    mimeType: normaliseDocumentMimeType(input.mimeType),
    sizeBytes: size.data,
    creanceId,
  });
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Réserve une ligne `document` puis signe l'URL d'upload.
 *
 * Le chemin de stockage n'est jamais choisi par l'appelant : il est calculé
 * côté base à partir de la session.
 */
export async function registerDocumentUpload(
  repository: DocumentRepository,
  input: RegisterDocumentUploadInput,
): Promise<DocumentResult<DocumentUploadTicket>> {
  const validated = validateRegisterDocumentUploadInput(input);
  if (!validated.ok) return validated;

  try {
    const document = await repository.register(validated.value);
    const upload = await repository.createUploadUrl(document);
    return documentSuccess({ document, ...upload });
  } catch (cause) {
    return { ok: false, error: toDocumentError(cause) };
  }
}

/**
 * Confirme que les octets sont présents. Le document passe alors en
 * `awaiting_processing` : il est stocké, et son contenu n'a jamais été
 * analysé — c'est l'état terminal actuel.
 */
export async function confirmDocumentUpload(
  repository: DocumentRepository,
  input: { documentId: string; checksum?: string | null },
): Promise<DocumentResult<DocumentRecord>> {
  const parsed = confirmDocumentUploadSchema.safeParse(input);
  if (!parsed.success) {
    return documentFailure(
      "document_input_invalid",
      firstZodMessage(parsed.error, "Requête invalide."),
    );
  }

  try {
    const document = await repository.confirm({
      documentId: parsed.data.documentId,
      checksum: parsed.data.checksum ?? null,
    });

    if (document.status === "quarantined") {
      return documentFailure(
        "document_quarantined",
        "Le fichier reçu ne correspond pas à ce qui avait été annoncé.",
        { documentId: document.id },
      );
    }

    return documentSuccess(document);
  } catch (cause) {
    return { ok: false, error: toDocumentError(cause) };
  }
}

export async function getDocument(
  repository: DocumentRepository,
  documentId: string,
): Promise<DocumentResult<DocumentRecord>> {
  if (!isUuid(documentId)) {
    return documentFailure(
      "document_input_invalid",
      "Identifiant de document invalide.",
    );
  }

  try {
    const document = await repository.get(documentId);
    // Hors tenant et inexistant renvoient la même erreur : l'existence d'un
    // document d'un autre prestataire ne doit pas être observable.
    if (!document || document.status === "deleted") {
      return documentFailure("document_not_found", "Document introuvable.");
    }
    return documentSuccess(document);
  } catch (cause) {
    return { ok: false, error: toDocumentError(cause) };
  }
}

export async function listDocuments(
  repository: DocumentRepository,
  input: ListDocumentsInput = {},
): Promise<DocumentResult<DocumentRecord[]>> {
  const parsed = listDocumentsSchema.safeParse(input);
  if (!parsed.success) {
    return documentFailure(
      "document_input_invalid",
      firstZodMessage(parsed.error, "Requête invalide."),
    );
  }

  try {
    const documents = await repository.list({
      creanceId: parsed.data.creanceId ?? null,
      includeDeleted: parsed.data.includeDeleted ?? false,
      limit: parsed.data.limit ?? 50,
      offset: parsed.data.offset ?? 0,
    });
    return documentSuccess(documents);
  } catch (cause) {
    return { ok: false, error: toDocumentError(cause) };
  }
}

/**
 * URL de téléchargement signée à durée courte. Le bucket reste privé : aucune
 * URL publique n'est jamais produite.
 */
export async function createDocumentDownloadUrl(
  repository: DocumentRepository,
  input: { documentId: string; ttlSeconds?: number },
): Promise<DocumentResult<DocumentDownloadUrl>> {
  const parsed = downloadDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return documentFailure(
      "document_input_invalid",
      firstZodMessage(parsed.error, "Requête invalide."),
    );
  }

  const ttlSeconds = Math.min(
    parsed.data.ttlSeconds ?? DOCUMENT_DOWNLOAD_URL_TTL_SECONDS,
    DOCUMENT_DOWNLOAD_URL_MAX_TTL_SECONDS,
  );

  const found = await getDocument(repository, parsed.data.documentId);
  if (!found.ok) return found;

  if (found.value.status === "quarantined") {
    return documentFailure(
      "document_quarantined",
      "Ce document est en quarantaine et n’est pas restituable.",
    );
  }
  if (found.value.status === "pending_upload") {
    return documentFailure(
      "document_object_missing",
      "Le téléversement de ce document n’a jamais été confirmé.",
    );
  }

  try {
    const url = await repository.createDownloadUrl({
      document: found.value,
      ttlSeconds,
    });
    return documentSuccess({
      documentId: found.value.id,
      url,
      expiresInSeconds: ttlSeconds,
    });
  } catch (cause) {
    return { ok: false, error: toDocumentError(cause) };
  }
}

/**
 * Suppression logique. Les octets restent dans le bucket : leur purge dépend
 * d'une durée de rétention que le propriétaire n'a pas encore arbitrée
 * (cf. docs/DOCUMENT_STORAGE.md).
 */
export async function softDeleteDocument(
  repository: DocumentRepository,
  documentId: string,
): Promise<DocumentResult<DocumentRecord>> {
  if (!isUuid(documentId)) {
    return documentFailure(
      "document_input_invalid",
      "Identifiant de document invalide.",
    );
  }

  try {
    return documentSuccess(await repository.softDelete(documentId));
  } catch (cause) {
    return { ok: false, error: toDocumentError(cause) };
  }
}

export type CleanupAbandonedUploadsReport = {
  purged: number;
  storagePaths: string[];
  /** `false` quand les lignes ont été marquées mais les octets non retirés. */
  objectsRemoved: boolean;
};

/**
 * Ménage des uploads jamais confirmés : marquage logique puis retrait des
 * octets. Opération transverse — appelable uniquement avec un dépôt de
 * maintenance service_role.
 */
export async function cleanupAbandonedDocumentUploads(
  maintenance: DocumentMaintenanceRepository,
  input: { olderThanHours?: number; limit?: number } = {},
): Promise<DocumentResult<CleanupAbandonedUploadsReport>> {
  const parsed = cleanupAbandonedUploadsSchema.safeParse(input);
  if (!parsed.success) {
    return documentFailure(
      "document_input_invalid",
      firstZodMessage(parsed.error, "Requête invalide."),
    );
  }

  const olderThanHours =
    parsed.data.olderThanHours ?? ABANDONED_DOCUMENT_UPLOAD_TTL_HOURS;
  const limit = parsed.data.limit ?? 500;

  let purged: Array<{ id: string; storagePath: string }>;
  try {
    purged = await maintenance.purgeAbandonedUploads({ olderThanHours, limit });
  } catch (cause) {
    return { ok: false, error: toDocumentError(cause) };
  }

  const storagePaths = purged.map((item) => item.storagePath);
  if (storagePaths.length === 0) {
    return documentSuccess({ purged: 0, storagePaths, objectsRemoved: true });
  }

  try {
    await maintenance.removeObjects(storagePaths);
  } catch (cause) {
    // Les lignes sont déjà marquées supprimées : ne pas prétendre que les
    // octets ont disparu. Le prochain passage ne les reverra pas, l'écart est
    // donc signalé plutôt qu'avalé.
    return {
      ok: false,
      error: new DocumentError(
        "document_storage_unavailable",
        `Lignes purgées mais octets non retirés : ${
          toDocumentError(cause).message
        }`,
        { storagePaths },
      ),
    };
  }

  return documentSuccess({
    purged: storagePaths.length,
    storagePaths,
    objectsRemoved: true,
  });
}
