/**
 * POST /api/documents — réserve une ligne `document` et signe l'URL d'upload.
 *
 * Le corps ne peut pas désigner de tenant : `prestataire_id`, `uploaded_by` et
 * le chemin de stockage sont calculés par `register_document_upload` à partir
 * de `auth.uid()`. Taille et type MIME sont validés ici avec les MÊMES
 * constantes que la base (src/lib/documents/schemas.ts), puis revalidés par la
 * contrainte SQL et par le bucket : trois barrières, une seule source.
 *
 * Aucun octet ne transite par cette route : le navigateur téléverse ensuite
 * directement vers l'URL signée, puis appelle /api/documents/:id/confirm.
 */

import "server-only";

import { z } from "zod";

import { DocumentError } from "@/lib/documents/errors";
import {
  DOCUMENT_NO_STORE_HEADERS,
  documentErrorResponse,
} from "@/lib/documents/http";
import { registerDocumentUpload } from "@/lib/documents/service";
import { resolveDocumentRequestContext } from "@/lib/documents/server-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Schéma d'enveloppe uniquement : le détail (allowlist MIME, plafond de
 * taille, forme du nom) appartient au service, qui sait produire un code
 * d'erreur explicite par motif de refus.
 */
const registerBodySchema = z
  .object({
    filename: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number(),
    creanceId: z.string().nullish(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return documentErrorResponse(
      new DocumentError("document_input_invalid", "Requête invalide."),
    );
  }

  const parsed = registerBodySchema.safeParse(body);
  if (!parsed.success) {
    return documentErrorResponse(
      new DocumentError("document_input_invalid", "Requête invalide."),
    );
  }

  const context = await resolveDocumentRequestContext();
  if (!context) {
    return Response.json(
      { code: "not_authenticated", message: "Authentification requise." },
      { status: 401, headers: DOCUMENT_NO_STORE_HEADERS },
    );
  }

  const result = await registerDocumentUpload(context.repository, {
    filename: parsed.data.filename,
    mimeType: parsed.data.mimeType,
    sizeBytes: parsed.data.sizeBytes,
    creanceId: parsed.data.creanceId ?? null,
  });

  if (!result.ok) {
    return documentErrorResponse(result.error);
  }

  const { document, uploadUrl, uploadToken } = result.value;
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
      // `storagePath` est nécessaire au navigateur pour appeler
      // `uploadToSignedUrl`. Il ne révèle rien de plus que l'identifiant du
      // prestataire, que la session possède déjà.
      upload: {
        storagePath: document.storagePath,
        url: uploadUrl,
        token: uploadToken,
      },
    },
    { status: 201, headers: DOCUMENT_NO_STORE_HEADERS },
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
