import {
  classifyAttachmentVisualType,
  type AttachmentLike,
} from "./document-attachments";
import type { AssistantMessage, MessageAttachment } from "./types";

export type DocumentRequestAction =
  | "protect"
  | "create_client"
  | "capabilities"
  | "remove"
  | "keep"
  | "reuse";

export type DocumentRequestResolution =
  | {
      kind: "resolved";
      action: DocumentRequestAction;
      attachments: MessageAttachment[];
    }
  | {
      kind: "clarification";
      message: string;
    };

const DOCUMENT_REFERENCE =
  /\b(document|documents|fichier|fichiers|facture|factures|audio|pdf|premi(?:er|ère)|deuxi[eè]me|second(?:e)?|dernier|dernière|celui-ci|celle-ci|ce|cette|ces|la|le|les|lui|leur|eux)\b/i;
const PROTECT_ACTION =
  /\b(prot[eè]ge(?:r|z)?|s[eé]curise(?:r|z)?|cr[eé](?:e|er|ez).{0,28}protection)\b/i;
const CREATE_CLIENT_ACTION =
  /\b(cr[eé](?:e|er|ez)|ajoute(?:r|z)?).{0,24}client\b/i;
const REMOVE_ACTION =
  /\b(supprime(?:r|z)?|retire(?:r|z)?|enl[eè]ve(?:r|z)?)\b/i;
const KEEP_ACTION = /\bgarde(?:r|z)?\s+seulement\b/i;
const CAPABILITY_ACTION = /\b(que peux-tu faire|quoi faire|possible de faire)\b/i;
const REUSE_ACTION = /\b(reprends?|utilise(?:r|z)?|prends?)\b/i;

function attachmentGroups(messages: AssistantMessage[]): MessageAttachment[][] {
  return messages.flatMap((message) =>
    message.role === "user" && message.attachments?.length
      ? [[...message.attachments].sort(
          (left, right) => left.positionInGroup - right.positionInGroup,
        )]
      : [],
  );
}

function categoryMatches(
  attachment: MessageAttachment,
  category: "invoice" | "audio" | "pdf",
): boolean {
  if (category === "invoice") return attachment.category === "invoice";
  if (category === "audio") return attachment.category === "audio";
  return classifyAttachmentVisualType(attachment as AttachmentLike) === "pdf";
}

function actionFromContent(content: string): DocumentRequestAction | null {
  if (KEEP_ACTION.test(content)) return "keep";
  if (REMOVE_ACTION.test(content)) return "remove";
  if (PROTECT_ACTION.test(content)) return "protect";
  if (CREATE_CLIENT_ACTION.test(content)) return "create_client";
  if (CAPABILITY_ACTION.test(content)) return "capabilities";
  if (REUSE_ACTION.test(content)) return "reuse";
  return null;
}

function clarificationForLatestGroup(group: MessageAttachment[]): string {
  const invoices = group.filter((file) => file.category === "invoice").length;
  if (invoices > 1) {
    return `Parlez-vous de la première facture ou des ${invoices} factures ?`;
  }
  return "Pouvez-vous préciser le document concerné ?";
}

export function resolveDocumentRequest(
  content: string,
  messages: AssistantMessage[],
): DocumentRequestResolution | null {
  const action = actionFromContent(content);
  if (!action || !DOCUMENT_REFERENCE.test(content)) return null;

  const groups = attachmentGroups(messages);
  const latestGroup = groups.at(-1) ?? [];
  const allAttachments = groups.flat();
  if (allAttachments.length === 0) {
    return {
      kind: "clarification",
      message:
        "Je n’ai pas encore suffisamment de contexte pour exécuter cette demande. Pouvez-vous préciser le document concerné et l’action souhaitée ?",
    };
  }

  if (
    /\b(prot[eè]ge(?:r|z)?-?les|ces (?:documents|fichiers|factures)|les (?:documents|fichiers))\b/i.test(
      content,
    )
  ) {
    return { kind: "resolved", action, attachments: latestGroup };
  }

  if (/\bprot[eè]ge(?:r|z)?-?(?:la|le|lui)\b/i.test(content)) {
    return latestGroup.length === 1
      ? { kind: "resolved", action, attachments: latestGroup }
      : {
          kind: "clarification",
          message: clarificationForLatestGroup(latestGroup),
        };
  }

  if (/\b(?:les|des)\s+factures\b/i.test(content)) {
    const scope = /\b(juste avant|pr[eé]c[eé]dent(?:e|s)?)\b/i.test(content)
      ? latestGroup
      : allAttachments;
    const invoices = scope.filter((file) => categoryMatches(file, "invoice"));
    const requestedCount = /\b([2-9])\s+factures\b/i.exec(content)?.[1];
    if (requestedCount && invoices.length !== Number(requestedCount)) {
      return {
        kind: "clarification",
        message: `Je retrouve ${invoices.length} ${
          invoices.length === 1 ? "facture" : "factures"
        } dans le groupe concerné. Souhaitez-vous les utiliser ?`,
      };
    }
    return invoices.length > 0
      ? { kind: "resolved", action, attachments: invoices }
      : {
          kind: "clarification",
          message: "Je ne retrouve pas de facture dans cette conversation.",
        };
  }

  if (/\b(premi(?:er|ère)|1(?:er|re)?)\b/i.test(content)) {
    const first = latestGroup[0];
    return first
      ? { kind: "resolved", action, attachments: [first] }
      : null;
  }

  if (/\b(deuxi[eè]me|second(?:e)?|2e?)\b/i.test(content)) {
    const second = latestGroup[1];
    return second
      ? { kind: "resolved", action, attachments: [second] }
      : {
          kind: "clarification",
          message: "Je ne retrouve pas de deuxième document dans le dernier envoi.",
        };
  }

  if (/\b(dernier|dernière)\b/i.test(content)) {
    const last = allAttachments.at(-1);
    return last
      ? { kind: "resolved", action, attachments: [last] }
      : null;
  }

  const requestedCategory = /\baudio\b/i.test(content)
    ? "audio"
    : /\bpdf\b/i.test(content)
      ? "pdf"
      : null;
  if (requestedCategory) {
    const matching = allAttachments.filter((file) =>
      categoryMatches(file, requestedCategory),
    );
    if (matching.length === 1) {
      return { kind: "resolved", action, attachments: matching };
    }
    if (matching.length > 1) {
      return {
        kind: "clarification",
        message: `Vous avez envoyé plusieurs ${
          requestedCategory === "pdf" ? "PDF" : "fichiers audio"
        }. Lequel souhaitez-vous utiliser ?`,
      };
    }
    return {
      kind: "clarification",
      message: `Je ne retrouve pas de ${
        requestedCategory === "pdf" ? "PDF" : "fichier audio"
      } dans cette conversation.`,
    };
  }

  if (
    /\b(ce document|cette facture|ce fichier|celui-ci|celle-ci|lui)\b/i.test(
      content,
    )
  ) {
    if (latestGroup.length === 1) {
      return { kind: "resolved", action, attachments: latestGroup };
    }
    return {
      kind: "clarification",
      message: clarificationForLatestGroup(latestGroup),
    };
  }

  if (latestGroup.length === 1) {
    return { kind: "resolved", action, attachments: latestGroup };
  }
  return {
    kind: "clarification",
    message: clarificationForLatestGroup(latestGroup),
  };
}

export function buildResolvedDocumentReply(
  action: DocumentRequestAction,
  attachments: MessageAttachment[],
): string {
  const count = attachments.length;
  const names = attachments.map((file) => `« ${file.name} »`).join(", ");
  switch (action) {
    case "protect":
      return count === 1
        ? `J’ai retrouvé ${names}. Je vais préparer sa protection à partir des informations que vous me donnerez. Quel client doit payer ?`
        : `J’ai retrouvé les ${count} documents concernés. Je vais préparer leur protection à partir des informations que vous me donnerez. Quel client doit payer ?`;
    case "create_client":
      return `J’ai retrouvé ${count === 1 ? names : `les ${count} documents concernés`}. Indiquez-moi le nom et l’email du client à créer ; je préparerai la suite sans déduire d’information du document.`;
    case "capabilities": {
      const visualType = classifyAttachmentVisualType(attachments[0]!);
      const capability =
        visualType === "audio"
          ? "La transcription automatique sera bientôt disponible."
          : visualType === "image"
            ? "L’analyse visuelle sera bientôt disponible."
            : "La lecture automatique sera bientôt disponible.";
      return `${capability} Vous pouvez déjà m’indiquer le résultat souhaité et je préparerai la suite à partir de vos indications.`;
    }
    case "remove":
      return count === 1
        ? `${names} a été retiré de cette conversation.`
        : `Les ${count} fichiers concernés ont été retirés de cette conversation.`;
    case "keep":
      return count === 1
        ? `Je conserve uniquement ${names} dans cette conversation.`
        : `Je conserve uniquement les ${count} fichiers concernés dans cette conversation.`;
    case "reuse":
      return `J’ai retrouvé ${count === 1 ? names : `les ${count} documents concernés`}. Précisez l’action souhaitée et je préparerai directement la suite.`;
  }
}
