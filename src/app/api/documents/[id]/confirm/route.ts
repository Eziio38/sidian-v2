/**
 * POST /api/documents/:id/confirm — déclare les octets présents dans le bucket.
 *
 * La confirmation ne croit pas le client : `confirm_document_upload` relit la
 * taille et le type réellement stockés et met le document en quarantaine en
 * cas de divergence. Le document confirmé passe en `awaiting_processing` —
 * octets présents, contenu JAMAIS analysé. Aucune extraction n'existe dans le
 * produit et cette route n'en simule aucune.
 */

import "server-only";

import { z } from "zod";

import { DocumentError } from "@/lib/documents/errors";
import {
  DOCUMENT_NO_STORE_HEADERS,
  documentErrorResponse,
} from "@/lib/documents/http";
import { confirmDocumentUpload } from "@/lib/documents/service";
import { resolveDocumentRequestContext } from "@/lib/documents/server-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConfirmRouteContext = {
  params: Promise<{ id: string }>;
};

const confirmBodySchema = z
  .object({
    /** SHA-256 optionnel, purement indicatif : jamais recalculé côté serveur. */
    checksum: z.string().nullish(),
  })
  .strict();

export async function POST(
  request: Request,
  context: ConfirmRouteContext,
): Promise<Response> {
  const { id } = await context.params;

  // Corps absent = confirmation sans empreinte : cas nominal, pas une erreur.
  let body: unknown = {};
  const raw = await request.text();
  if (raw.trim() !== "") {
    try {
      body = JSON.parse(raw);
    } catch {
      return documentErrorResponse(
        new DocumentError("document_input_invalid", "Requête invalide."),
      );
    }
  }

  const parsed = confirmBodySchema.safeParse(body);
  if (!parsed.success) {
    return documentErrorResponse(
      new DocumentError("document_input_invalid", "Requête invalide."),
    );
  }

  const session = await resolveDocumentRequestContext();
  if (!session) {
    return Response.json(
      { code: "not_authenticated", message: "Authentification requise." },
      { status: 401, headers: DOCUMENT_NO_STORE_HEADERS },
    );
  }

  const result = await confirmDocumentUpload(session.repository, {
    documentId: id,
    checksum: parsed.data.checksum ?? null,
  });

  if (!result.ok) {
    return documentErrorResponse(result.error);
  }

  const document = result.value;
  return Response.json(
    {
      document: {
        id: document.id,
        status: document.status,
        originalFilename: document.originalFilename,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        creanceId: document.creanceId,
        createdAt: document.createdAt,
      },
    },
    { headers: DOCUMENT_NO_STORE_HEADERS },
  );
}

function methodNotAllowed(): Response {
  return Response.json(
    { code: "method_not_allowed", message: "Méthode non autorisée." },
    {
      status: 405,
      headers: { ...DOCUMENT_NO_STORE_HEADERS, Allow: "POST" },
    },
  );
}

export async function GET(): Promise<Response> {
  return methodNotAllowed();
}

export async function PUT(): Promise<Response> {
  return methodNotAllowed();
}

export async function PATCH(): Promise<Response> {
  return methodNotAllowed();
}

export async function DELETE(): Promise<Response> {
  return methodNotAllowed();
}
