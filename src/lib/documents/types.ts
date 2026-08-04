/**
 * Types du stockage de documents.
 *
 * Règle structurante : aucune méthode de `DocumentRepository` ne reçoit
 * d'identifiant de tenant. Le tenant est fixé à la construction du dépôt, à
 * partir de la session serveur (Supabase : `auth.uid()` dans les RPC et les
 * policies). Un appelant ne peut donc pas désigner le tenant d'un autre,
 * même par erreur.
 */

export type DocumentStatus =
  | "pending_upload"
  | "stored"
  | "awaiting_processing"
  | "quarantined"
  | "deleted";

export type DocumentRecord = {
  id: string;
  prestataireId: string;
  creanceId: string | null;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string | null;
  status: DocumentStatus;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

/** Identité dérivée de la session serveur — jamais d'un paramètre d'appel. */
export type DocumentSession = {
  prestataireId: string;
  userId: string;
};

export type RegisterDocumentUploadInput = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  creanceId?: string | null;
};

export type DocumentUploadUrl = {
  /**
   * URL d'upload signée.
   *
   * Le TTL n'est pas paramétrable : Supabase Storage le fixe côté fournisseur
   * pour les jetons d'upload. Ne pas prétendre le contrôler ici.
   */
  uploadUrl: string;
  uploadToken: string;
};

export type DocumentUploadTicket = DocumentUploadUrl & {
  document: DocumentRecord;
};

export type DocumentDownloadUrl = {
  documentId: string;
  url: string;
  expiresInSeconds: number;
};

export type ListDocumentsInput = {
  creanceId?: string | null;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
};

export type AbandonedUploadPurgeItem = {
  id: string;
  storagePath: string;
};

export type DocumentRepository = {
  register(input: RegisterDocumentUploadInput): Promise<DocumentRecord>;
  createUploadUrl(document: DocumentRecord): Promise<DocumentUploadUrl>;
  confirm(input: {
    documentId: string;
    checksum?: string | null;
  }): Promise<DocumentRecord>;
  /** `null` quand le document n'existe pas OU appartient à un autre tenant. */
  get(documentId: string): Promise<DocumentRecord | null>;
  list(input: ListDocumentsInput): Promise<DocumentRecord[]>;
  softDelete(documentId: string): Promise<DocumentRecord>;
  createDownloadUrl(input: {
    document: DocumentRecord;
    ttlSeconds: number;
  }): Promise<string>;
};

/**
 * Surface de maintenance transverse (tous tenants). Réservée à un worker
 * service_role : elle n'est jamais joignable depuis une session utilisateur.
 */
export type DocumentMaintenanceRepository = {
  purgeAbandonedUploads(input: {
    olderThanHours: number;
    limit: number;
  }): Promise<AbandonedUploadPurgeItem[]>;
  removeObjects(storagePaths: string[]): Promise<void>;
};
