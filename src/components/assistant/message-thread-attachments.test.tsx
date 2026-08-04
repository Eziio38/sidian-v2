import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MessageThread } from "./message-thread";
import type {
  AssistantMessage,
  MessageAttachment,
  MessageAttachmentCategory,
} from "./types";

function attachment(
  id: string,
  name: string,
  type: string,
  category: MessageAttachmentCategory,
  positionInGroup: number,
): MessageAttachment {
  return {
    id,
    name,
    size: 10,
    type,
    extension: name.split(".").pop()?.toLowerCase() ?? "",
    positionInGroup,
    messageId: "message-files",
    category,
    persistenceStatus: "temporary",
  };
}

describe("MessageThread document icons", () => {
  it("différencie PDF, texte, audio, image et type inconnu dans le fil", () => {
    const message: AssistantMessage = {
      id: "message-files",
      role: "user",
      content: "",
      status: "sent",
      attachments: [
        attachment("pdf", "document.pdf", "application/pdf", "pdf", 1),
        attachment("txt", "notes.txt", "text/plain", "text", 2),
        attachment("audio", "memo.mp3", "audio/mpeg", "audio", 3),
        attachment("image", "photo.png", "image/png", "image", 4),
        attachment(
          "unknown",
          "donnees.bin",
          "application/octet-stream",
          "unknown",
          5,
        ),
      ],
    };

    render(<MessageThread messages={[message]} />);

    expect(screen.getByTestId("attachment-icon-pdf")).toBeVisible();
    expect(screen.getByTestId("attachment-icon-text")).toBeVisible();
    expect(screen.getByTestId("attachment-icon-audio")).toBeVisible();
    expect(screen.getByTestId("attachment-icon-image")).toBeVisible();
    expect(screen.getByTestId("attachment-icon-unknown")).toBeVisible();
  });
});
