"use client";

import {
  CONSEQUENCE_COPY,
  FIELD_LABELS,
  PROTECTION_PANEL_TITLE,
} from "./microcopy";
import {
  selectNextStepLabel,
  selectProgressiveFields,
} from "./progressive-fields";
import type { ProtectionPanelData, ProtectionPanelMode } from "./types";

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

function statusToneClass(status: ProtectionPanelData["status"]): string {
  switch (status) {
    case "active":
      return "text-emerald-400/90";
    case "blocked":
      return "text-amber-400/90";
    case "error":
      return "text-red-400/90";
    case "analyzing":
      return "text-sidian-blue";
    default:
      return "text-assistant-muted/65";
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
  if (!open) {
    return null;
  }

  const fields = selectProgressiveFields(protection);
  const consequence =
    protection.consequenceLabel?.trim() || CONSEQUENCE_COPY[protection.status];

  const containerClass =
    mode === "inline"
      ? "flex h-full w-[min(100%,22.5rem)] shrink-0 flex-col border-l border-white/[0.06] bg-assistant-panel motion-safe:animate-[assistant-panel-in_180ms_ease-out] motion-reduce:animate-none"
      : mode === "overlay"
        ? "absolute inset-y-0 right-0 z-20 flex h-full w-[min(100%,22.5rem)] flex-col border-l border-white/[0.06] bg-assistant-panel shadow-2xl motion-safe:animate-[assistant-panel-in_180ms_ease-out] motion-reduce:animate-none"
        : "fixed inset-x-0 bottom-0 z-30 flex max-h-[min(80dvh,100%)] flex-col rounded-t-[20px] border-t border-white/[0.06] bg-assistant-panel pb-[env(safe-area-inset-bottom,0px)] shadow-2xl motion-safe:animate-[assistant-panel-in_180ms_ease-out] motion-reduce:animate-none";

  return (
    <aside
      data-testid="context-panel"
      data-protection-panel="true"
      data-mode={mode}
      data-status={protection.status}
      data-draft-id={protection.draftId ?? undefined}
      aria-label="Panneau protection"
      role={mode === "sheet" || mode === "overlay" ? "dialog" : undefined}
      aria-modal={mode === "sheet" || mode === "overlay" ? true : undefined}
      className={containerClass}
    >
      <div className="flex items-start justify-between gap-4 px-4 pt-4">
        <div className="min-w-0">
          <p className="text-[16px] font-semibold tracking-[-0.02em] text-assistant-text">
            {PROTECTION_PANEL_TITLE}
          </p>
          <p
            className={`mt-1 text-[12px] ${statusToneClass(protection.status)}`}
            data-testid="protection-panel-status"
          >
            {protection.statusLabel}
          </p>
        </div>
        <button
          type="button"
          data-testid="context-panel-close"
          onClick={onClose}
          aria-label="Fermer le panneau"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-assistant-muted transition-colors duration-200 hover:bg-white/[0.05] hover:text-assistant-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue motion-reduce:transition-none"
        >
          ×
        </button>
      </div>

      <div className="mt-4 flex-1 overflow-y-auto px-4 pb-4">
        {fields.map((field, index) => (
          <div
            key={`${field.id}-${field.label}-${index}`}
            data-testid={`protection-field-${field.id}`}
            data-pending={field.pending ? "true" : "false"}
            className="motion-safe:animate-[assistant-field-in_200ms_ease-out_both] motion-reduce:animate-none"
            style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
          >
            {index > 0 ? (
              <div className="my-4 h-px w-full bg-white/[0.06]" />
            ) : null}
            <p className="text-[12px] font-medium uppercase tracking-[0.04em] text-assistant-muted">
              {field.label}
            </p>
            <p
              className={`mt-1 text-[16px] font-medium tracking-[-0.01em] ${
                field.pending
                  ? "text-assistant-muted"
                  : "text-assistant-text"
              } ${field.emphasize === "amount" ? "tabular-nums" : ""}`}
            >
              {field.value}
            </p>
          </div>
        ))}

        <div
          data-testid="protection-field-consequences"
          className="mt-6 rounded-[12px] bg-white/[0.03] px-3 py-3"
        >
          <p className="text-[12px] font-medium uppercase tracking-[0.04em] text-assistant-muted">
            Ce que ça change
          </p>
          <p className="mt-1 text-[13px] leading-5 text-assistant-muted">
            {consequence}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 px-4 pb-4 pt-0">
        {actionError ? (
          <p
            data-testid="protection-panel-action-error"
            role="alert"
            className="text-[12px] leading-4 text-[#FCA5A5]"
          >
            {actionError}
          </p>
        ) : null}

        {protection.primaryActionLabel ? (
          <button
            type="button"
            data-testid="context-panel-primary"
            onClick={onPrimaryAction}
            disabled={busy}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-sidian-blue px-4 text-[12px] font-medium text-white transition-opacity duration-200 hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Un instant…" : protection.primaryActionLabel}
          </button>
        ) : null}

        {protection.secondaryActionLabel && onSecondaryAction ? (
          <button
            type="button"
            data-testid="context-panel-secondary"
            onClick={onSecondaryAction}
            disabled={busy}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full px-4 text-[12px] font-medium text-assistant-muted transition-colors duration-200 hover:bg-white/[0.05] hover:text-assistant-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue disabled:cursor-not-allowed disabled:opacity-50"
          >
            {protection.secondaryActionLabel}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
