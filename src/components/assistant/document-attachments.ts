import {
  Archive,
  AudioLines,
  File,
  FileText,
  FileType2,
  ImageIcon,
  Table2,
  type LucideIcon,
} from "lucide-react";

import {
  DOCUMENT_MAX_SIZE_BYTES,
  isAllowedDocumentMimeType,
} from "@/lib/documents/schemas";

import type {
  MessageAttachment,
  MessageAttachmentCategory,
} from "./types";

export type AttachmentLike = {
  name: string;
  type?: string;
  category?: MessageAttachmentCategory;
};

/**
 * Plafond de taille — repris de la source unique partagée avec le SQL
 * (`public.document_max_size_bytes()`). Cette constante reste exportée pour
 * les appelants existants, mais ne définit plus la valeur.
 */
export const MAX_DOCUMENT_FILE_SIZE = DOCUMENT_MAX_SIZE_BYTES;

export type RejectedDocumentFile = {
  file: File;
  reason: "empty" | "too_large" | "unsupported";
  message: string;
};

export function validateDocumentFiles(files: File[]): {
  accepted: File[];
  rejected: RejectedDocumentFile[];
} {
  const accepted: File[] = [];
  const rejected: RejectedDocumentFile[] = [];

  for (const file of files) {
    if (file.size === 0) {
      rejected.push({
        file,
        reason: "empty",
        message: `${file.name} est vide.`,
      });
      continue;
    }
    if (file.size > MAX_DOCUMENT_FILE_SIZE) {
      rejected.push({
        file,
        reason: "too_large",
        message: `${file.name} dépasse la limite de 20 Mo.`,
      });
      continue;
    }
    // Porte d'entrée : l'allowlist du stockage, pas la classification visuelle.
    // `classifyAttachmentVisualType` reconnaît des archives et de l'audio pour
    // savoir les AFFICHER (icône, libellé, historique déjà en base), alors que
    // DOCUMENT_ALLOWED_MIME_TYPES les refuse — un conteneur opaque ou un
    // enregistrement ne peut être ni contrôlé ni restitué honnêtement tant
    // qu'aucune analyse de contenu n'existe. Accepter ici ce que le serveur
    // rejettera ensuite reviendrait à promettre un enregistrement impossible.
    if (!isAllowedDocumentMimeType(file.type ?? "")) {
      rejected.push({
        file,
        reason: "unsupported",
        message: `${file.name} n’est pas un format pris en charge.`,
      });
      continue;
    }
    accepted.push(file);
  }

  return { accepted, rejected };
}

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "gif",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);
const AUDIO_EXTENSIONS = new Set([
  "aac",
  "flac",
  "m4a",
  "mp3",
  "oga",
  "ogg",
  "opus",
  "wav",
]);
const TEXT_EXTENSIONS = new Set(["md", "rtf", "text", "txt"]);
const SPREADSHEET_EXTENSIONS = new Set(["csv", "ods", "xls", "xlsx"]);
const ARCHIVE_EXTENSIONS = new Set(["7z", "gz", "rar", "tar", "tgz", "zip"]);
const WORD_EXTENSIONS = new Set(["doc", "docx"]);
const INVOICE_NAME =
  /\b(facture|invoice|receipt|re[cç]u|avoir|devis|bill|proforma)\b/i;

export function getAttachmentExtension(name: string): string {
  const match = /\.([^.]+)$/.exec(name.trim());
  return match?.[1]?.toLocaleLowerCase("en") ?? "";
}

export function classifyAttachmentVisualType(
  file: AttachmentLike,
): Exclude<MessageAttachmentCategory, "invoice"> {
  const mime = (file.type ?? "").trim().toLocaleLowerCase("en");
  const extension = getAttachmentExtension(file.name);

  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    mime === "text/csv" ||
    mime === "application/csv" ||
    mime.includes("opendocument.spreadsheet")
  ) {
    return "spreadsheet";
  }
  if (
    mime === "application/msword" ||
    mime.includes("wordprocessingml.document")
  ) {
    return "word";
  }
  if (
    mime.includes("zip") ||
    mime.includes("archive") ||
    mime.includes("compressed") ||
    mime === "application/x-7z-compressed" ||
    mime === "application/x-rar-compressed"
  ) {
    return "archive";
  }
  if (mime.startsWith("text/")) return "text";

  if (extension === "pdf") return "pdf";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (SPREADSHEET_EXTENSIONS.has(extension)) return "spreadsheet";
  if (ARCHIVE_EXTENSIONS.has(extension)) return "archive";
  if (WORD_EXTENSIONS.has(extension)) return "word";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  return "unknown";
}

export function classifyDocumentAttachment(
  file: AttachmentLike,
  options?: { invoiceContext?: boolean },
): MessageAttachmentCategory {
  const visualType = classifyAttachmentVisualType(file);
  const invoiceCandidate =
    visualType === "pdf" ||
    visualType === "image" ||
    visualType === "text" ||
    visualType === "word";
  if (
    invoiceCandidate &&
    (options?.invoiceContext || INVOICE_NAME.test(file.name))
  ) {
    return "invoice";
  }
  return visualType;
}

export function getAttachmentIcon(file: AttachmentLike): LucideIcon {
  switch (classifyAttachmentVisualType(file)) {
    case "pdf":
      return FileType2;
    case "image":
      return ImageIcon;
    case "audio":
      return AudioLines;
    case "text":
      return FileText;
    case "spreadsheet":
      return Table2;
    case "archive":
      return Archive;
    case "word":
      return FileText;
    default:
      return File;
  }
}

export function getAttachmentIconType(file: AttachmentLike): string {
  return classifyAttachmentVisualType(file);
}

function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function categoryInventory(
  attachments: MessageAttachment[],
): string | null {
  if (attachments.some((file) => file.category === "unknown")) return null;

  const order: Exclude<MessageAttachmentCategory, "unknown">[] = [
    "invoice",
    "pdf",
    "text",
    "word",
    "spreadsheet",
    "image",
    "audio",
    "archive",
  ];
  const labels: Record<
    Exclude<MessageAttachmentCategory, "unknown">,
    [string, string]
  > = {
    invoice: ["facture", "factures"],
    pdf: ["document PDF", "documents PDF"],
    text: ["document texte", "documents texte"],
    word: ["document Word", "documents Word"],
    spreadsheet: ["tableur", "tableurs"],
    image: ["image", "images"],
    audio: ["fichier audio", "fichiers audio"],
    archive: ["archive", "archives"],
  };
  const parts = order.flatMap((category) => {
    const count = attachments.filter((file) => file.category === category).length;
    if (count === 0) return [];
    const [singular, plural] = labels[category];
    return [pluralize(count, singular, plural)];
  });

  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0] ?? null;
  return `${parts.slice(0, -1).join(", ")} et ${parts.at(-1)}`;
}

function availabilityForGroup(attachments: MessageAttachment[]): string {
  const hasAudio = attachments.some((file) => file.category === "audio");
  const hasImage = attachments.some((file) => file.category === "image");
  const hasReadableDocument = attachments.some((file) =>
    ["invoice", "pdf", "text", "word", "spreadsheet"].includes(file.category),
  );

  if (hasAudio && (hasImage || hasReadableDocument)) {
    return "La lecture et la transcription automatiques seront bientôt disponibles.";
  }
  if (hasAudio) {
    return "La transcription automatique sera bientôt disponible.";
  }
  if (hasImage && !hasReadableDocument) {
    return "L’analyse visuelle sera bientôt disponible.";
  }
  return "La lecture automatique sera bientôt disponible.";
}

export function buildAttachmentReceiptReply(
  attachments: MessageAttachment[],
): string {
  if (attachments.length === 0) return "";

  if (attachments.length > 1) {
    const allInvoices = attachments.every((file) => file.category === "invoice");
    const inventory = categoryInventory(attachments);
    const receipt = allInvoices
      ? `J’ai bien reçu ces ${attachments.length} factures.`
      : inventory
        ? `J’ai bien reçu vos ${attachments.length} fichiers : ${inventory}.`
        : `J’ai bien reçu vos ${attachments.length} fichiers.`;
    return [
      receipt,
      "",
      availabilityForGroup(attachments),
      allInvoices
        ? "Dites-moi ce que vous souhaitez faire avec ces documents et je préparerai directement la suite."
        : "Indiquez-moi simplement ce que vous souhaitez obtenir à partir de ces fichiers.",
    ].join("\n");
  }

  const [attachment] = attachments;
  switch (attachment.category) {
    case "invoice":
      return [
        "J’ai bien reçu cette facture.",
        "",
        "La lecture automatique des documents sera bientôt disponible. En attendant, indiquez-moi simplement ce que vous souhaitez faire et je préparerai directement la suite.",
        "",
        "Je peux déjà préparer sa protection à partir des informations que vous me donnerez.",
      ].join("\n");
    case "pdf":
    case "word":
    case "spreadsheet":
      return [
        "J’ai bien reçu ce document.",
        "",
        "La lecture automatique des documents sera bientôt disponible. Indiquez-moi ce que vous souhaitez obtenir à partir de ce fichier et je préparerai directement la suite.",
      ].join("\n");
    case "text":
      return [
        "J’ai bien reçu ce document texte.",
        "",
        "Son analyse automatique sera bientôt disponible. Vous pouvez déjà m’indiquer ce que vous souhaitez en faire.",
      ].join("\n");
    case "audio":
      return [
        "J’ai bien reçu votre fichier audio.",
        "",
        "La transcription automatique sera bientôt disponible. Vous pouvez déjà me préciser ce que vous souhaitez préparer à partir de cet enregistrement.",
      ].join("\n");
    case "image":
      return [
        "J’ai bien reçu cette image.",
        "",
        "L’analyse visuelle sera bientôt disponible. Indiquez-moi ce que vous souhaitez en faire et je préparerai la suite.",
      ].join("\n");
    case "archive":
    case "unknown":
      return [
        "J’ai bien reçu ce fichier.",
        "",
        "Ce format ne peut pas encore être analysé automatiquement. Vous pouvez néanmoins m’indiquer ce que vous souhaitez en faire.",
      ].join("\n");
  }
}
