"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

import { Button, IconButton } from "@/design-system";

import styles from "./workspace-name-dialog.module.css";

type WorkspaceConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Bouton de confirmation destructif (suppression…). */
  destructive?: boolean;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function WorkspaceConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  destructive = false,
  busy = false,
  onClose,
  onConfirm,
}: WorkspaceConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => {
      confirmRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      previouslyFocused?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, open, onClose]);

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      data-testid="workspace-confirm-dialog"
      onMouseDown={(event) => {
        if (busy) return;
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <div className={styles.header}>
          <div className={styles.headerCopy}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className={styles.description}>
                {description}
              </p>
            ) : null}
          </div>
          <IconButton
            icon={X}
            size="sm"
            label="Fermer"
            className={styles.close}
            disabled={busy}
            onClick={onClose}
          />
        </div>

        <div className={styles.actions}>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={onClose}
          >
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            size="sm"
            variant={destructive ? "destructive" : "primary"}
            data-testid="workspace-confirm-dialog-submit"
            loading={busy}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
