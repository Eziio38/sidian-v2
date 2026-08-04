import { describe, expect, it } from "vitest";

import {
  MAX_DOCUMENT_FILE_SIZE,
  buildAttachmentReceiptReply,
  classifyAttachmentVisualType,
  classifyDocumentAttachment,
  validateDocumentFiles,
} from "./document-attachments";
import type { MessageAttachment } from "./types";

function attachment(
  name: string,
  type: string,
  category = classifyDocumentAttachment({ name, type }),
  positionInGroup = 1,
): MessageAttachment {
  return {
    id: `file-${positionInGroup}-${name}`,
    name,
    size: 10,
    type,
    extension: name.split(".").pop()?.toLowerCase() ?? "",
    positionInGroup,
    messageId: "message-1",
    category,
    persistenceStatus: "temporary",
  };
}

describe("document attachments", () => {
  it("conserve deux fichiers pris en charge qui portent le même nom", () => {
    const first = new File(["a"], "facture.pdf", {
      type: "application/pdf",
      lastModified: 1,
    });
    const second = new File(["b"], "facture.pdf", {
      type: "application/pdf",
      lastModified: 2,
    });

    expect(validateDocumentFiles([first, second])).toEqual({
      accepted: [first, second],
      rejected: [],
    });
  });

  it("refuse un format inconnu, un fichier vide et un fichier trop lourd", () => {
    const unknown = new File(["x"], "programme.exe", {
      type: "application/octet-stream",
    });
    const empty = new File([], "vide.pdf", { type: "application/pdf" });
    const large = new File(
      [new Uint8Array(MAX_DOCUMENT_FILE_SIZE + 1)],
      "archive.zip",
      { type: "application/zip" },
    );

    const result = validateDocumentFiles([unknown, empty, large]);
    expect(result.accepted).toEqual([]);
    expect(result.rejected.map((item) => item.reason)).toEqual([
      "unsupported",
      "empty",
      "too_large",
    ]);
  });

  it.each([
    ["contrat.pdf", "application/pdf", "pdf"],
    ["notes.txt", "text/plain", "text"],
    ["memo.mp3", "audio/mpeg", "audio"],
    ["photo.png", "image/png", "image"],
    ["donnees.xlsx", "application/vnd.ms-excel", "spreadsheet"],
    ["archive.zip", "application/zip", "archive"],
    [
      "courrier.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "word",
    ],
    ["donnees.bin", "application/octet-stream", "unknown"],
  ])("classe %s via MIME puis extension", (name, type, expected) => {
    expect(classifyAttachmentVisualType({ name, type })).toBe(expected);
  });

  it("adapte la réponse à une facture, un TXT et un MP3", () => {
    expect(
      buildAttachmentReceiptReply([
        attachment("facture-juillet.pdf", "application/pdf", "invoice"),
      ]),
    ).toMatch(/bien reçu cette facture/i);
    expect(
      buildAttachmentReceiptReply([
        attachment("notes.txt", "text/plain", "text"),
      ]),
    ).toMatch(/document texte/i);
    expect(
      buildAttachmentReceiptReply([
        attachment("memo.mp3", "audio/mpeg", "audio"),
      ]),
    ).toMatch(/transcription automatique sera bientôt disponible/i);
  });

  it("regroupe plusieurs factures dans une seule réponse", () => {
    const reply = buildAttachmentReceiptReply([
      attachment("facture-a.pdf", "application/pdf", "invoice", 1),
      attachment("facture-b.pdf", "application/pdf", "invoice", 2),
    ]);
    expect(reply).toMatch(/ces 2 factures/i);
    expect(reply.match(/J’ai bien reçu/g)).toHaveLength(1);
  });

  it("produit un inventaire exact pour un groupe mixte", () => {
    const reply = buildAttachmentReceiptReply([
      attachment("facture-a.pdf", "application/pdf", "invoice", 1),
      attachment("notes.txt", "text/plain", "text", 2),
      attachment("memo.mp3", "audio/mpeg", "audio", 3),
    ]);
    expect(reply).toMatch(
      /3 fichiers : 1 facture, 1 document texte et 1 fichier audio/i,
    );
    expect(reply).toMatch(/lecture et la transcription automatiques/i);
  });

  it("n’utilise pas la formulation négative interdite", () => {
    const replies = [
      attachment("facture.pdf", "application/pdf", "invoice"),
      attachment("notes.txt", "text/plain", "text"),
      attachment("memo.mp3", "audio/mpeg", "audio"),
      attachment("archive.zip", "application/zip", "archive"),
    ].map((file) => buildAttachmentReceiptReply([file]));
    expect(replies.join("\n")).not.toMatch(/Je ne peux pas encore lire/i);
  });
});
