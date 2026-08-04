/**
 * Heuristique UI : un fichier est-il utilisable comme facture pour préparer
 * une protection ? Pas d’OCR — uniquement type MIME + nom de fichier.
 */

export type InvoiceAttachmentVerdict =
  | "likely_invoice"
  | "unlikely_invoice"
  | "unsupported";

const INVOICE_NAME =
  /\b(facture|invoice|receipt|re[cç]u|avoir|devis|bill|proforma)\b/i;

const INVOICE_INSTRUCTION =
  /\b(facture|invoice|paiement(?:\s+à\s+recevoir)?|r[eè]glement|protection)\b/i;

const SCREENSHOT_NAME =
  /\b(capture|screenshot|screen[_\s-]?shot|img_\d+|photo\s*\d*|whatsapp\s*image|simulator|mockup|ecran|écran)\b/i;

const INVOICE_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export type AttachmentLike = {
  name: string;
  type?: string;
};

export function hasInvoiceAttachmentIntent({
  files,
  instruction,
  explicit = false,
}: {
  files: AttachmentLike[];
  instruction: string;
  explicit?: boolean;
}): boolean {
  return (
    explicit ||
    INVOICE_INSTRUCTION.test(instruction) ||
    files.some((file) => INVOICE_NAME.test(file.name))
  );
}

export function classifyInvoiceAttachment(
  file: AttachmentLike,
): InvoiceAttachmentVerdict {
  const name = file.name.trim();
  const mime = (file.type || "").toLowerCase();

  if (SCREENSHOT_NAME.test(name)) {
    return "unlikely_invoice";
  }

  if (mime === "application/pdf" || /\.pdf$/i.test(name)) {
    return "likely_invoice";
  }

  if (INVOICE_MIME.has(mime) || /^image\//.test(mime)) {
    return INVOICE_NAME.test(name) ? "likely_invoice" : "unlikely_invoice";
  }

  // Office / archives / inconnus : pas exploitables comme facture ici.
  return "unsupported";
}

export function summarizeInvoiceAttachments(
  files: AttachmentLike[],
): {
  verdict: InvoiceAttachmentVerdict;
  names: string[];
} {
  if (files.length === 0) {
    return { verdict: "unsupported", names: [] };
  }

  const names = files.map((file) => file.name);
  const verdicts = files.map(classifyInvoiceAttachment);

  if (verdicts.every((v) => v === "likely_invoice")) {
    return { verdict: "likely_invoice", names };
  }
  if (verdicts.some((v) => v === "unlikely_invoice" || v === "unsupported")) {
    // Au moins un fichier non facture → on ne lance pas le parcours facture.
    const hasUnlikely = verdicts.some((v) => v === "unlikely_invoice");
    return {
      verdict: hasUnlikely ? "unlikely_invoice" : "unsupported",
      names,
    };
  }
  return { verdict: "unlikely_invoice", names };
}

export function buildNonInvoiceAttachmentReply(
  names: string[],
  verdict: Exclude<InvoiceAttachmentVerdict, "likely_invoice"> = "unlikely_invoice",
): string {
  const listed =
    names.length === 1
      ? `« ${names[0]} »`
      : names.map((name) => `« ${name} »`).join(", ");
  if (verdict === "unsupported") {
    return [
      `J’ai bien reçu ${listed}.`,
      "",
      "Ce format ne peut pas encore être analysé automatiquement. Vous pouvez néanmoins m’indiquer ce que vous souhaitez en faire.",
    ].join("\n");
  }

  return [
    `J’ai bien reçu ${listed}.`,
    "",
    "L’analyse visuelle sera bientôt disponible. Indiquez-moi ce que vous souhaitez en faire et je préparerai la suite.",
  ].join("\n");
}

export function buildLikelyInvoiceAttachmentReply(names: string[]): string {
  const listed =
    names.length === 1
      ? `« ${names[0]} »`
      : `les ${names.length} documents`;
  return [
    `J’ai bien reçu ${listed}.`,
    "",
    "La lecture automatique des documents sera bientôt disponible.",
    "",
    "Indiquez-moi ce que vous souhaitez faire et je préparerai directement la suite. Je peux déjà préparer une protection à partir des informations que vous me donnerez.",
  ].join("\n");
}
