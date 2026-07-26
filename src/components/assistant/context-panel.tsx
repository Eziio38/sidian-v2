"use client";

import type { ProtectionContextData } from "./types";

type ContextPanelProps = {
  open: boolean;
  protection: ProtectionContextData;
  onClose: () => void;
  onPrimaryAction?: () => void;
  mode?: "inline" | "overlay" | "sheet";
};

export function ContextPanel({
  open,
  protection,
  onClose,
  onPrimaryAction,
  mode = "inline",
}: ContextPanelProps) {
  if (!open) {
    return null;
  }

  const fields = [
    { label: "Client", value: protection.clientName, delay: "0ms" },
    { label: "Montant", value: protection.amountLabel, delay: "60ms" },
    ...(protection.dueDateLabel
      ? [
          {
            label: "Échéance",
            value: protection.dueDateLabel,
            delay: "120ms",
          },
        ]
      : []),
    ...(protection.nextStepLabel
      ? [
          {
            label: "Prochaine étape",
            value: protection.nextStepLabel,
            delay: "180ms",
          },
        ]
      : []),
  ];

  const containerClass =
    mode === "inline"
      ? "flex h-full w-[min(100%,20rem)] shrink-0 flex-col border-l border-white/[0.06] bg-assistant-panel motion-safe:animate-[assistant-panel-in_180ms_ease-out] motion-reduce:animate-none"
      : mode === "overlay"
        ? "absolute inset-y-0 right-0 z-20 flex h-full w-[min(100%,20rem)] flex-col border-l border-white/[0.06] bg-assistant-panel shadow-2xl motion-safe:animate-[assistant-panel-in_180ms_ease-out] motion-reduce:animate-none"
        : "fixed inset-x-0 bottom-0 z-30 flex max-h-[80dvh] flex-col rounded-t-[20px] border-t border-white/[0.06] bg-assistant-panel shadow-2xl";

  return (
    <aside
      data-testid="context-panel"
      data-mode={mode}
      aria-label="Contexte protection"
      className={containerClass}
    >
      <div className="flex items-start justify-between gap-4 px-4 pt-4">
        <div>
          <p className="text-[16px] font-semibold tracking-[-0.02em] text-assistant-text">
            Protection
          </p>
          <p className="mt-1 text-[12px] text-assistant-muted/65">
            {protection.statusLabel}
          </p>
        </div>
        <button
          type="button"
          data-testid="context-panel-close"
          onClick={onClose}
          aria-label="Fermer le panneau"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-assistant-muted transition-colors duration-200 hover:bg-white/[0.05] hover:text-assistant-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
        >
          ×
        </button>
      </div>

      <div className="mt-4 flex-1 overflow-y-auto px-4 pb-4">
        {fields.map((field, index) => (
          <div
            key={field.label}
            className="motion-safe:animate-[assistant-field-in_200ms_ease-out_both] motion-reduce:animate-none"
            style={{ animationDelay: field.delay }}
          >
            {index > 0 ? (
              <div className="my-4 h-px w-full bg-white/[0.06]" />
            ) : null}
            <p className="text-[12px] font-medium uppercase tracking-[0.04em] text-assistant-muted/55">
              {field.label}
            </p>
            <p
              className={`mt-1 text-[16px] font-medium tracking-[-0.01em] text-assistant-text ${
                field.label === "Montant" ? "tabular-nums" : ""
              }`}
            >
              {field.value}
            </p>
          </div>
        ))}
      </div>

      {protection.primaryActionLabel ? (
        <div className="px-4 pb-4 pt-0">
          <button
            type="button"
            data-testid="context-panel-primary"
            onClick={onPrimaryAction}
            className="inline-flex min-h-10 w-full items-center justify-center rounded-full bg-sidian-blue px-4 text-[12px] font-medium text-white transition-opacity duration-200 hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
          >
            {protection.primaryActionLabel}
          </button>
        </div>
      ) : null}
    </aside>
  );
}
