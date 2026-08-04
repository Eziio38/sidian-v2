export {
  DOCUMENT_ERROR_CODES,
  DocumentError,
  documentFailure,
  documentSuccess,
  toDocumentError,
  type DocumentErrorCode,
  type DocumentResult,
} from "./errors";

export {
  ABANDONED_DOCUMENT_UPLOAD_TTL_HOURS,
  DOCUMENT_ALLOWED_MIME_TYPES,
  DOCUMENT_DOWNLOAD_URL_MAX_TTL_SECONDS,
  DOCUMENT_DOWNLOAD_URL_TTL_SECONDS,
  DOCUMENT_FILENAME_MAX_LENGTH,
  DOCUMENT_MAX_SIZE_BYTES,
  DOCUMENT_STORAGE_BUCKET,
  buildDocumentStoragePath,
  cleanupAbandonedUploadsSchema,
  confirmDocumentUploadSchema,
  documentChecksumSchema,
  documentFilenameSchema,
  documentMimeTypeSchema,
  documentSizeBytesSchema,
  downloadDocumentSchema,
  isAllowedDocumentMimeType,
  listDocumentsSchema,
  normaliseDocumentMimeType,
  registerDocumentUploadSchema,
  sanitiseDocumentFilename,
  type DocumentMimeType,
  type RegisterDocumentUploadPayload,
} from "./schemas";

export type {
  AbandonedUploadPurgeItem,
  DocumentDownloadUrl,
  DocumentMaintenanceRepository,
  DocumentRecord,
  DocumentRepository,
  DocumentSession,
  DocumentStatus,
  DocumentUploadTicket,
  DocumentUploadUrl,
  ListDocumentsInput,
  RegisterDocumentUploadInput,
} from "./types";

export {
  cleanupAbandonedDocumentUploads,
  confirmDocumentUpload,
  createDocumentDownloadUrl,
  getDocument,
  listDocuments,
  registerDocumentUpload,
  softDeleteDocument,
  validateRegisterDocumentUploadInput,
  type CleanupAbandonedUploadsReport,
} from "./service";

export {
  DOCUMENT_EXTRACTION_UNAVAILABLE_MESSAGE,
  disabledDocumentExtractionProvider,
  documentExtractionUnavailableError,
  isDocumentExtractionAvailable,
  type DocumentExtractionKind,
  type DocumentExtractionOutcome,
  type DocumentExtractionProvider,
  type DocumentExtractionRequest,
  type DocumentExtractionUnavailableReason,
} from "./extraction";

export {
  createMemoryDocumentMaintenance,
  createMemoryDocumentRepository,
  createMemoryDocumentStore,
  putMemoryDocumentObject,
  type MemoryDocumentMaintenanceOptions,
  type MemoryDocumentRepositoryOptions,
  type MemoryDocumentStore,
  type MemoryStoredObject,
} from "./memory-repository";

export {
  createSupabaseDocumentMaintenance,
  createSupabaseDocumentRepository,
  type DocumentStorageBucketClient,
  type DocumentSupabaseClient,
} from "./supabase-repository";

export {
  DOCUMENT_NO_STORE_HEADERS,
  documentErrorMessage,
  documentErrorResponse,
  documentErrorStatus,
} from "./http";

// `server-context` et `cron-purge` sont volontairement absents de ce baril :
// ils importent `server-only` et ne doivent jamais être tirés dans un bundle
// navigateur par une importation de commodité.
export {
  DOCUMENT_UPLOAD_GENERIC_ERROR,
  persistDocumentAttachment,
  type DocumentUploadFailure,
  type DocumentUploadOutcome,
  type PersistDocumentAttachmentOptions,
} from "./client-upload";
