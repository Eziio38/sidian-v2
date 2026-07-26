"use client";

import { useId, useState, type FormEvent, type KeyboardEvent } from "react";

type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
};

export function Composer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = "Écris simplement ce que tu veux faire…",
}: ComposerProps) {
  const id = useId();
  const [focused, setFocused] = useState(false);

  function handleSubmit(event?: FormEvent) {
    event?.preventDefault();
    if (disabled || !value.trim()) return;
    onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  }

  return (
    <form
      data-testid="composer"
      onSubmit={handleSubmit}
      className={`flex min-h-[72px] flex-col rounded-[20px] bg-assistant-composer px-4 pb-2 pt-2 transition-[box-shadow,border-color] duration-[170ms] ease-out ${
        focused
          ? "border border-[rgba(120,105,255,0.35)] shadow-[0_8px_32px_rgba(0,0,0,0.32),0_0_0_1px_rgba(120,105,255,0.08)]"
          : "border border-white/[0.06] shadow-[0_8px_32px_rgba(0,0,0,0.28),0_1px_0_rgba(255,255,255,0.025)_inset]"
      }`}
    >
      <label htmlFor={id} className="sr-only">
        Message à Sidian
      </label>
      <textarea
        id={id}
        data-testid="composer-input"
        rows={1}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="block min-h-6 w-full resize-none bg-transparent px-0 text-[14px] leading-5 text-assistant-text placeholder:text-[14px] placeholder:text-assistant-muted/55 focus:outline-none disabled:opacity-50"
      />
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center">
          <button
            type="button"
            aria-label="Joindre un fichier"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-assistant-muted/80 transition-colors duration-150 ease-out hover:bg-white/[0.05] hover:text-assistant-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
          >
            <PaperclipIcon />
          </button>
          <button
            type="button"
            aria-label="Dictée vocale"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-assistant-muted/80 transition-colors duration-150 ease-out hover:bg-white/[0.05] hover:text-assistant-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
          >
            <MicIcon />
          </button>
        </div>
        <button
          type="submit"
          data-testid="composer-send"
          disabled={disabled || !value.trim()}
          aria-label="Envoyer"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-sidian-blue text-white transition-opacity duration-150 ease-out hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-assistant-muted"
        >
          <SendIcon />
        </button>
      </div>
    </form>
  );
}

function PaperclipIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 12.5v-1a7 7 0 0 0-14 0v6a4 4 0 0 0 8 0V11a2 2 0 1 0-4 0v6.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M5 11a7 7 0 0 0 14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
