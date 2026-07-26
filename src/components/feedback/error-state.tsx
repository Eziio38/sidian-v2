import { UX_COPY } from "@/lib/ux/microcopy";

import { FeedbackActionControl } from "./status-banner";
import type { FeedbackAction } from "./types";

type ErrorStateProps = {
  title?: string;
  description?: string;
  onRetry?: () => void;
  action?: FeedbackAction;
  digest?: string;
  className?: string;
  compact?: boolean;
};

export function ErrorState({
  title = UX_COPY.errorGeneric.title,
  description = UX_COPY.errorGeneric.description,
  onRetry,
  action,
  digest,
  className = "",
  compact = false,
}: ErrorStateProps) {
  const resolvedAction: FeedbackAction | undefined =
    action ??
    (onRetry
      ? {
          label: UX_COPY.errorGeneric.actionLabel ?? "Réessayer",
          onClick: onRetry,
        }
      : undefined);

  return (
    <div
      data-testid="error-state"
      role="alert"
      className={
        compact
          ? `rounded-xl border border-red-200 bg-red-50 p-4 ${className}`
          : `rounded-xl border border-gris-200 bg-white p-6 sm:p-8 ${className}`
      }
    >
      <h2
        className={
          compact
            ? "text-sm font-semibold text-red-900"
            : "text-2xl font-semibold tracking-[-0.03em] text-nuit"
        }
      >
        {title}
      </h2>
      <p
        className={
          compact
            ? "mt-1 text-sm leading-relaxed text-red-700"
            : "mt-3 max-w-lg text-sm leading-relaxed text-gris-500"
        }
      >
        {description}
      </p>
      {digest ? (
        <p className="mt-3 text-xs text-gris-500">Référence : {digest}</p>
      ) : null}
      {resolvedAction ? (
        <div className="mt-5">
          <FeedbackActionControl
            action={resolvedAction}
            variant={compact ? "secondary" : "primary"}
          />
        </div>
      ) : null}
    </div>
  );
}
