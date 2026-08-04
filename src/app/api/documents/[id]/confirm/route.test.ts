/**
 * Tests HTTP POST /api/documents/:id/confirm.
 *
 * La confirmation est le seul point où le produit peut dire « le fichier est
 * conservé ». Ces tests vérifient qu'elle ne le dit jamais à tort : pas de
 * session → 401, quarantaine → 422, document d'un autre tenant → 404.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentError } from "@/lib/documents/errors";

const resolveDocumentRequestContext = vi.hoisted(() => vi.fn());
const confirmDocumentUpload = vi.hoisted(() => vi.fn());

vi.mock("@/lib/documents/server-context", () => ({
  resolveDocumentRequestContext,
}));
vi.mock("@/lib/documents/service", () => ({ confirmDocumentUpload }));

const REPOSITORY = { marker: "session-scoped-repository" };
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";

const DOCUMENT = {
  id: DOCUMENT_ID,
  prestataireId: "33333333-3333-4333-8333-333333333333",
  creanceId: null,
  storagePath: "33333333-3333-4333-8333-333333333333/2/facture.pdf",
  originalFilename: "facture.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1024,
  checksum: null,
  status: "awaiting_processing",
  uploadedBy: "44444444-4444-4444-8444-444444444444",
  createdAt: "2026-08-03T10:00:00.000Z",
  updatedAt: "2026-08-03T10:00:01.000Z",
  deletedAt: null,
};

function confirmRequest(body?: string): Request {
  return new Request(
    `http://127.0.0.1:3000/api/documents/${DOCUMENT_ID}/confirm`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body ?? JSON.stringify({}),
    },
  );
}

const routeContext = { params: Promise.resolve({ id: DOCUMENT_ID }) };

describe("POST /api/documents/:id/confirm", () => {
  beforeEach(() => {
    resolveDocumentRequestContext.mockReset();
    confirmDocumentUpload.mockReset();
    resolveDocumentRequestContext.mockResolvedValue({
      repository: REPOSITORY,
      session: {
        prestataireId: DOCUMENT.prestataireId,
        userId: DOCUMENT.uploadedBy,
      },
    });
  });

  it("confirme et laisse le document en awaiting_processing", async () => {
    confirmDocumentUpload.mockResolvedValue({ ok: true, value: DOCUMENT });

    const { POST } = await import("./route");
    const response = await POST(confirmRequest(), routeContext);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      document: {
        id: DOCUMENT_ID,
        // Jamais 'stored' : aucune chaîne d'analyse n'existe.
        status: "awaiting_processing",
        originalFilename: "facture.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        creanceId: null,
        createdAt: DOCUMENT.createdAt,
      },
    });
    expect(confirmDocumentUpload).toHaveBeenCalledWith(REPOSITORY, {
      documentId: DOCUMENT_ID,
      checksum: null,
    });
  });

  it("accepte un corps vide (confirmation sans empreinte)", async () => {
    confirmDocumentUpload.mockResolvedValue({ ok: true, value: DOCUMENT });

    const { POST } = await import("./route");
    const response = await POST(confirmRequest(""), routeContext);

    expect(response.status).toBe(200);
    expect(confirmDocumentUpload).toHaveBeenCalledWith(REPOSITORY, {
      documentId: DOCUMENT_ID,
      checksum: null,
    });
  });

  it("répond 401 sans session", async () => {
    resolveDocumentRequestContext.mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = await POST(confirmRequest(), routeContext);

    expect(response.status).toBe(401);
    expect(confirmDocumentUpload).not.toHaveBeenCalled();
  });

  it("répond 422 quand le fichier reçu diverge de ce qui était annoncé", async () => {
    confirmDocumentUpload.mockResolvedValue({
      ok: false,
      error: new DocumentError(
        "document_quarantined",
        "Le fichier reçu ne correspond pas à ce qui avait été annoncé.",
      ),
    });

    const { POST } = await import("./route");
    const response = await POST(confirmRequest(), routeContext);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "document_quarantined",
    });
  });

  it("répond 404 pour un document hors tenant, sans révéler son existence", async () => {
    confirmDocumentUpload.mockResolvedValue({
      ok: false,
      error: new DocumentError(
        "document_not_found",
        "document_not_found dans public.document",
      ),
    });

    const { POST } = await import("./route");
    const response = await POST(confirmRequest(), routeContext);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "document_not_found",
      message: "Document introuvable.",
    });
  });

  it("n’expose aucune autre méthode", async () => {
    const { GET, PUT, PATCH, DELETE } = await import("./route");
    for (const handler of [GET, PUT, PATCH, DELETE]) {
      const response = await handler();
      expect(response.status).toBe(405);
    }
  });
});
