import { describe, expect, it, vi } from "vitest";

import {
  DOCUMENT_UPLOAD_GENERIC_ERROR,
  persistDocumentAttachment,
} from "./client-upload";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const REGISTERED = {
  document: { id: "11111111-1111-4111-8111-111111111111", status: "pending_upload" },
  upload: {
    storagePath: "presta/doc/facture.pdf",
    url: "http://127.0.0.1:54321/storage/v1/object/upload/sign/documents/presta/doc/facture.pdf?token=t",
    token: "t",
  },
};

function pdf(name = "facture.pdf"): File {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" });
}

describe("persistDocumentAttachment", () => {
  it("enchaîne réservation, téléversement et confirmation", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(REGISTERED, 201))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse({
          document: {
            id: REGISTERED.document.id,
            status: "awaiting_processing",
          },
        }),
      );

    const outcome = await persistDocumentAttachment(pdf(), { fetchImpl });

    expect(outcome).toEqual({
      ok: true,
      documentId: REGISTERED.document.id,
      // Le seul état terminal possible aujourd'hui : aucune analyse de contenu.
      status: "awaiting_processing",
      storagePath: REGISTERED.upload.storagePath,
    });

    const [registerUrl, registerInit] = fetchImpl.mock.calls[0]!;
    expect(registerUrl).toBe("/api/documents");
    expect(JSON.parse(String(registerInit?.body))).toEqual({
      filename: "facture.pdf",
      mimeType: "application/pdf",
      sizeBytes: pdf().size,
      creanceId: null,
    });

    const [uploadUrl, uploadInit] = fetchImpl.mock.calls[1]!;
    expect(uploadUrl).toBe(REGISTERED.upload.url);
    expect(uploadInit?.method).toBe("PUT");
    expect(uploadInit?.body).toBeInstanceOf(FormData);

    expect(fetchImpl.mock.calls[2]![0]).toBe(
      `/api/documents/${REGISTERED.document.id}/confirm`,
    );
  });

  it("refuse un format hors allowlist sans rien téléverser", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const archive = new File(["x"], "dossier.zip", { type: "application/zip" });

    const outcome = await persistDocumentAttachment(archive, { fetchImpl });

    expect(outcome).toEqual({
      ok: false,
      error: {
        code: "document_mime_not_allowed",
        message: "Ce format de fichier n’est pas pris en charge.",
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("remonte le refus serveur tel quel plutôt qu’un succès silencieux", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            code: "document_too_large",
            message: "Le fichier dépasse la limite autorisée.",
          },
          413,
        ),
      );

    const outcome = await persistDocumentAttachment(pdf(), { fetchImpl });

    expect(outcome).toEqual({
      ok: false,
      error: {
        code: "document_too_large",
        message: "Le fichier dépasse la limite autorisée.",
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("n’annonce jamais un enregistrement quand les octets n’arrivent pas", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(REGISTERED, 201))
      .mockResolvedValueOnce(new Response("nope", { status: 400 }));

    const outcome = await persistDocumentAttachment(pdf(), { fetchImpl });

    expect(outcome).toEqual({
      ok: false,
      error: {
        code: "document_object_upload_failed",
        message: DOCUMENT_UPLOAD_GENERIC_ERROR,
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("signale une mise en quarantaine au lieu de la masquer", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(REGISTERED, 201))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            code: "document_quarantined",
            message:
              "Le fichier reçu ne correspond pas à ce qui avait été annoncé.",
          },
          422,
        ),
      );

    const outcome = await persistDocumentAttachment(pdf(), { fetchImpl });

    expect(outcome).toEqual({
      ok: false,
      error: {
        code: "document_quarantined",
        message:
          "Le fichier reçu ne correspond pas à ce qui avait été annoncé.",
      },
    });
  });

  it("traduit une panne réseau en échec explicite", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("network down"));

    const outcome = await persistDocumentAttachment(pdf(), { fetchImpl });

    expect(outcome).toEqual({
      ok: false,
      error: {
        code: "document_network_error",
        message: DOCUMENT_UPLOAD_GENERIC_ERROR,
      },
    });
  });
});
