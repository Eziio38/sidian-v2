"use client";

import { SuggestionIcon } from "./suggestion-icons";
import type { AssistantMessage } from "./types";

type MessageThreadProps = {
  messages: AssistantMessage[];
  onSuggestionSelect?: (suggestion: string) => void;
};

export function MessageThread({
  messages,
  onSuggestionSelect,
}: MessageThreadProps) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="message-thread"
      className="flex flex-col gap-6"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      {messages.map((message, index) => {
        const isLastAssistant =
          message.role === "assistant" &&
          index === messages.findLastIndex((item) => item.role === "assistant");
        const isUser = message.role === "user";

        return (
          <article
            key={message.id}
            data-testid={`message-${message.role}-${message.id}`}
            data-role={message.role}
            className={`motion-safe:animate-[assistant-message-in_180ms_ease-out] motion-reduce:animate-none ${
              isUser ? "ml-auto w-fit max-w-[min(100%,26rem)]" : "w-full"
            }`}
          >
            <div className="mb-2 flex items-center gap-4">
              <span
                aria-hidden
                className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-medium ${
                  isUser
                    ? "bg-assistant-bubble text-assistant-text"
                    : "bg-white/[0.08] text-assistant-text"
                }`}
              >
                {isUser ? "U" : "●"}
              </span>
              <span className="text-[12px] font-semibold text-assistant-muted/75">
                {isUser ? "Vous" : "Sidian"}
              </span>
            </div>

            {isUser ? (
              <div className="rounded-2xl bg-assistant-bubble px-4 py-2 text-[14px] font-normal leading-6 text-assistant-text">
                <MessageBody content={message.content} />
              </div>
            ) : (
              <div className="text-[14px] font-normal leading-6 text-assistant-text">
                <MessageBody content={message.content} />
              </div>
            )}

            {isLastAssistant &&
            message.suggestions &&
            message.suggestions.length > 0 ? (
              <div
                data-testid="message-suggestions"
                className="mt-4 flex flex-wrap gap-2"
              >
                {message.suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => onSuggestionSelect?.(suggestion)}
                    className="inline-flex items-center gap-2 rounded-full bg-white/[0.045] px-4 py-1 text-[12px] text-assistant-muted/80 transition-[background-color,color,transform] duration-150 ease-out hover:bg-white/[0.08] hover:text-assistant-text motion-safe:hover:-translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
                  >
                    <SuggestionIcon label={suggestion} />
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function MessageBody({ content }: { content: string }) {
  const blocks = parseMessageBlocks(content);

  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        if (block.type === "list") {
          return (
            <ul key={`list-${index}`} className="space-y-1 pl-0">
              {block.items.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-assistant-muted/80" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={`p-${index}`} className="whitespace-pre-wrap">
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
    const bullet = line.match(/^\s*[•\-\*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      listItems.push(bullet[1]);
      continue;
    }
    flushList();
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }

  flushList();
  flushParagraph();
  return blocks;
}
