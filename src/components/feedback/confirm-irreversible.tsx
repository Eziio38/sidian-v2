"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";

import { UX_COPY } from "@/lib/ux/microcopy";

import { FeedbackActionControl } from "./status-banner";

type ConfirmIrreversibleProps = {
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Confirmation native avant submit (simple, accessible). */
  useNativeConfirm?: boolean;
  onConfirm?: () => void;
  trigger?: ReactNode;
  formAction?: (formData: FormData) => void | Promise<void>;
  formChildren?: ReactNode;
  pending?: boolean;
  className?: string;
};

/**
 * Confirmation explicite pour une action difficilement réversible.
 */
export function ConfirmIrreversible({
  title = UX_COPY.irreversibleConfirm.title,
  description = UX_COPY.irreversibleConfirm.description,
  confirmLabel = UX_COPY.irreversibleConfirm.actionLabel ?? "Confirmer",
  cancelLabel = UX_COPY.irreversibleConfirm.secondaryLabel ?? "Annuler",
  useNativeConfirm = false,
  onConfirm,
  trigger,
  formAction,
  formChildren,
  pending = false,
  className = "",
}: ConfirmIrreversibleProps) {
  const id = useId();
  const [open, setOpen] = useState(false);

  if (formAction && useNativeConfirm) {
    return (
      <form
        action={formAction}
        className={className}
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          if (!window.confirm(`${title}\n\n${description}`)) {
            event.preventDefault();
          }
        }}
      >
        {formChildren}
        <button
          type="submit"
          disabled={pending}
          className="text-sm font-medium text-red-700 underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-600 disabled:opacity-60"
        >
          {pending ? "…" : confirmLabel}
        </button>
      </form>
    );
  }

  if (formAction) {
    return (
      <div className={className}>
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-sm font-medium text-red-700 underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-600"
          >
            {confirmLabel}
          </button>
        ) : (
          <div
            role="alertdialog"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-desc`}
            className="rounded-xl border border-red-200 bg-red-50 p-4"
          >
            <p id={`${id}-title`} className="text-sm font-semibold text-red-900">
              {title}
            </p>
            <p
              id={`${id}-desc`}
              className="mt-1 text-sm leading-relaxed text-red-700"
            >
              {description}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <form action={formAction}>
                {formChildren}
                <FeedbackActionControl
                  type="submit"
                  action={{
                    label: pending ? "…" : confirmLabel,
                    disabled: pending,
                  }}
                  variant="danger"
                />
              </form>
              <FeedbackActionControl
                action={{
                  label: cancelLabel,
                  onClick: () => setOpen(false),
                  disabled: pending,
                }}
                variant="secondary"
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <div className={className}>
        {trigger ? (
          <button type="button" onClick={() => setOpen(true)}>
            {trigger}
          </button>
        ) : (
          <FeedbackActionControl
            action={{
              label: confirmLabel,
              onClick: () => setOpen(true),
            }}
            variant="danger"
          />
        )}
      </div>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-desc`}
      className={`rounded-xl border border-red-200 bg-red-50 p-4 ${className}`}
    >
      <p id={`${id}-title`} className="text-sm font-semibold text-red-900">
        {title}
      </p>
      <p
        id={`${id}-desc`}
        className="mt-1 text-sm leading-relaxed text-red-700"
      >
        {description}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <FeedbackActionControl
          action={{
            label: confirmLabel,
            onClick: () => {
              setOpen(false);
              onConfirm?.();
            },
          }}
          variant="danger"
        />
        <FeedbackActionControl
          action={{
            label: cancelLabel,
            onClick: () => setOpen(false),
          }}
          variant="secondary"
        />
      </div>
    </div>
  );
}
