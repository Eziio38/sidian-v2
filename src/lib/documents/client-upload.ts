/**
 * Téléversement d'une pièce jointe depuis le navigateur.
 *
 * Trois étapes, aucune raccourcie :
 *   1. POST /api/documents        → ligne `document` réservée + URL signée ;
 *   2. PUT vers l'URL signée      → les octets partent directement au bucket ;
 *   3. POST /api/documents/:id/confirm → le serveur relit taille et type réels.
 *
 * Ce module ne connaît ni le tenant ni le chemin de stockage : les deux sont
 * calculés côté SQL à partir de la session. Il ne renvoie jamais « enregistré »
 * sans avoir obtenu la confirmation de l'étape 3 — un fichier perdu doit se
 * voir, pas se deviner.
 *
 * Aucune analyse de contenu n'est déclenchée : le document reste en
 * `awaiting_processing`, c'est-à-dire « octets présents, contenu jamais lu ».
 */

import { isAllowedDocumentMimeType, normaliseDocumentMimeType } from "./schemas";
import type { DocumentStatus } from "./types";

export const DOCUMENT_UPLOAD_GENERIC_ERROR =
  "Ce fichier n’a pas pu être enregistré. Il n’est pas conservé.";

export type DocumentUploadFailure = {
  code: string;
  message: string;
};

export type DocumentUploadOutcome =
  | {
      ok: true;
      documentId: string;
      status: DocumentStatus;
      storagePath: string;
    }
  | { ok: false; error: DocumentUploadFailure };

export type PersistDocumentAttachmentOptions = {
  creanceId?: string | null;
  signal?: AbortSignal;
  /** Injection pour les tests — jamais fournie par le produit. */
  fetchImpl?: typeof fetch;
};

type RegisterResponseBody = {
  document?: { id?: unknown; status?: unknown };
  upload?: { url?: unknown; token?: unknown; storagePath?: unknown };
};

function failure(code: string, message: string): DocumentUploadOutcome {
  return { ok: false, error: { code, message } };
}

/**
 * Lit `{ code, message }` d'une réponse d'erreur de nos routes. Le message
 * vient du serveur : il est déjà rédigé et déjà expurgé. En cas de corps
 * illisible on retombe sur un message générique plutôt que d'inventer une
 * cause.
 */
async function readErrorBody(
  response: Response,
): Promise<DocumentUploadFailure> {
  try {
    const body = (await response.json()) as {
      code?: unknown;
      message?: unknown;
    };
    const code = typeof body.code === "string" ? body.code : "document_upload_failed";
    const message =
      typeof body.message === "string" && body.message.trim() !== ""
        ? body.message
        : DOCUMENT_UPLOAD_GENERIC_ERROR;
    return { code, message };
  } catch {
    return {
      code: "document_upload_failed",
      message: DOCUMENT_UPLOAD_GENERIC_ERROR,
    };
  }
}

export async function persistDocumentAttachment(
  file: File,
  options: PersistDocumentAttachmentOptions = {},
): Promise<DocumentUploadOutcome> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    return failure(
      "document_upload_unavailable",
      DOCUMENT_UPLOAD_GENERIC_ERROR,
    );
  }

  const mimeType = normaliseDocumentMimeType(file.type ?? "");
  // Garde locale alignée sur l'allowlist serveur : inutile de téléverser des
  // octets que la confirmation mettrait en quarantaine.
  if (!isAllowedDocumentMimeType(mimeType)) {
    return failure(
      "document_mime_not_allowed",
      "Ce format de fichier n’est pas pris en charge.",
    );
  }

  let register: Response;
  try {
    register = await doFetch("/api/documents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      signal: options.signal,
      body: JSON.stringify({
        filename: file.name,
        mimeType,
        sizeBytes: file.size,
        creanceId: options.creanceId ?? null,
      }),
    });
  } catch {
    return failure("document_network_error", DOCUMENT_UPLOAD_GENERIC_ERROR);
  }

  if (!register.ok) {
    return { ok: false, error: await readErrorBody(register) };
  }

  let registered: RegisterResponseBody;
  try {
    registered = (await register.json()) as RegisterResponseBody;
  } catch {
    return failure("document_upload_failed", DOCUMENT_UPLOAD_GENERIC_ERROR);
  }

  const documentId = registered.document?.id;
  const uploadUrl = registered.upload?.url;
  const storagePath = registered.upload?.storagePath;
  if (
    typeof documentId !== "string" ||
    typeof uploadUrl !== "string" ||
    typeof storagePath !== "string"
  ) {
    return failure("document_upload_failed", DOCUMENT_UPLOAD_GENERIC_ERROR);
  }

  // Corps multipart identique à `uploadToSignedUrl` de storage-js : le type
  // MIME réellement enregistré par le bucket est celui porté par la part, donc
  // celui du File — le même que celui déclaré à l'étape 1.
  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", file, file.name);

  let upload: Response;
  try {
    upload = await doFetch(uploadUrl, {
      method: "PUT",
      headers: { "x-upsert": "false" },
      signal: options.signal,
      body: form,
    });
  } catch {
    return failure("document_network_error", DOCUMENT_UPLOAD_GENERIC_ERROR);
  }

  if (!upload.ok) {
    return failure("document_object_upload_failed", DOCUMENT_UPLOAD_GENERIC_ERROR);
  }

  let confirm: Response;
  try {
    confirm = await doFetch(
      `/api/documents/${encodeURIComponent(documentId)}/confirm`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        signal: options.signal,
        body: JSON.stringify({}),
      },
    );
  } catch {
    return failure("document_network_error", DOCUMENT_UPLOAD_GENERIC_ERROR);
  }

  if (!confirm.ok) {
    return { ok: false, error: await readErrorBody(confirm) };
  }

  let confirmed: { document?: { status?: unknown } };
  try {
    confirmed = (await confirm.json()) as { document?: { status?: unknown } };
  } catch {
    return failure("document_upload_failed", DOCUMENT_UPLOAD_GENERIC_ERROR);
  }

  const status =
    typeof confirmed.document?.status === "string"
      ? (confirmed.document.status as DocumentStatus)
      : null;
  if (status === null) {
    return failure("document_upload_failed", DOCUMENT_UPLOAD_GENERIC_ERROR);
  }

  return { ok: true, documentId, status, storagePath };
}
