/**
 * Tests HTTP POST /api/documents.
 *
 * Le contexte serveur est simulé : ce qui est vérifié ici, c'est qu'aucune
 * réponse ne peut être produite sans session, qu'aucun identifiant de tenant
 * fourni par l'appelant n'est transmis au service, et que les refus métier
 * gardent un statut distinct d'une panne.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentError } from "@/lib/documents/errors";

const resolveDocumentRequestContext = vi.hoisted(() => vi.fn());
const registerDocumentUpload = vi.hoisted(() => vi.fn());

vi.mock("@/lib/documents/server-context", () => ({
  resolveDocumentRequestContext,
}));
vi.mock("@/lib/documents/service", () => ({ registerDocumentUpload }));

const REPOSITORY = { marker: "session-scoped-repository" };

const DOCUMENT = {
  id: "22222222-2222-4222-8222-222222222222",
  prestataireId: "33333333-3333-4333-8333-333333333333",
  creanceId: null,
  storagePath: "33333333-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222/facture.pdf",
  originalFilename: "facture.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1024,
  checksum: null,
  status: "pending_upload",
  uploadedBy: "44444444-4444-4444-8444-444444444444",
  createdAt: "2026-08-03T10:00:00.000Z",
  updatedAt: "2026-08-03T10:00:00.000Z",
  deletedAt: null,
};

function postRequest(body: unknown): Request {
  return new Request("http://127.0.0.1:3000/api/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/documents", () => {
  beforeEach(() => {
    resolveDocumentRequestContext.mockReset();
    registerDocumentUpload.mockReset();
    resolveDocumentRequestContext.mockResolvedValue({
      repository: REPOSITORY,
      session: { prestataireId: DOCUMENT.prestataireId, userId: DOCUMENT.uploadedBy },
    });
  });

  it("réserve le document et renvoie l’URL signée sans mise en cache", async () => {
    registerDocumentUpload.mockResolvedValue({
      ok: true,
      value: {
        document: DOCUMENT,
        uploadUrl: "http://127.0.0.1:54321/storage/v1/object/upload/sign/documents/x?token=t",
        uploadToken: "t",
      },
    });

    const { POST } = await import("./route");
    const response = await POST(
      postRequest({
        filename: "facture.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe(
      "private, no-store, max-age=0",
    );
    await expect(response.json()).resolves.toEqual({
      document: {
        id: DOCUMENT.id,
        status: "pending_upload",
        originalFilename: "facture.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        creanceId: null,
        createdAt: DOCUMENT.createdAt,
      },
      upload: {
        storagePath: DOCUMENT.storagePath,
        url: "http://127.0.0.1:54321/storage/v1/object/upload/sign/documents/x?token=t",
        token: "t",
      },
    });

    expect(registerDocumentUpload).toHaveBeenCalledWith(REPOSITORY, {
      filename: "facture.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      creanceId: null,
    });
  });

  it("répond 401 sans session et n’atteint jamais le service", async () => {
    resolveDocumentRequestContext.mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = await POST(
      postRequest({
        filename: "facture.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
      }),
    );

    expect(response.status).toBe(401);
    expect(registerDocumentUpload).not.toHaveBeenCalled();
  });

  it("refuse un corps portant un identifiant de tenant", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      postRequest({
        filename: "facture.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        prestataireId: "99999999-9999-4999-8999-999999999999",
      }),
    );

    expect(response.status).toBe(400);
    expect(registerDocumentUpload).not.toHaveBeenCalled();
  });

  it("distingue un format refusé (415) d’une panne de stockage (503)", async () => {
    const { POST } = await import("./route");

    registerDocumentUpload.mockResolvedValueOnce({
      ok: false,
      error: new DocumentError(
        "document_mime_not_allowed",
        "Ce format de fichier n’est pas pris en charge.",
      ),
    });
    const refused = await POST(
      postRequest({ filename: "a.zip", mimeType: "application/zip", sizeBytes: 10 }),
    );
    expect(refused.status).toBe(415);
    await expect(refused.json()).resolves.toEqual({
      code: "document_mime_not_allowed",
      message: "Ce format de fichier n’est pas pris en charge.",
    });

    registerDocumentUpload.mockResolvedValueOnce({
      ok: false,
      error: new DocumentError(
        "document_storage_unavailable",
        'relation "storage.objects" does not exist',
      ),
    });
    const broken = await POST(
      postRequest({ filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 10 }),
    );
    expect(broken.status).toBe(503);
    // Le message brut de la base ne doit pas atteindre le navigateur.
    await expect(broken.json()).resolves.toEqual({
      code: "document_storage_unavailable",
      message: "Le stockage des documents est momentanément indisponible.",
    });
  });

  it("répond 413 pour un fichier trop lourd", async () => {
    registerDocumentUpload.mockResolvedValue({
      ok: false,
      error: new DocumentError(
        "document_too_large",
        "Le fichier dépasse la limite autorisée.",
      ),
    });

    const { POST } = await import("./route");
    const response = await POST(
      postRequest({
        filename: "gros.pdf",
        mimeType: "application/pdf",
        sizeBytes: 99_000_000,
      }),
    );

    expect(response.status).toBe(413);
  });

  it("refuse un corps illisible avant toute résolution de session", async () => {
    const { POST } = await import("./route");
    const response = await POST(postRequest("{pas du json"));

    expect(response.status).toBe(400);
    expect(resolveDocumentRequestContext).not.toHaveBeenCalled();
  });

  it("n’expose aucune autre méthode", async () => {
    const { GET, PUT, PATCH, DELETE } = await import("./route");
    for (const handler of [GET, PUT, PATCH, DELETE]) {
      const response = await handler();
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST");
    }
  });
});
