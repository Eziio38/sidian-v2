/**
 * Interfaces d'extraction de contenu — DÉFINITIONS UNIQUEMENT.
 *
 * Aucune extraction n'existe dans le produit : ni OCR, ni parsing PDF côté
 * serveur, ni transcription audio. `pdfjs-dist` n'est utilisé que par
 * `src/components/assistant/pdf-document-preview.tsx`, en dynamic import
 * navigateur, pour afficher un aperçu — il ne produit aucune donnée
 * persistée et ne tourne jamais côté serveur.
 *
 * Ce fichier décrit le contrat qu'un futur fournisseur devrait respecter, et
 * fournit une implémentation `disabled` qui déclare l'indisponibilité. Elle ne
 * renvoie jamais de contenu : un texte inventé serait indiscernable d'un texte
 * réellement extrait, donc inacceptable.
 */

import { DocumentError } from "./errors";
import type { DocumentRecord } from "./types";

export type DocumentExtractionKind = "ocr" | "pdf_text" | "transcription";

export type DocumentExtractionRequest = {
  document: DocumentRecord;
  kind: DocumentExtractionKind;
};

export type DocumentExtractionUnavailableReason =
  | "capability_not_implemented"
  | "unsupported_mime_type"
  | "document_not_readable";

export type DocumentExtractionOutcome =
  | {
      status: "extracted";
      kind: DocumentExtractionKind;
      providerId: string;
      text: string;
      /** `null` quand le fournisseur ne sait pas paginer la source. */
      pages: number | null;
      /** `null` quand le fournisseur ne publie pas de score. */
      confidence: number | null;
    }
  | {
      status: "unavailable";
      reason: DocumentExtractionUnavailableReason;
      message: string;
    }
  | {
      status: "failed";
      code: string;
      message: string;
    };

export interface DocumentExtractionProvider {
  readonly id: string;
  /** Doit renvoyer `false` tant que le fournisseur ne sait pas réellement traiter la source. */
  supports(kind: DocumentExtractionKind, mimeType: string): boolean;
  extract(request: DocumentExtractionRequest): Promise<DocumentExtractionOutcome>;
}

export const DOCUMENT_EXTRACTION_UNAVAILABLE_MESSAGE =
  "Aucune analyse de contenu n’est disponible : les documents sont conservés tels quels.";

/**
 * Fournisseur par défaut, et seul existant. Toute tentative d'extraction
 * répond « indisponible » — le document reste en `awaiting_processing`.
 */
export const disabledDocumentExtractionProvider: DocumentExtractionProvider = {
  id: "disabled",
  supports() {
    return false;
  },
  async extract() {
    return {
      status: "unavailable",
      reason: "capability_not_implemented",
      message: DOCUMENT_EXTRACTION_UNAVAILABLE_MESSAGE,
    };
  },
};

export function isDocumentExtractionAvailable(
  provider: DocumentExtractionProvider,
  kind: DocumentExtractionKind,
  mimeType: string,
): boolean {
  return provider.supports(kind, mimeType);
}

export function documentExtractionUnavailableError(
  message = DOCUMENT_EXTRACTION_UNAVAILABLE_MESSAGE,
): DocumentError {
  return new DocumentError("document_extraction_unavailable", message);
}
