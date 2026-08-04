import { DocumentError } from "./errors";
import { DOCUMENT_STORAGE_BUCKET } from "./schemas";
import type {
  AbandonedUploadPurgeItem,
  DocumentMaintenanceRepository,
  DocumentRecord,
  DocumentRepository,
  DocumentStatus,
} from "./types";

/**
 * Dépôt Supabase.
 *
 * Le client est typé structurellement, comme `RuntimeJobRpcClient` : la table
 * `document` n'apparaîtra dans `database.generated.ts` qu'après régénération
 * des types, et le service ne doit pas attendre cette étape pour compiler.
 *
 * Aucune méthode ne reçoit d'identifiant de tenant : les RPC le dérivent de
 * `auth.uid()` et les policies du bucket contrôlent le préfixe de chemin.
 */

type SupabaseResult<T> = {
  data: T | null;
  error: { message?: string } | null;
};

export type DocumentStorageBucketClient = {
  createSignedUploadUrl(
    path: string,
  ): PromiseLike<
    SupabaseResult<{ signedUrl: string; token: string; path: string }>
  >;
  createSignedUrl(
    path: string,
    expiresIn: number,
  ): PromiseLike<SupabaseResult<{ signedUrl: string }>>;
  remove(paths: string[]): PromiseLike<SupabaseResult<unknown>>;
};

export type DocumentSupabaseClient = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<SupabaseResult<unknown>>;
  storage: {
    from(bucket: string): DocumentStorageBucketClient;
  };
};

/** Ligne `public.document` telle que renvoyée par PostgREST. */
type DocumentRow = {
  id: string;
  prestataire_id: string;
  creance_id: string | null;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number | string;
  checksum: string | null;
  status: string;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

function toDocumentRecord(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    prestataireId: row.prestataire_id,
    creanceId: row.creance_id,
    storagePath: row.storage_path,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    // `bigint` peut revenir en chaîne selon la configuration PostgREST.
    sizeBytes: Number(row.size_bytes),
    checksum: row.checksum,
    status: row.status as DocumentStatus,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function unwrapRow(
  result: SupabaseResult<unknown>,
  fallbackMessage: string,
): DocumentRow {
  if (result.error) {
    throw new Error(result.error.message ?? fallbackMessage);
  }
  // Une RPC `returns public.document` peut être sérialisée en objet ou en
  // tableau d'une ligne selon l'appel — accepter les deux évite un échec muet.
  const raw = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!raw) {
    throw new Error(fallbackMessage);
  }
  return raw as DocumentRow;
}

export function createSupabaseDocumentRepository(
  client: DocumentSupabaseClient,
): DocumentRepository {
  const bucket = () => client.storage.from(DOCUMENT_STORAGE_BUCKET);

  return {
    async register(input) {
      const result = await client.rpc("register_document_upload", {
        p_original_filename: input.filename,
        p_mime_type: input.mimeType,
        p_size_bytes: input.sizeBytes,
        p_creance_id: input.creanceId ?? null,
      });
      return toDocumentRecord(unwrapRow(result, "document_register_failed"));
    },

    async createUploadUrl(document) {
      // Le TTL du jeton d'upload est fixé par Supabase Storage : il n'est pas
      // paramétrable ici, et prétendre le contrôler serait mensonger.
      const { data, error } = await bucket().createSignedUploadUrl(
        document.storagePath,
      );
      if (error || !data) {
        throw new Error(error?.message ?? "document_upload_url_failed");
      }
      return { uploadUrl: data.signedUrl, uploadToken: data.token };
    },

    async confirm({ documentId, checksum }) {
      const result = await client.rpc("confirm_document_upload", {
        p_document_id: documentId,
        p_checksum: checksum ?? null,
      });
      return toDocumentRecord(unwrapRow(result, "document_confirm_failed"));
    },

    async get(documentId) {
      const result = await client.rpc("get_current_document", {
        p_document_id: documentId,
      });
      if (result.error) {
        throw new Error(result.error.message ?? "document_get_failed");
      }
      const rows = (result.data ?? []) as DocumentRow[];
      const [row] = Array.isArray(rows) ? rows : [rows as DocumentRow];
      return row ? toDocumentRecord(row) : null;
    },

    async list(input) {
      const result = await client.rpc("list_current_documents", {
        p_creance_id: input.creanceId ?? null,
        p_include_deleted: input.includeDeleted ?? false,
        p_limit: input.limit ?? 50,
        p_offset: input.offset ?? 0,
      });
      if (result.error) {
        throw new Error(result.error.message ?? "document_list_failed");
      }
      return ((result.data ?? []) as DocumentRow[]).map(toDocumentRecord);
    },

    async softDelete(documentId) {
      const result = await client.rpc("soft_delete_document", {
        p_document_id: documentId,
      });
      return toDocumentRecord(unwrapRow(result, "document_delete_failed"));
    },

    async createDownloadUrl({ document, ttlSeconds }) {
      const { data, error } = await bucket().createSignedUrl(
        document.storagePath,
        ttlSeconds,
      );
      if (error || !data) {
        throw new Error(error?.message ?? "document_download_url_failed");
      }
      return data.signedUrl;
    },
  };
}

/**
 * Maintenance transverse. À construire uniquement avec un client service_role :
 * `purge_abandoned_document_uploads` n'est pas exécutable par `authenticated`.
 */
export function createSupabaseDocumentMaintenance(
  adminClient: DocumentSupabaseClient,
): DocumentMaintenanceRepository {
  return {
    async purgeAbandonedUploads({ olderThanHours, limit }) {
      const { data, error } = await adminClient.rpc(
        "purge_abandoned_document_uploads",
        { p_older_than_hours: olderThanHours, p_limit: limit },
      );
      if (error) {
        throw new DocumentError(
          "document_storage_unavailable",
          error.message ?? "document_purge_failed",
        );
      }
      const rows = (data ?? []) as Array<{ id: string; storage_path: string }>;
      return rows.map(
        (row): AbandonedUploadPurgeItem => ({
          id: row.id,
          storagePath: row.storage_path,
        }),
      );
    },

    async removeObjects(storagePaths) {
      if (storagePaths.length === 0) return;
      const { error } = await adminClient.storage
        .from(DOCUMENT_STORAGE_BUCKET)
        .remove(storagePaths);
      if (error) {
        throw new DocumentError(
          "document_storage_unavailable",
          error.message ?? "document_objects_remove_failed",
        );
      }
    },
  };
}
