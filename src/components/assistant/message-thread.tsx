"use client";

import { useState } from "react";

import { Button, ButtonLink, Icon } from "@/design-system";
import { cx } from "@/design-system/utils";

import { formatFileSize } from "./composer";
import {
  AttachmentPreviewDialog,
  type AttachmentPreviewData,
} from "./attachment-preview-dialog";
import {
  getAttachmentIcon,
  getAttachmentIconType,
} from "./document-attachments";
import { MessageCard } from "./message-card";
import { MessageHoverActions } from "./message-hover-actions";
import { MessageSuggestions } from "./message-suggestions";
import type {
  AssistantMessage,
  AssistantMessageAction,
  MessageAttachment,
  MessageFeedback,
} from "./types";
import styles from "./message-thread.module.css";

type MessageThreadProps = {
  messages: AssistantMessage[];
  busy?: boolean;
  editingMessageId?: string | null;
  onSuggestionSelect?: (suggestion: string) => void;
  onClientNameSubmit?: (name: string) => void;
  onAction?: (action: AssistantMessageAction, message: AssistantMessage) => void;
  onOpenCard?: (message: AssistantMessage) => void;
  onMessageFeedback?: (
    messageId: string,
    feedback: MessageFeedback | null,
    comment: string,
  ) => void;
  onEditMessage?: (message: AssistantMessage) => void;
};

export function MessageThread({
  messages,
  busy = false,
  editingMessageId = null,
  onSuggestionSelect,
  onClientNameSubmit,
  onAction,
  onOpenCard,
  onMessageFeedback,
  onEditMessage,
}: MessageThreadProps) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="message-thread"
      className={styles.thread}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      {messages.map((message, index) => {
        const isLastAssistant =
          message.role === "assistant" &&
          index === messages.findLastIndex((item) => item.role === "assistant");
        const isUser = message.role === "user";
        const isError = message.status === "error";
        const isStreaming = message.status === "streaming";
        const isEditing = isUser && editingMessageId === message.id;
        const cardOpensPanel =
          message.card &&
          (message.card.kind === "protection_draft" ||
            message.card.kind === "protection" ||
            message.card.kind === "payment" ||
            message.card.kind === "action_needed");
        const attachments = message.attachments ?? [];
        const showUserHoverActions =
          isUser &&
          message.status !== "streaming" &&
          Boolean(message.content.trim() || attachments.length > 0);
        const showAssistantHoverActions =
          !isUser &&
          !isStreaming &&
          message.status !== "pending" &&
          Boolean(message.content.trim());

        return (
          <article
            key={message.id}
            data-testid={`message-${message.role}-${message.id}`}
            data-role={message.role}
            data-status={message.status ?? "sent"}
            aria-busy={isStreaming ? "true" : undefined}
            data-editing={isEditing ? "true" : undefined}
            className={cx(
              styles.message,
              isUser && styles.userMessage,
              isEditing && styles.userMessageEditing,
            )}
          >
            {isUser ? (
              <div className={styles.userStack}>
                {attachments.length > 0 ? (
                  <MessageAttachments attachments={attachments} />
                ) : null}
                {message.content.trim() ? (
                  <div className={styles.userBubble}>
                    <MessageBody content={message.content} />
                  </div>
                ) : null}
                {showUserHoverActions ? (
                  <div className={styles.hoverActionsSlot}>
                    <MessageHoverActions
                      messageId={message.id}
                      content={
                        message.content.trim() ||
                        attachments.map((attachment) => attachment.name).join("\n")
                      }
                      feedback={message.feedback}
                      feedbackComment={message.feedbackComment}
                      canEdit={
                        Boolean(message.content.trim()) &&
                        Boolean(onEditMessage)
                      }
                      onFeedback={(feedback, comment) =>
                        onMessageFeedback?.(message.id, feedback, comment)
                      }
                      onEdit={() => onEditMessage?.(message)}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className={styles.assistantBlock}>
                <div
                  className={cx(
                    styles.assistantBody,
                    isStreaming && styles.streaming,
                    isError && styles.error,
                  )}
                >
                  <MessageBody content={message.content} />
                  {isStreaming && message.activityIndicator ? (
                    <span className={styles.activityDots} aria-hidden>
                      <span />
                      <span />
                      <span />
                    </span>
                  ) : null}
                  {isError && message.errorMessage ? (
                    <p className={styles.errorDetail}>
                      {message.errorMessage}
                    </p>
                  ) : null}
                </div>
                {showAssistantHoverActions ? (
                  <div className={styles.hoverActionsSlot}>
                    <MessageHoverActions
                      messageId={message.id}
                      content={message.content}
                      feedback={message.feedback}
                      feedbackComment={message.feedbackComment}
                      canEdit={false}
                      canRetry={
                        message.retryable === true && Boolean(onAction)
                      }
                      busy={busy}
                      align="start"
                      onFeedback={(feedback, comment) =>
                        onMessageFeedback?.(message.id, feedback, comment)
                      }
                      onRetry={() =>
                        onAction?.(
                          {
                            id: "retry",
                            label: "Réessayer",
                            kind: "retry",
                          },
                          message,
                        )
                      }
                    />
                  </div>
                ) : null}
              </div>
            )}

            {message.card ? (
              <MessageCard
                card={message.card}
                onOpen={
                  cardOpensPanel &&
                  onOpenCard &&
                  !(message.actions && message.actions.length > 0)
                    ? () => onOpenCard(message)
                    : undefined
                }
              />
            ) : null}

            {isLastAssistant &&
            message.suggestions &&
            message.suggestions.length > 0 &&
            !isError &&
            onSuggestionSelect ? (
              <MessageSuggestions
                suggestions={message.suggestions}
                onSelect={onSuggestionSelect}
                onClientNameSubmit={onClientNameSubmit}
              />
            ) : null}

            {isLastAssistant &&
            message.actions &&
            message.actions.length > 0 ? (
              <div
                data-testid="message-actions"
                className={styles.actions}
              >
                {message.actions.map((action) =>
                  action.href && !onAction ? (
                    <ButtonLink
                      key={action.id}
                      href={action.href}
                      size="sm"
                      data-testid={`message-action-${action.id}`}
                    >
                      {action.label}
                    </ButtonLink>
                  ) : (
                    <Button
                      key={action.id}
                      type="button"
                      size="sm"
                      variant={
                        action.kind === "confirm_protection"
                          ? "primary"
                          : "secondary"
                      }
                      data-testid={`message-action-${action.id}`}
                      disabled={busy}
                      onClick={() => onAction?.(action, message)}
                    >
                      {action.label}
                    </Button>
                  ),
                )}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function MessageAttachments({
  attachments,
}: {
  attachments: MessageAttachment[];
}) {
  const [previewAttachment, setPreviewAttachment] =
    useState<AttachmentPreviewData | null>(null);

  return (
    <>
      <ul
        className={styles.attachments}
        aria-label="Pièces jointes du message"
        data-testid="message-attachments"
      >
        {attachments.map((file) => {
          const attachmentIcon = getAttachmentIcon(file);
          const attachmentIconType = getAttachmentIconType(file);
          return (
            <li
              key={file.id}
              className={styles.attachment}
              data-type={attachmentIconType}
            >
              <button
                type="button"
                className={styles.attachmentPreviewTrigger}
                aria-label={`Afficher l’aperçu de ${file.name}`}
                onClick={() =>
                  setPreviewAttachment({
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    url: file.previewUrl,
                    source: file.previewSource,
                  })
                }
              >
                <span
                  className={styles.attachmentIcon}
                  aria-hidden
                  data-testid={`attachment-icon-${attachmentIconType}`}
                >
                  <Icon icon={attachmentIcon} size="sm" />
                </span>
                <span className={styles.attachmentCopy}>
                  <span className={styles.attachmentName} title={file.name}>
                    {file.name}
                  </span>
                  <span className={styles.attachmentSize}>
                    {formatFileSize(file.size)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <AttachmentPreviewDialog
        attachment={previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />
    </>
  );
}

function MessageBody({ content }: { content: string }) {
  const blocks = parseMessageBlocks(content);

  return (
    <div className={styles.body}>
      {blocks.map((block, index) => {
        if (block.type === "list") {
          return (
            <ul key={`list-${index}`} className={styles.list}>
              {block.items.map((item) => (
                <li key={item} className={styles.listItem}>
                  <span className={styles.bullet} aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={`p-${index}`} className={styles.paragraph}>
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

type MessageBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

function parseMessageBlocks(content: string): MessageBlock[] {
  const lines = content.split("\n");
  const blocks: MessageBlock[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];

  function flushParagraph() {
    if (paragraph.length === 0) return;
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  }

  function flushList() {
    if (listItems.length === 0) return;
    blocks.push({ type: "list", items: listItems });
    listItems = [];
  }

  for (const line of lines) {
    const bullet = line.match(/^\s*[•\-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      listItems.push(bullet[1]);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}
