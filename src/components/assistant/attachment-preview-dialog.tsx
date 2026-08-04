"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { FileText, X } from "lucide-react";

import { Icon, IconButton } from "@/design-system";

import styles from "./attachment-preview-dialog.module.css";
import { PdfDocumentPreview } from "./pdf-document-preview";

export type AttachmentPreviewData = {
  name: string;
  size: number;
  type: string;
  url?: string;
  source?: Blob;
};

type AttachmentPreviewDialogProps = {
  attachment: AttachmentPreviewData | null;
  onClose: () => void;
};

function formatPreviewFileSize(size: number): string {
  if (size < 1024) return `${size} o`;
  return `${Math.max(1, Math.round(size / 1024))} Ko`;
}

function previewKind(
  attachment: AttachmentPreviewData,
): "image" | "pdf" | "text" | "unsupported" {
  if (!attachment.url && !attachment.source) return "unsupported";
  if (attachment.type.startsWith("image/")) return "image";
  if (
    attachment.type === "application/pdf" ||
    attachment.name.toLocaleLowerCase("fr").endsWith(".pdf")
  ) {
    return "pdf";
  }
  if (attachment.type.startsWith("text/")) return "text";
  return "unsupported";
}

export function AttachmentPreviewDialog({
  attachment,
  onClose,
}: AttachmentPreviewDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!attachment) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], iframe, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [attachment, onClose]);

  if (!attachment || typeof document === "undefined") return null;

  const kind = previewKind(attachment);

  const portalTarget =
    document.querySelector<HTMLElement>('[data-testid="assistant-shell"]') ??
    document.body;

  return createPortal(
    <div
      className={styles.backdrop}
      data-testid="attachment-preview-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.dialog}
        data-testid="attachment-preview-dialog"
      >
        <header className={styles.header}>
          <div className={styles.heading}>
            <h2 id={titleId} className={styles.title} title={attachment.name}>
              {attachment.name}
            </h2>
            <p className={styles.meta}>
              {formatPreviewFileSize(attachment.size)}
            </p>
          </div>
          <IconButton
            ref={closeRef}
            type="button"
            icon={X}
            size="sm"
            label="Fermer l’aperçu"
            title="Fermer"
            onClick={onClose}
            className={styles.close}
          />
        </header>

        <div className={styles.viewport} data-preview-kind={kind}>
          {kind === "image" && attachment.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL blob locale
            <img
              src={attachment.url}
              alt={attachment.name}
              className={styles.image}
            />
          ) : null}
          {kind === "pdf" && attachment.url ? (
            <PdfDocumentPreview
              url={attachment.url}
              name={attachment.name}
              source={attachment.source}
            />
          ) : null}
          {kind === "text" && attachment.url ? (
            <iframe
              src={attachment.url}
              title={`Aperçu de ${attachment.name}`}
              className={styles.frame}
            />
          ) : null}
          {kind === "unsupported" ? (
            <div className={styles.unsupported} role="status">
              <Icon icon={FileText} size="lg" />
              <strong>Aperçu indisponible</strong>
              <span>Ce format ne peut pas être affiché dans Sidian.</span>
            </div>
          ) : null}
        </div>

      </div>
    </div>,
    portalTarget,
  );
}
