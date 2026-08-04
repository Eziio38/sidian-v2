import { z } from "zod";

/**
 * Contrats de validation des documents.
 *
 * Chaque constante de ce fichier a un jumeau SQL dans
 * `supabase/migrations/20260803140000_document_storage.sql`. Les deux doivent
 * bouger ensemble : la base est la dernière ligne de défense, pas une copie
 * décorative de Zod.
 */

/**
 * Plafond de taille d'un document.
 *
 * Jumeau SQL : `public.document_max_size_bytes()`.
 *
 * Valeur retenue = 20 MiB, alignée sur `MAX_DOCUMENT_FILE_SIZE` déjà appliqué
 * par le composer (src/components/assistant/document-attachments.ts). Choisir
 * une valeur différente ici ferait accepter côté interface des fichiers que le
 * stockage refuserait ensuite. Le propriétaire peut vouloir revoir ce plafond
 * (coût de stockage, taille réelle des factures scannées) — cf.
 * docs/DOCUMENT_STORAGE.md.
 */
export const DOCUMENT_MAX_SIZE_BYTES = 20 * 1024 * 1024;

/**
 * Allowlist MIME. Jumeau SQL : `public.document_allowed_mime_types()`.
 *
 * Les archives sont volontairement absentes : un conteneur opaque ne peut être
 * ni contrôlé ni restitué honnêtement tant qu'aucune analyse de contenu
 * n'existe.
 */
export const DOCUMENT_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export type DocumentMimeType = (typeof DOCUMENT_ALLOWED_MIME_TYPES)[number];

const ALLOWED_MIME_SET: ReadonlySet<string> = new Set(
  DOCUMENT_ALLOWED_MIME_TYPES,
);

/** Nom du bucket privé. Jumeau SQL : `storage.buckets.id = 'documents'`. */
export const DOCUMENT_STORAGE_BUCKET = "documents";

/** Longueur maximale du nom assaini inscrit dans le chemin. Jumeau SQL : `left(v_name, 120)`. */
export const DOCUMENT_FILENAME_MAX_LENGTH = 120;

/** Ancienneté au-delà de laquelle un `pending_upload` est considéré abandonné. */
export const ABANDONED_DOCUMENT_UPLOAD_TTL_HOURS = 24;

/** TTL par défaut d'une URL de téléchargement signée — volontairement court. */
export const DOCUMENT_DOWNLOAD_URL_TTL_SECONDS = 60;

/** Plafond dur du TTL de téléchargement : une URL signée est un secret porteur. */
export const DOCUMENT_DOWNLOAD_URL_MAX_TTL_SECONDS = 300;

/** Segment `.` ou `..` complet dans un chemin. */
const PATH_TRAVERSAL_PATTERN = /(^|[\\/])\.\.?([\\/]|$)/;

const CONTROL_CHARACTERS_PATTERN = /[\u0000-\u001f\u007f]/;

export function normaliseDocumentMimeType(value: string): string {
  return value.trim().toLocaleLowerCase("en");
}

export function isAllowedDocumentMimeType(
  value: string,
): value is DocumentMimeType {
  return ALLOWED_MIME_SET.has(normaliseDocumentMimeType(value));
}

/**
 * Assainit un nom de fichier. Miroir exact — mêmes opérations, même ordre — du
 * bloc d'assainissement de `public.register_document_upload`.
 *
 * Défense en profondeur : `documentFilenameSchema` refuse déjà tout nom
 * contenant un séparateur. Cette fonction existe pour que le chemin calculé
 * côté test et côté SQL soit identique, jamais pour rattraper une entrée
 * hostile acceptée en amont.
 */
export function sanitiseDocumentFilename(raw: string): string {
  const withoutPath = (raw ?? "").replace(/^.*[/\\]/, "");
  const safe = withoutPath
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^\.+/, "")
    .slice(0, DOCUMENT_FILENAME_MAX_LENGTH);

  return safe.trim() === "" ? "document" : safe;
}

/** Convention de chemin par tenant. Jumeau SQL : `document_storage_path_convention`. */
export function buildDocumentStoragePath(input: {
  prestataireId: string;
  documentId: string;
  filename: string;
}): string {
  return `${input.prestataireId}/${input.documentId}/${sanitiseDocumentFilename(
    input.filename,
  )}`;
}

export const documentFilenameSchema = z
  .string()
  .trim()
  .min(1, "Nom de fichier requis.")
  .max(255, "Nom de fichier trop long.")
  .refine(
    (value) => !/[\\/]/.test(value),
    "Un nom de fichier ne peut pas contenir de chemin.",
  )
  .refine(
    (value) => !PATH_TRAVERSAL_PATTERN.test(value),
    "Un nom de fichier ne peut pas remonter dans l’arborescence.",
  )
  .refine(
    (value) => !value.startsWith("."),
    "Un nom de fichier ne peut pas commencer par un point.",
  )
  .refine(
    (value) => !CONTROL_CHARACTERS_PATTERN.test(value),
    "Un nom de fichier ne peut pas contenir de caractère de contrôle.",
  );

export const documentMimeTypeSchema = z
  .string()
  .refine(
    (value) => isAllowedDocumentMimeType(value),
    "Ce format de fichier n’est pas pris en charge.",
  )
  .transform((value) => normaliseDocumentMimeType(value) as DocumentMimeType);

export const documentSizeBytesSchema = z
  .number()
  .int("Taille de fichier invalide.")
  .min(1, "Le fichier est vide.")
  .max(DOCUMENT_MAX_SIZE_BYTES, "Le fichier dépasse la limite autorisée.");

/** SHA-256 hexadécimal. Jumeau SQL : `document_checksum_shape`. */
export const documentChecksumSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Empreinte SHA-256 invalide.");

export const registerDocumentUploadSchema = z.object({
  filename: documentFilenameSchema,
  mimeType: documentMimeTypeSchema,
  sizeBytes: documentSizeBytesSchema,
  creanceId: z.uuid("Identifiant de créance invalide.").nullish(),
});

export type RegisterDocumentUploadPayload = z.infer<
  typeof registerDocumentUploadSchema
>;

export const confirmDocumentUploadSchema = z.object({
  documentId: z.uuid("Identifiant de document invalide."),
  checksum: documentChecksumSchema.nullish(),
});

export const listDocumentsSchema = z.object({
  creanceId: z.uuid("Identifiant de créance invalide.").nullish(),
  includeDeleted: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

export const downloadDocumentSchema = z.object({
  documentId: z.uuid("Identifiant de document invalide."),
  ttlSeconds: z
    .number()
    .int()
    .min(5)
    .max(DOCUMENT_DOWNLOAD_URL_MAX_TTL_SECONDS)
    .optional(),
});

export const cleanupAbandonedUploadsSchema = z.object({
  olderThanHours: z.number().int().min(1).max(24 * 30).optional(),
  limit: z.number().int().min(1).max(5000).optional(),
});
