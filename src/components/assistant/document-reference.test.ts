import { describe, expect, it } from "vitest";

import {
  resolveDocumentRequest,
  type DocumentRequestResolution,
} from "./document-reference";
import type {
  AssistantMessage,
  MessageAttachment,
  MessageAttachmentCategory,
} from "./types";

function file(
  id: string,
  name: string,
  category: MessageAttachmentCategory,
  positionInGroup: number,
  messageId: string,
): MessageAttachment {
  return {
    id,
    name,
    size: 10,
    type:
      category === "audio"
        ? "audio/mpeg"
        : category === "image"
          ? "image/png"
          : "application/pdf",
    extension: name.split(".").pop()?.toLowerCase() ?? "",
    positionInGroup,
    messageId,
    category,
    persistenceStatus: "temporary",
  };
}

function message(
  id: string,
  attachments: MessageAttachment[],
): AssistantMessage {
  return { id, role: "user", content: "", attachments, status: "sent" };
}

function resolved(
  result: DocumentRequestResolution | null,
): MessageAttachment[] {
  expect(result?.kind).toBe("resolved");
  return result?.kind === "resolved" ? result.attachments : [];
}

describe("document reference resolver", () => {
  const first = file("f1", "facture-1.pdf", "invoice", 1, "m1");
  const second = file("f2", "facture-2.pdf", "invoice", 2, "m1");
  const latest = file("f3", "facture-3.pdf", "invoice", 1, "m2");
  const history = [
    message("m1", [first, second]),
    message("m2", [latest]),
  ];

  it("résout « Protège-les » vers le dernier groupe", () => {
    expect(resolved(resolveDocumentRequest("Protège-les", history))).toEqual([
      latest,
    ]);
  });

  it("résout « protège-la » avec ponctuation quand le dernier groupe est unique", () => {
    expect(
      resolved(resolveDocumentRequest("PROTÈGE-LA !", history)),
    ).toEqual([latest]);
  });

  it("demande une précision pour « protège-la » si le groupe est pluriel", () => {
    expect(
      resolveDocumentRequest(
        "Protège-la.",
        [message("m1", [first, second])],
      ),
    ).toEqual({
      kind: "clarification",
      message: "Parlez-vous de la première facture ou des 2 factures ?",
    });
  });

  it("résout le premier dans le dernier groupe concerné", () => {
    expect(
      resolved(
        resolveDocumentRequest(
          "Crée une protection pour le premier",
          [message("m1", [first, second])],
        ),
      ),
    ).toEqual([first]);
  });

  it("résout le dernier fichier de la conversation", () => {
    expect(
      resolved(resolveDocumentRequest("Supprime le dernier fichier", history)),
    ).toEqual([latest]);
  });

  it("demande une précision pour une référence singulière ambiguë", () => {
    const result = resolveDocumentRequest(
      "Crée une protection pour cette facture",
      [message("m1", [first, second])],
    );
    expect(result).toEqual({
      kind: "clarification",
      message: "Parlez-vous de la première facture ou des 2 factures ?",
    });
  });

  it("ne récupère aucun fichier d’une autre conversation", () => {
    expect(resolveDocumentRequest("Protège-les", [])).toEqual({
      kind: "clarification",
      message:
        "Je n’ai pas encore suffisamment de contexte pour exécuter cette demande. Pouvez-vous préciser le document concerné et l’action souhaitée ?",
    });
  });
});
