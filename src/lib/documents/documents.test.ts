import { describe, expect, it } from "vitest";

import {
  disabledDocumentExtractionProvider,
  isDocumentExtractionAvailable,
} from "./extraction";
import {
  createMemoryDocumentMaintenance,
  createMemoryDocumentRepository,
  createMemoryDocumentStore,
  putMemoryDocumentObject,
  type MemoryDocumentStore,
} from "./memory-repository";
import {
  DOCUMENT_ALLOWED_MIME_TYPES,
  DOCUMENT_MAX_SIZE_BYTES,
  buildDocumentStoragePath,
  documentFilenameSchema,
  isAllowedDocumentMimeType,
  sanitiseDocumentFilename,
} from "./schemas";
import {
  cleanupAbandonedDocumentUploads,
  confirmDocumentUpload,
  createDocumentDownloadUrl,
  getDocument,
  listDocuments,
  registerDocumentUpload,
  softDeleteDocument,
} from "./service";
import type { DocumentRecord, DocumentRepository } from "./types";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const USER_A = "aaaaaaaa-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const USER_B = "bbbbbbbb-2222-4222-8222-222222222222";

const PDF = "application/pdf";

function setup(now = () => new Date("2026-08-03T10:00:00.000Z")) {
  const store = createMemoryDocumentStore();
  const repoA = createMemoryDocumentRepository(
    store,
    { prestataireId: TENANT_A, userId: USER_A },
    { now },
  );
  const repoB = createMemoryDocumentRepository(
    store,
    { prestataireId: TENANT_B, userId: USER_B },
    { now },
  );
  return { store, repoA, repoB };
}

async function uploadAndConfirm(
  store: MemoryDocumentStore,
  repository: DocumentRepository,
  filename = "facture.pdf",
): Promise<DocumentRecord> {
  const registered = await registerDocumentUpload(repository, {
    filename,
    mimeType: PDF,
    sizeBytes: 4_096,
  });
  if (!registered.ok) throw registered.error;

  putMemoryDocumentObject(store, registered.value.document.storagePath, {
    sizeBytes: 4_096,
    mimeType: PDF,
  });

  const confirmed = await confirmDocumentUpload(repository, {
    documentId: registered.value.document.id,
  });
  if (!confirmed.ok) throw confirmed.error;
  return confirmed.value;
}

describe("allowlist MIME", () => {
  it.each(DOCUMENT_ALLOWED_MIME_TYPES)("accepte %s", async (mimeType) => {
    const { store, repoA } = setup();
    const result = await registerDocumentUpload(repoA, {
      filename: "piece-jointe",
      mimeType,
      sizeBytes: 1_024,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.document.mimeType).toBe(mimeType);
    expect(store.documents.size).toBe(1);
  });

  it("normalise la casse et les espaces du type déclaré", () => {
    expect(isAllowedDocumentMimeType("  APPLICATION/PDF ")).toBe(true);
  });

  it.each([
    "application/zip",
    "application/x-7z-compressed",
    "application/vnd.rar",
    "application/gzip",
    "application/x-tar",
  ])("refuse l'archive %s", async (mimeType) => {
    const { repoA } = setup();
    const result = await registerDocumentUpload(repoA, {
      filename: "archive",
      mimeType,
      sizeBytes: 1_024,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("document_mime_not_allowed");
  });

  it("refuse proprement un type inconnu, sans lever", async () => {
    const { store, repoA } = setup();
    const result = await registerDocumentUpload(repoA, {
      filename: "mystere.bin",
      mimeType: "application/x-unknown-thing",
      sizeBytes: 10,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error.code).toBe("document_mime_not_allowed");
    // Aucune ligne réservée : un refus ne doit rien laisser derrière lui.
    expect(store.documents.size).toBe(0);
  });

  it("refuse un type vide", async () => {
    const { repoA } = setup();
    const result = await registerDocumentUpload(repoA, {
      filename: "sans-type",
      mimeType: "",
      sizeBytes: 10,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("document_mime_not_allowed");
  });
});

describe("plafond de taille", () => {
  it("accepte exactement le plafond", async () => {
    const { repoA } = setup();
    const result = await registerDocumentUpload(repoA, {
      filename: "gros.pdf",
      mimeType: PDF,
      sizeBytes: DOCUMENT_MAX_SIZE_BYTES,
    });
    expect(result.ok).toBe(true);
  });

  it("refuse un octet au-dessus du plafond", async () => {
    const { repoA } = setup();
    const result = await registerDocumentUpload(repoA, {
      filename: "trop-gros.pdf",
      mimeType: PDF,
      sizeBytes: DOCUMENT_MAX_SIZE_BYTES + 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("document_too_large");
    expect(result.error.details.maxSizeBytes).toBe(DOCUMENT_MAX_SIZE_BYTES);
  });

  it("refuse un fichier vide", async () => {
    const { repoA } = setup();
    const result = await registerDocumentUpload(repoA, {
      filename: "vide.pdf",
      mimeType: PDF,
      sizeBytes: 0,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("document_empty");
  });

  it("met en quarantaine quand les octets reçus dépassent la taille annoncée", async () => {
    const { store, repoA } = setup();
    const registered = await registerDocumentUpload(repoA, {
      filename: "menteur.pdf",
      mimeType: PDF,
      sizeBytes: 1_024,
    });
    if (!registered.ok) throw registered.error;

    putMemoryDocumentObject(store, registered.value.document.storagePath, {
      sizeBytes: DOCUMENT_MAX_SIZE_BYTES + 1,
      mimeType: PDF,
    });

    const confirmed = await confirmDocumentUpload(repoA, {
      documentId: registered.value.document.id,
    });

    expect(confirmed.ok).toBe(false);
    if (confirmed.ok) return;
    expect(confirmed.error.code).toBe("document_quarantined");
    expect(store.documents.get(registered.value.document.id)?.status).toBe(
      "quarantined",
    );
  });
});

describe("assainissement du chemin", () => {
  it("refuse un nom contenant une remontée d'arborescence", () => {
    for (const hostile of [
      "../secret.pdf",
      "..\\secret.pdf",
      "dossier/../secret.pdf",
      "/etc/passwd",
      "..",
    ]) {
      expect(documentFilenameSchema.safeParse(hostile).success).toBe(false);
    }
  });

  it("refuse un nom masqué et les caractères de contrôle", () => {
    expect(documentFilenameSchema.safeParse(".env").success).toBe(false);
    expect(documentFilenameSchema.safeParse("bad\u0007name.pdf").success).toBe(
      false,
    );
  });

  it("refuse la remontée d'arborescence au niveau du service", async () => {
    const { store, repoA } = setup();
    const result = await registerDocumentUpload(repoA, {
      filename: "../../etc/passwd",
      mimeType: PDF,
      sizeBytes: 128,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("document_filename_invalid");
    expect(store.documents.size).toBe(0);
  });

  it("assainit défensivement un nom hostile qui atteindrait le stockage", () => {
    expect(sanitiseDocumentFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitiseDocumentFilename("..")).toBe("document");
    expect(sanitiseDocumentFilename("mon rapport (final).pdf")).toBe(
      "mon_rapport_final_.pdf",
    );
    expect(sanitiseDocumentFilename("///")).toBe("document");
  });

  it("préfixe le chemin par le tenant et l'identifiant du document", async () => {
    const { repoA } = setup();
    const result = await registerDocumentUpload(repoA, {
      filename: "facture avril.pdf",
      mimeType: PDF,
      sizeBytes: 2_048,
    });
    if (!result.ok) throw result.error;

    const { document } = result.value;
    expect(document.storagePath).toBe(
      buildDocumentStoragePath({
        prestataireId: TENANT_A,
        documentId: document.id,
        filename: "facture avril.pdf",
      }),
    );
    expect(document.storagePath.startsWith(`${TENANT_A}/${document.id}/`)).toBe(
      true,
    );
    expect(document.storagePath.split("/")).toHaveLength(3);
  });
});

describe("isolation des tenants", () => {
  it("empêche le tenant B de lire un document du tenant A", async () => {
    const { store, repoA, repoB } = setup();
    const document = await uploadAndConfirm(store, repoA);

    const asOwner = await getDocument(repoA, document.id);
    expect(asOwner.ok).toBe(true);

    const asOther = await getDocument(repoB, document.id);
    expect(asOther.ok).toBe(false);
    if (asOther.ok) return;
    // Même code que pour un identifiant inexistant : ne pas révéler l'existence.
    expect(asOther.error.code).toBe("document_not_found");
  });

  it("n'expose jamais un document d'un autre tenant dans la liste", async () => {
    const { store, repoA, repoB } = setup();
    await uploadAndConfirm(store, repoA, "a.pdf");
    await uploadAndConfirm(store, repoB, "b.pdf");

    const listA = await listDocuments(repoA);
    const listB = await listDocuments(repoB);
    if (!listA.ok || !listB.ok) throw new Error("liste indisponible");

    expect(listA.value).toHaveLength(1);
    expect(listB.value).toHaveLength(1);
    expect(listA.value[0]?.originalFilename).toBe("a.pdf");
    expect(listA.value[0]?.prestataireId).toBe(TENANT_A);
    expect(listB.value[0]?.prestataireId).toBe(TENANT_B);
  });

  it("empêche le tenant B de supprimer ou de télécharger un document du tenant A", async () => {
    const { store, repoA, repoB } = setup();
    const document = await uploadAndConfirm(store, repoA);

    const deletion = await softDeleteDocument(repoB, document.id);
    expect(deletion.ok).toBe(false);
    if (!deletion.ok) {
      expect(deletion.error.code).toBe("document_not_found");
    }

    const download = await createDocumentDownloadUrl(repoB, {
      documentId: document.id,
    });
    expect(download.ok).toBe(false);

    expect(store.documents.get(document.id)?.status).toBe(
      "awaiting_processing",
    );
  });
});

describe("cycle de vie", () => {
  it("laisse un document confirmé en awaiting_processing", async () => {
    const { store, repoA } = setup();
    const document = await uploadAndConfirm(store, repoA);
    // Aucune extraction n'existe : « stocké et jamais analysé » est terminal.
    expect(document.status).toBe("awaiting_processing");
  });

  it("refuse de confirmer quand les octets ne sont jamais arrivés", async () => {
    const { repoA } = setup();
    const registered = await registerDocumentUpload(repoA, {
      filename: "jamais-envoye.pdf",
      mimeType: PDF,
      sizeBytes: 512,
    });
    if (!registered.ok) throw registered.error;

    const confirmed = await confirmDocumentUpload(repoA, {
      documentId: registered.value.document.id,
    });
    expect(confirmed.ok).toBe(false);
    if (confirmed.ok) return;
    expect(confirmed.error.code).toBe("document_object_missing");
  });

  it("signe une URL de téléchargement à durée courte, jamais publique", async () => {
    const { store, repoA } = setup();
    const document = await uploadAndConfirm(store, repoA);

    const download = await createDocumentDownloadUrl(repoA, {
      documentId: document.id,
    });
    expect(download.ok).toBe(true);
    if (!download.ok) return;
    expect(download.value.expiresInSeconds).toBe(60);
    expect(download.value.url).toContain(document.storagePath);
  });

  it("plafonne un TTL de téléchargement trop long", async () => {
    const { store, repoA } = setup();
    const document = await uploadAndConfirm(store, repoA);

    const download = await createDocumentDownloadUrl(repoA, {
      documentId: document.id,
      ttlSeconds: 86_400,
    });
    expect(download.ok).toBe(false);
    if (download.ok) return;
    expect(download.error.code).toBe("document_input_invalid");
  });
});

describe("suppression logique", () => {
  it("marque le document supprimé et le retire des lectures", async () => {
    const { store, repoA } = setup();
    const document = await uploadAndConfirm(store, repoA);

    const deleted = await softDeleteDocument(repoA, document.id);
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.value.status).toBe("deleted");
    expect(deleted.value.deletedAt).not.toBeNull();

    const readBack = await getDocument(repoA, document.id);
    expect(readBack.ok).toBe(false);

    const visible = await listDocuments(repoA);
    if (!visible.ok) throw visible.error;
    expect(visible.value).toHaveLength(0);

    // La ligne survit : la suppression est logique, pas destructive.
    const withDeleted = await listDocuments(repoA, { includeDeleted: true });
    if (!withDeleted.ok) throw withDeleted.error;
    expect(withDeleted.value).toHaveLength(1);
    expect(store.objects.has(document.storagePath)).toBe(true);
  });

  it("est idempotente", async () => {
    const { store, repoA } = setup();
    const document = await uploadAndConfirm(store, repoA);

    const first = await softDeleteDocument(repoA, document.id);
    const second = await softDeleteDocument(repoA, document.id);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.deletedAt).toBe(first.value.deletedAt);
  });
});

describe("ménage des uploads abandonnés", () => {
  it("purge les réservations anciennes et retire leurs octets", async () => {
    const store = createMemoryDocumentStore();
    const oldClock = () => new Date("2026-08-01T00:00:00.000Z");
    const oldRepo = createMemoryDocumentRepository(
      store,
      { prestataireId: TENANT_A, userId: USER_A },
      { now: oldClock },
    );

    const abandoned = await registerDocumentUpload(oldRepo, {
      filename: "abandonne.pdf",
      mimeType: PDF,
      sizeBytes: 900,
    });
    if (!abandoned.ok) throw abandoned.error;
    putMemoryDocumentObject(store, abandoned.value.document.storagePath, {
      sizeBytes: 900,
      mimeType: PDF,
    });

    const nowClock = () => new Date("2026-08-03T00:00:00.000Z");
    const freshRepo = createMemoryDocumentRepository(
      store,
      { prestataireId: TENANT_A, userId: USER_A },
      { now: nowClock },
    );
    const kept = await uploadAndConfirm(store, freshRepo, "conserve.pdf");
    const recent = await registerDocumentUpload(freshRepo, {
      filename: "recent.pdf",
      mimeType: PDF,
      sizeBytes: 700,
    });
    if (!recent.ok) throw recent.error;

    const maintenance = createMemoryDocumentMaintenance(store, {
      now: nowClock,
    });
    const report = await cleanupAbandonedDocumentUploads(maintenance, {
      olderThanHours: 24,
    });

    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.purged).toBe(1);
    expect(report.value.storagePaths).toEqual([
      abandoned.value.document.storagePath,
    ]);
    expect(report.value.objectsRemoved).toBe(true);

    expect(store.documents.get(abandoned.value.document.id)?.status).toBe(
      "deleted",
    );
    expect(store.objects.has(abandoned.value.document.storagePath)).toBe(false);
    // Un upload récent et un document confirmé ne sont jamais emportés.
    expect(store.documents.get(recent.value.document.id)?.status).toBe(
      "pending_upload",
    );
    expect(store.documents.get(kept.id)?.status).toBe("awaiting_processing");
  });

  it("ne purge rien quand aucun upload n'a dépassé le délai", async () => {
    const now = () => new Date("2026-08-03T10:00:00.000Z");
    const store = createMemoryDocumentStore();
    const repo = createMemoryDocumentRepository(
      store,
      { prestataireId: TENANT_A, userId: USER_A },
      { now },
    );
    await registerDocumentUpload(repo, {
      filename: "tout-frais.pdf",
      mimeType: PDF,
      sizeBytes: 300,
    });

    const report = await cleanupAbandonedDocumentUploads(
      createMemoryDocumentMaintenance(store, { now }),
      { olderThanHours: 24 },
    );

    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.purged).toBe(0);
  });
});

describe("extraction de contenu", () => {
  it("déclare la capacité indisponible plutôt que de renvoyer du texte", async () => {
    const store = createMemoryDocumentStore();
    const repo = createMemoryDocumentRepository(store, {
      prestataireId: TENANT_A,
      userId: USER_A,
    });
    const document = await uploadAndConfirm(store, repo);

    const outcome = await disabledDocumentExtractionProvider.extract({
      document,
      kind: "pdf_text",
    });

    expect(outcome.status).toBe("unavailable");
    if (outcome.status !== "unavailable") return;
    expect(outcome.reason).toBe("capability_not_implemented");
    expect(outcome).not.toHaveProperty("text");
  });

  it("ne prétend supporter aucun format", () => {
    for (const kind of ["ocr", "pdf_text", "transcription"] as const) {
      expect(
        isDocumentExtractionAvailable(
          disabledDocumentExtractionProvider,
          kind,
          PDF,
        ),
      ).toBe(false);
    }
  });
});
