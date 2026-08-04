"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import {
  Badge,
  Button,
  IconButton,
  type BadgeTone,
} from "@/design-system";
import { cx } from "@/design-system/utils";

import { CONSEQUENCE_COPY, PLACEHOLDERS, PROTECTION_PANEL_TITLE } from "./microcopy";
import { selectProgressiveFields } from "./progressive-fields";
import type { ProtectionPanelData, ProtectionPanelMode } from "./types";
import styles from "./protection-panel.module.css";

type ProtectionPanelProps = {
  open: boolean;
  protection: ProtectionPanelData;
  onClose: () => void;
  onPrimaryAction?: () => void;
  onSecondaryAction?: () => void;
  mode?: ProtectionPanelMode;
  /** Désactive le CTA pendant un appel API. */
  busy?: boolean;
  /** Erreur d’action soft, inline. */
  actionError?: string | null;
};

function isFilledPanelValue(value: string | undefined | null): boolean {
  const t = value?.trim();
  return Boolean(
    t &&
      t !== "—" &&
      t !== PLACEHOLDERS.client &&
      t !== PLACEHOLDERS.amount &&
      t !== PLACEHOLDERS.due_date,
  );
}

function statusTone(status: ProtectionPanelData["status"]): BadgeTone {
  switch (status) {
    case "active":
      return "success";
    case "blocked":
      return "warning";
    case "error":
      return "danger";
    case "analyzing":
      return "info";
    default:
      return "neutral";
  }
}

export function ProtectionPanel({
  open,
  protection,
  onClose,
  onPrimaryAction,
  onSecondaryAction,
  mode = "inline",
  busy = false,
  actionError = null,
}: ProtectionPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open || (mode !== "sheet" && mode !== "overlay")) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (!panel) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
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

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [mode, onClose, open]);

  if (!open) {
    return null;
  }

  const fields = selectProgressiveFields(protection).filter(
    (field) => field.id !== "status",
  );
  const consequence =
    protection.consequenceLabel?.trim() || CONSEQUENCE_COPY[protection.status];
  const missingCoreFields =
    !isFilledPanelValue(protection.clientName) ||
    !isFilledPanelValue(protection.amountLabel) ||
    !isFilledPanelValue(protection.dueDateLabel);
  const missingLabel =
    protection.pendingQuestion?.trim() ||
    protection.nextStepLabel?.trim() ||
    null;
  const showMissing =
    missingCoreFields &&
    Boolean(missingLabel) &&
    (protection.status === "draft" ||
      protection.status === "analyzing" ||
      protection.status === "error");

  return (
    <aside
      ref={panelRef}
      data-testid="context-panel"
      data-protection-panel="true"
      data-mode={mode}
      data-status={protection.status}
      data-draft-id={protection.draftId ?? undefined}
      aria-label="Panneau protection"
      aria-labelledby={titleId}
      role={mode === "sheet" || mode === "overlay" ? "dialog" : undefined}
      aria-modal={mode === "sheet" || mode === "overlay" ? true : undefined}
      className={cx(styles.panel, styles[mode])}
    >
      {mode === "sheet" ? (
        <div className={styles.sheetHandle} aria-hidden />
      ) : null}
      <div className={styles.header}>
        <div className={styles.heading}>
          <h2 id={titleId} className={styles.title}>
            {PROTECTION_PANEL_TITLE}
          </h2>
          <Badge
            tone={statusTone(protection.status)}
            className={styles.status}
            data-testid="protection-panel-status"
          >
            {protection.statusLabel}
          </Badge>
        </div>
        <IconButton
          ref={closeRef}
          type="button"
          size="sm"
          variant="ghost"
          icon={X}
          label="Fermer le panneau"
          data-testid="context-panel-close"
          onClick={onClose}
        />
      </div>

      <div className={styles.body}>
        <dl className={styles.fields}>
          {fields.map((field, index) => (
            <div
              key={`${field.id}-${field.label}-${index}`}
              data-testid={`protection-field-${field.id}`}
              data-pending={field.pending ? "true" : "false"}
              className={styles.field}
            >
              <dt className={styles.fieldLabel}>{field.label}</dt>
              <dd
                className={cx(
                  styles.fieldValue,
                  field.pending && styles.fieldPending,
                  field.emphasize === "amount" && styles.amount,
                )}
              >
                {field.value}
              </dd>
            </div>
          ))}
        </dl>

        {showMissing && missingLabel ? (
          <div
            data-testid="protection-field-missing"
            className={styles.missingNote}
          >
            <p className={styles.missingTitle}>Élément manquant</p>
            <p className={styles.supportCopy}>{missingLabel}</p>
          </div>
        ) : null}

        <div
          data-testid="protection-field-consequences"
          className={styles.reassure}
        >
          <p className={styles.reassureTitle}>Ce que Sidian fera</p>
          <p className={styles.reassureCopy}>{consequence}</p>
        </div>
      </div>

      <div className={styles.footer}>
        {actionError ? (
          <p
            data-testid="protection-panel-action-error"
            role="alert"
            className={styles.actionError}
          >
            {actionError}
          </p>
        ) : null}

        {protection.primaryActionLabel ? (
          <Button
            type="button"
            variant="primary"
            data-testid="context-panel-primary"
            onClick={onPrimaryAction}
            disabled={busy}
            loading={busy}
            loadingLabel="Un instant…"
            className={styles.fullWidth}
          >
            {protection.primaryActionLabel}
          </Button>
        ) : null}

        {protection.secondaryActionLabel && onSecondaryAction ? (
          <Button
            type="button"
            variant="ghost"
            data-testid="context-panel-secondary"
            onClick={onSecondaryAction}
            disabled={busy}
            className={styles.fullWidth}
          >
            {protection.secondaryActionLabel}
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
