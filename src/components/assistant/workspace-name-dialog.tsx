"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";

import { Button, IconButton } from "@/design-system";

import styles from "./workspace-name-dialog.module.css";

type WorkspaceNameDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  initialValue?: string;
  onClose: () => void;
  onConfirm: (value: string) => void;
};

export function WorkspaceNameDialog({
  open,
  initialValue = "",
  ...props
}: WorkspaceNameDialogProps) {
  if (!open) return null;

  return (
    <WorkspaceNameDialogContent
      key={initialValue}
      initialValue={initialValue}
      {...props}
    />
  );
}

function WorkspaceNameDialogContent({
  title,
  description,
  label = "Nom",
  placeholder,
  confirmLabel = "Créer",
  cancelLabel = "Annuler",
  initialValue,
  onClose,
  onConfirm,
}: Omit<WorkspaceNameDialogProps, "open"> & { initialValue: string }) {
  const titleId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function submit() {
    const next = value.trim();
    if (!next) {
      inputRef.current?.focus();
      return;
    }
    onConfirm(next);
  }

  return (
    <div
      className={styles.backdrop}
      data-testid="workspace-name-dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={styles.header}>
          <div className={styles.headerCopy}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {description ? (
              <p className={styles.description}>{description}</p>
            ) : null}
          </div>
          <IconButton
            icon={X}
            size="sm"
            label="Fermer"
            className={styles.close}
            onClick={onClose}
          />
        </div>

        <label className={styles.field} htmlFor={inputId}>
          <span className={styles.label}>{label}</span>
          <input
            ref={inputRef}
            id={inputId}
            data-testid="workspace-name-dialog-input"
            className={styles.input}
            value={value}
            placeholder={placeholder}
            maxLength={60}
            autoComplete="off"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
          />
        </label>

        <div className={styles.actions}>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onClose}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="primary"
            data-testid="workspace-name-dialog-submit"
            disabled={!value.trim()}
            onClick={submit}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
