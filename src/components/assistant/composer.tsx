"use client";

import {
  useId,
  useLayoutEffect,
  useRef,
  type FormEvent,
  type KeyboardEvent,
} from "react";

/** Limite de saisie côté UI — alignée sur un message conversationnel court. */
export const COMPOSER_MAX_LENGTH = 4000;

/** Hauteur max du textarea avant scroll interne (grille 4px). */
const COMPOSER_MAX_HEIGHT_PX = 160;

type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  /** Envoi en cours — bouton send en loading, saisie bloquée. */
  isLoading?: boolean;
  /** Erreur d’envoi affichée inline à la place du hint clavier. */
  error?: string | null;
  placeholder?: string;
  maxLength?: number;
};

export function Composer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  isLoading = false,
  error = null,
  placeholder = "Demande à Sidian… Ex. créer une protection pour Dupont",
  maxLength = COMPOSER_MAX_LENGTH,
}: ComposerProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isBlocked = disabled || isLoading;
  const trimmed = value.trim();
  const atLimit = value.length >= maxLength;
  const nearLimit = value.length >= Math.floor(maxLength * 0.9);
  const canSend = !isBlocked && trimmed.length > 0;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX);
    el.style.height = `${Math.max(next, 24)}px`;
    el.style.overflowY =
      el.scrollHeight > COMPOSER_MAX_HEIGHT_PX ? "auto" : "hidden";
  }, [value]);

  function handleSubmit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter") return;
    // Desktop : Entrée envoie ; Shift+Entrée = nouvelle ligne.
    // Cmd/Ctrl+Entrée envoie aussi (raccourci explicite).
    if (event.shiftKey) return;
    event.preventDefault();
    handleSubmit();
  }

  function handleChange(next: string) {
    if (next.length <= maxLength) {
      onChange(next);
      return;
    }
    onChange(next.slice(0, maxLength));
  }

  return (
    <form
      data-testid="composer"
      data-loading={isLoading ? "true" : "false"}
      onSubmit={handleSubmit}
      className="group flex min-h-[72px] flex-col rounded-[20px] border border-white/[0.06] bg-assistant-composer px-4 pb-2 pt-3 shadow-[0_8px_32px_rgba(0,0,0,0.28),0_1px_0_rgba(255,255,255,0.025)_inset] transition-[box-shadow,border-color] duration-[180ms] ease-out focus-within:border-[rgba(59,109,248,0.4)] focus-within:shadow-[0_8px_32px_rgba(0,0,0,0.32),0_0_0_1px_rgba(59,109,248,0.12)]"
    >
      <label htmlFor={id} className="sr-only">
        Message à Sidian
      </label>
      <textarea
        ref={textareaRef}
        id={id}
        data-testid="composer-input"
        rows={1}
        value={value}
        disabled={isBlocked}
        placeholder={placeholder}
        maxLength={maxLength}
        enterKeyHint="send"
        autoComplete="off"
        autoCorrect="on"
        spellCheck
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [hintId, error ? errorId : null].filter(Boolean).join(" ") ||
          undefined
        }
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={handleKeyDown}
        className="block min-h-6 w-full resize-none bg-transparent px-0 text-[14px] leading-6 text-assistant-text placeholder:text-[14px] placeholder:leading-6 placeholder:text-assistant-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      />
      <div className="mt-auto flex min-h-11 items-center justify-between gap-3 pt-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {error ? (
            <p
              id={errorId}
              data-testid="composer-error"
              role="alert"
              className="truncate text-[12px] leading-4 text-[#FCA5A5]"
            >
              {error}
            </p>
          ) : (
            <p
              id={hintId}
              className="hidden truncate text-[11px] leading-4 text-assistant-muted sm:block"
            >
              Entrée pour envoyer · Maj+Entrée pour une ligne
            </p>
          )}
          {nearLimit ? (
            <span
              data-testid="composer-char-count"
              className={`shrink-0 text-[11px] tabular-nums leading-4 ${
                atLimit ? "text-[#FCA5A5]" : "text-assistant-muted"
              }`}
            >
              {value.length}/{maxLength}
            </span>
          ) : null}
        </div>
        <button
          type="submit"
          data-testid="composer-send"
          disabled={!canSend}
          aria-label={isLoading ? "Envoi en cours" : "Envoyer"}
          aria-busy={isLoading || undefined}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sidian-blue text-white transition-[opacity,transform,background-color] duration-150 ease-out hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-assistant-muted motion-safe:active:scale-[0.96] motion-reduce:transition-none"
        >
          {isLoading ? <SpinnerIcon /> : <SendIcon />}
        </button>
      </div>
    </form>
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

function SpinnerIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="motion-safe:animate-spin"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
