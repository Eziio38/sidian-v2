import { randomUUID } from "node:crypto";

import {
  DOCUMENT_STORAGE_BUCKET,
  DOCUMENT_MAX_SIZE_BYTES,
  buildDocumentStoragePath,
  isAllowedDocumentMimeType,
  normaliseDocumentMimeType,
} from "./schemas";
import type {
  AbandonedUploadPurgeItem,
  DocumentMaintenanceRepository,
  DocumentRecord,
  DocumentRepository,
  DocumentSession,
} from "./types";

/**
 * Double de test du stockage de documents.
 *
 * Il reproduit les invariants que le SQL garantit en production : chemin dérivé
 * de la session, portée tenant sur chaque lecture et chaque écriture, contrôle
 * de la taille et du type réellement reçus à la confirmation.
 *
 * Les URL produites portent volontairement le schéma `memory:` : elles ne
 * doivent jamais pouvoir passer pour des URL signées réelles.
 */

/** Objet « stocké » dans le bucket simulé. */
export type MemoryStoredObject = {
  sizeBytes: number;
  mimeType: string;
};

export type MemoryDocumentStore = {
  documents: Map<string, DocumentRecord>;
  objects: Map<string, MemoryStoredObject>;
  reset(): void;
};

export function createMemoryDocumentStore(): MemoryDocumentStore {
  const documents = new Map<string, DocumentRecord>();
  const objects = new Map<string, MemoryStoredObject>();
  return {
    documents,
    objects,
    reset() {
      documents.clear();
      objects.clear();
    },
  };
}

/** Simule l'arrivée des octets dans le bucket (ce que ferait le navigateur). */
export function putMemoryDocumentObject(
  store: MemoryDocumentStore,
  storagePath: string,
  object: MemoryStoredObject,
): void {
  store.objects.set(storagePath, object);
}

export type MemoryDocumentRepositoryOptions = {
  /** Horloge injectable — les tests de ménage ont besoin de dates anciennes. */
  now?: () => Date;
  newId?: () => string;
};

class MemoryDocumentError extends Error {}

/**
 * Dépôt lié à UNE session. Le tenant n'est jamais un argument de méthode :
 * deux tenants = deux dépôts au-dessus du même magasin.
 */
export function createMemoryDocumentRepository(
  store: MemoryDocumentStore,
  session: DocumentSession,
  options: MemoryDocumentRepositoryOptions = {},
): DocumentRepository {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => randomUUID());

  function scoped(documentId: string): DocumentRecord | null {
    const record = store.documents.get(documentId);
    if (!record) return null;
    // Isolation : un document d'un autre prestataire est traité comme absent.
    if (record.prestataireId !== session.prestataireId) return null;
    return record;
  }

  function requireScoped(documentId: string): DocumentRecord {
    const record = scoped(documentId);
    if (!record) throw new MemoryDocumentError("document_not_found");
    return record;
  }

  return {
    async register(input) {
      const mimeType = normaliseDocumentMimeType(input.mimeType);
      if (!isAllowedDocumentMimeType(mimeType)) {
        throw new MemoryDocumentError("document_mime_not_allowed");
      }
      if (
        !Number.isInteger(input.sizeBytes) ||
        input.sizeBytes < 1 ||
        input.sizeBytes > DOCUMENT_MAX_SIZE_BYTES
      ) {
        throw new MemoryDocumentError("document_size_out_of_range");
      }

      const id = newId();
      const timestamp = now().toISOString();
      const record: DocumentRecord = {
        id,
        prestataireId: session.prestataireId,
        creanceId: input.creanceId ?? null,
        storagePath: buildDocumentStoragePath({
          prestataireId: session.prestataireId,
          documentId: id,
          filename: input.filename,
        }),
        originalFilename: input.filename.trim().slice(0, 255),
        mimeType,
        sizeBytes: input.sizeBytes,
        checksum: null,
        status: "pending_upload",
        uploadedBy: session.userId,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      };
      store.documents.set(id, record);
      return { ...record };
    },

    async createUploadUrl(document) {
      requireScoped(document.id);
      return {
        uploadUrl: `memory://${DOCUMENT_STORAGE_BUCKET}/upload/${document.storagePath}`,
        uploadToken: `memory-token-${document.id}`,
      };
    },

    async confirm({ documentId, checksum }) {
      const record = requireScoped(documentId);
      if (record.status === "awaiting_processing") return { ...record };
      if (record.status !== "pending_upload") {
        throw new MemoryDocumentError("document_status_conflict");
      }

      const object = store.objects.get(record.storagePath);
      if (!object) throw new MemoryDocumentError("document_object_missing");

      const observedMime = normaliseDocumentMimeType(object.mimeType);
      const invalid =
        object.sizeBytes < 1 ||
        object.sizeBytes > DOCUMENT_MAX_SIZE_BYTES ||
        !isAllowedDocumentMimeType(observedMime);

      const updated: DocumentRecord = invalid
        ? { ...record, status: "quarantined", updatedAt: now().toISOString() }
        : {
            ...record,
            // Terminal aujourd'hui : rien ne consomme cet état.
            status: "awaiting_processing",
            sizeBytes: object.sizeBytes,
            mimeType: observedMime,
            checksum: checksum ?? record.checksum,
            updatedAt: now().toISOString(),
          };

      store.documents.set(record.id, updated);
      return { ...updated };
    },

    async get(documentId) {
      const record = scoped(documentId);
      return record ? { ...record } : null;
    },

    async list({ creanceId, includeDeleted, limit, offset } = {}) {
      const rows = [...store.documents.values()]
        .filter((row) => row.prestataireId === session.prestataireId)
        .filter((row) => (includeDeleted ? true : row.deletedAt === null))
        .filter((row) =>
          creanceId == null ? true : row.creanceId === creanceId,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      const start = offset ?? 0;
      return rows.slice(start, start + (limit ?? 50)).map((row) => ({ ...row }));
    },

    async softDelete(documentId) {
      const record = requireScoped(documentId);
      if (record.status === "deleted") return { ...record };
      const timestamp = now().toISOString();
      const updated: DocumentRecord = {
        ...record,
        status: "deleted",
        deletedAt: timestamp,
        updatedAt: timestamp,
      };
      store.documents.set(record.id, updated);
      return { ...updated };
    },

    async createDownloadUrl({ document, ttlSeconds }) {
      requireScoped(document.id);
      return `memory://${DOCUMENT_STORAGE_BUCKET}/download/${document.storagePath}?ttl=${ttlSeconds}`;
    },
  };
}

export type MemoryDocumentMaintenanceOptions = {
  now?: () => Date;
};

/** Surface de maintenance transverse — équivalent du worker service_role. */
export function createMemoryDocumentMaintenance(
  store: MemoryDocumentStore,
  options: MemoryDocumentMaintenanceOptions = {},
): DocumentMaintenanceRepository {
  const now = options.now ?? (() => new Date());

  return {
    async purgeAbandonedUploads({ olderThanHours, limit }) {
      const cutoff = now().getTime() - olderThanHours * 3600 * 1000;
      const purged: AbandonedUploadPurgeItem[] = [];

      const candidates = [...store.documents.values()]
        .filter(
          (row) =>
            row.status === "pending_upload" &&
            Date.parse(row.createdAt) < cutoff,
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, limit);

      const timestamp = now().toISOString();
      for (const row of candidates) {
        store.documents.set(row.id, {
          ...row,
          status: "deleted",
          deletedAt: timestamp,
          updatedAt: timestamp,
        });
        purged.push({ id: row.id, storagePath: row.storagePath });
      }
      return purged;
    },

    async removeObjects(storagePaths) {
      for (const path of storagePaths) {
        store.objects.delete(path);
      }
    },
  };
}
