"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, X } from "lucide-react";

import { Button, IconButton, Input } from "@/design-system";

import { SuggestionDatePicker } from "./suggestion-date-picker";
import { resolveSuggestionIcon } from "./suggestion-icon";
import styles from "./message-suggestions.module.css";

export const SUGGESTION_OTHER_AMOUNT = "Autre montant";
export const SUGGESTION_PICK_DATE = "Choisir une date";
export const SUGGESTION_CREATE_CLIENT = "Créer un client";
export const SUGGESTION_CLIENT_NAME = "Saisir le nom du client";
export const SUGGESTION_ENTER_EMAIL = "Saisir l’email";
export const SUGGESTION_ENTER_PHONE = "Saisir le téléphone";
export const SUGGESTION_STAY_IN_GENERAL = "Rester dans Général";

export function suggestionCreateClientSpace(clientName: string): string {
  return `Créer l’espace « ${clientName.trim()} »`;
}

export function parseCreateClientSpaceSuggestion(
  suggestion: string,
): string | null {
  const match = suggestion
    .trim()
    .match(/^Créer l’espace « (.+) »$/u);
  const name = match?.[1]?.trim();
  return name || null;
}

type MessageSuggestionsProps = {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  onClientNameSubmit?: (name: string) => void;
};

type EditorMode = "amount" | "date" | "client-name" | "email" | "phone" | null;

export function formatSuggestionAmount(raw: string): string | null {
  const normalized = raw
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".")
    .replace(/[€eE]/g, "");
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  const formatted = new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2,
  }).format(value);
  return `${formatted} €`;
}

export function formatSuggestionDate(isoDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const date = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function isValidSuggestionEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

export function isValidSuggestionPhone(raw: string): boolean {
  const digits = raw.replace(/[^\d+]/g, "");
  return digits.replace(/\D/g, "").length >= 8;
}

function isNameTrigger(suggestion: string): boolean {
  return (
    suggestion === SUGGESTION_CREATE_CLIENT ||
    suggestion === SUGGESTION_CLIENT_NAME
  );
}

export function MessageSuggestions({
  suggestions,
  onSelect,
  onClientNameSubmit,
}: MessageSuggestionsProps) {
  const visibleKey = JSON.stringify(suggestions.slice(0, 3));
  return (
    <MessageSuggestionsContent
      key={visibleKey}
      suggestions={suggestions}
      onSelect={onSelect}
      onClientNameSubmit={onClientNameSubmit}
    />
  );
}

function initialEditorMode(suggestions: string[]): EditorMode {
  const visible = suggestions.slice(0, 3);
  if (visible.length !== 1) return null;
  if (visible[0] === SUGGESTION_ENTER_EMAIL) return "email";
  if (visible[0] === SUGGESTION_ENTER_PHONE) return "phone";
  return null;
}

function MessageSuggestionsContent({
  suggestions,
  onSelect,
  onClientNameSubmit,
}: MessageSuggestionsProps) {
  const [editor, setEditor] = useState<EditorMode>(() =>
    initialEditorMode(suggestions),
  );
  const [amountValue, setAmountValue] = useState("");
  const [dateValue, setDateValue] = useState("");
  const [textValue, setTextValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const openedFromRef = useRef<string | null>(null);
  const suggestionRefs = useRef(new Map<string, HTMLButtonElement>());
  const dateDrawerRef = useRef<HTMLDivElement>(null);
  const amountId = useId();
  const textId = useId();

  const visible = suggestions.slice(0, 3);

  const resetEditor = useCallback(
    (options?: { restoreFocus?: boolean }) => {
      const trigger = openedFromRef.current;
      openedFromRef.current = null;
      setEditor(null);
      setAmountValue("");
      setDateValue("");
      setTextValue("");
      setError(null);
      // L’éditeur remplace la liste : sans cela, annuler laisse le focus nulle
      // part et la navigation clavier repart du haut du document.
      if (options?.restoreFocus && trigger) {
        window.requestAnimationFrame(() => {
          suggestionRefs.current.get(trigger)?.focus();
        });
      }
    },
    [],
  );

  useEffect(() => {
    if (editor !== "date") return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") resetEditor({ restoreFocus: true });
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Le calendrier est un dialogue en portail : sans focus explicite,
    // le clavier reste sur le document derrière lui.
    dateDrawerRef.current
      ?.querySelector<HTMLElement>('button:not([disabled])')
      ?.focus();
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [editor, resetEditor]);

  useEffect(() => {
    if (editor === "amount") {
      amountRef.current?.focus();
      return;
    }
    if (
      editor === "client-name" ||
      editor === "email" ||
      editor === "phone"
    ) {
      textRef.current?.focus();
    }
  }, [editor]);

  function handleSuggestionClick(suggestion: string) {
    openedFromRef.current = suggestion;
    if (suggestion === SUGGESTION_OTHER_AMOUNT) {
      setEditor("amount");
      setError(null);
      return;
    }
    if (suggestion === SUGGESTION_PICK_DATE) {
      setEditor("date");
      setError(null);
      return;
    }
    if (isNameTrigger(suggestion)) {
      setEditor("client-name");
      setError(null);
      return;
    }
    if (suggestion === SUGGESTION_ENTER_EMAIL) {
      setEditor("email");
      setError(null);
      return;
    }
    if (suggestion === SUGGESTION_ENTER_PHONE) {
      setEditor("phone");
      setError(null);
      return;
    }
    onSelect(suggestion);
  }

  function submitAmount() {
    const formatted = formatSuggestionAmount(amountValue);
    if (!formatted) {
      setError("Indique un montant valide.");
      return;
    }
    resetEditor();
    onSelect(formatted);
  }

  function submitDate(isoDate: string) {
    const formatted = formatSuggestionDate(isoDate);
    if (!formatted) {
      setError("Choisis une date.");
      return;
    }
    resetEditor();
    onSelect(formatted);
  }

  function submitClientName() {
    const name = textValue.trim();
    if (name.length < 2) {
      setError("Indique le nom du client.");
      return;
    }
    resetEditor();
    if (onClientNameSubmit) {
      onClientNameSubmit(name);
      return;
    }
    onSelect(name);
  }

  function submitEmail() {
    const email = textValue.trim();
    if (!isValidSuggestionEmail(email)) {
      setError("Indique un email valide.");
      return;
    }
    resetEditor();
    onSelect(email);
  }

  function submitPhone() {
    const phone = textValue.trim();
    if (!isValidSuggestionPhone(phone)) {
      setError("Indique un numéro valide.");
      return;
    }
    resetEditor();
    onSelect(phone);
  }

  if (editor === "amount") {
    return (
      <form
        data-testid="message-suggestions"
        data-editor="amount"
        className={styles.editor}
        onSubmit={(event) => {
          event.preventDefault();
          submitAmount();
        }}
      >
        <Input
          ref={amountRef}
          id={amountId}
          label="Montant"
          hideLabel
          inputMode="decimal"
          placeholder="Ex. 1 500"
          value={amountValue}
          error={error ?? undefined}
          errorTestId="suggestion-amount-error"
          data-testid="suggestion-amount-input"
          className={styles.editorField}
          onChange={(event) => {
            setAmountValue(event.currentTarget.value);
            if (error) setError(null);
          }}
        />
        <IconButton
          type="submit"
          icon={ArrowUp}
          size="md"
          label="Valider le montant"
          title="Valider le montant"
          data-testid="suggestion-amount-submit"
          variant="primary"
          className={styles.editorSubmit}
        />
        <IconButton
          type="button"
          icon={X}
          size="md"
          label="Annuler"
          title="Annuler"
          onClick={() => resetEditor({ restoreFocus: true })}
          className={styles.editorCancel}
        />
      </form>
    );
  }

  if (editor === "date") {
    const drawer = (
      <div
        data-testid="message-suggestions"
        data-editor="date"
        className={styles.dateDrawerRoot}
      >
        <button
          type="button"
          className={styles.dateDrawerBackdrop}
          aria-label="Fermer le calendrier"
          onClick={() => resetEditor({ restoreFocus: true })}
        />
        <div
          ref={dateDrawerRef}
          className={styles.dateDrawer}
          role="dialog"
          aria-modal="true"
          aria-label="Choisir une date d’échéance"
        >
          <div className={styles.dateDrawerHeader}>
            <p className={styles.dateDrawerTitle}>Date d’échéance</p>
            <IconButton
              type="button"
              icon={X}
              size="md"
              label="Fermer"
              title="Fermer"
              onClick={() => resetEditor({ restoreFocus: true })}
            />
          </div>
          <SuggestionDatePicker
            value={dateValue}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(iso) => {
              setDateValue(iso);
              submitDate(iso);
            }}
          />
          {error ? (
            <p
              data-testid="suggestion-date-error"
              className={styles.editorError}
            >
              {error}
            </p>
          ) : null}
        </div>
      </div>
    );

    if (typeof document === "undefined") {
      return drawer;
    }
    return createPortal(drawer, document.body);
  }

  if (editor === "client-name" || editor === "email" || editor === "phone") {
    const config =
      editor === "client-name"
        ? {
            label: "Nom du client",
            placeholder: "Ex. Martin SARL",
            testId: "suggestion-client-name-input",
            submitTestId: "suggestion-client-name-submit",
            submitLabel: "Valider le nom",
            onSubmit: submitClientName,
          }
        : editor === "email"
          ? {
              label: "Email",
              placeholder: "Ex. contact@client.fr",
              testId: "suggestion-email-input",
              submitTestId: "suggestion-email-submit",
              submitLabel: "Valider l’email",
              onSubmit: submitEmail,
            }
          : {
              label: "Téléphone",
              placeholder: "Ex. 06 12 34 56 78",
              testId: "suggestion-phone-input",
              submitTestId: "suggestion-phone-submit",
              submitLabel: "Valider le téléphone",
              onSubmit: submitPhone,
            };

    return (
      <form
        data-testid="message-suggestions"
        data-editor={editor}
        className={styles.editor}
        onSubmit={(event) => {
          event.preventDefault();
          config.onSubmit();
        }}
      >
        <Input
          ref={textRef}
          id={textId}
          label={config.label}
          hideLabel
          type={editor === "email" ? "email" : "text"}
          inputMode={editor === "phone" ? "tel" : "text"}
          autoComplete={
            editor === "email"
              ? "email"
              : editor === "phone"
                ? "tel"
                : "organization"
          }
          placeholder={config.placeholder}
          value={textValue}
          error={error ?? undefined}
          errorTestId={`suggestion-${editor}-error`}
          data-testid={config.testId}
          className={styles.editorField}
          onChange={(event) => {
            setTextValue(event.currentTarget.value);
            if (error) setError(null);
          }}
        />
        <IconButton
          type="submit"
          icon={ArrowUp}
          size="md"
          label={config.submitLabel}
          title={config.submitLabel}
          data-testid={config.submitTestId}
          variant="primary"
          className={styles.editorSubmit}
        />
        <IconButton
          type="button"
          icon={X}
          size="md"
          label="Annuler"
          title="Annuler"
          onClick={() => resetEditor({ restoreFocus: true })}
          className={styles.editorCancel}
        />
      </form>
    );
  }

  return (
    <div
      data-testid="message-suggestions"
      className={styles.list}
      role="group"
      aria-label="Suggestions"
    >
      {visible.map((suggestion) => (
        <Button
          key={suggestion}
          ref={(node: HTMLButtonElement | null) => {
            if (node) suggestionRefs.current.set(suggestion, node);
            else suggestionRefs.current.delete(suggestion);
          }}
          type="button"
          variant="secondary"
          size="sm"
          icon={resolveSuggestionIcon(undefined, suggestion)}
          data-testid={`message-suggestion-${suggestion}`}
          onClick={() => handleSuggestionClick(suggestion)}
        >
          {suggestion}
        </Button>
      ))}
    </div>
  );
}
