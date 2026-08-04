import { UX_COPY } from "@/lib/ux/microcopy";
import { ErrorCard } from "@/design-system";
import { cx } from "@/design-system/utils";

import { FeedbackActionControl } from "./status-banner";
import type { FeedbackAction } from "./types";
import styles from "./feedback.module.css";

type ErrorStateProps = {
  title?: string;
  description?: string;
  onRetry?: () => void;
  action?: FeedbackAction;
  /** Accepté pour compatibilité Next, mais jamais rendu dans l’interface. */
  digest?: string;
  className?: string;
  compact?: boolean;
};

export function ErrorState({
  title = UX_COPY.errorGeneric.title,
  description = UX_COPY.errorGeneric.description,
  onRetry,
  action,
  digest: _digest,
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
    <ErrorCard
      data-testid="error-state"
      role="alert"
      title={title}
      description={description}
      density={compact ? "compact" : "default"}
      className={cx(
        styles.stateCard,
        compact && styles.compactCard,
        className,
      )}
      footer={
        resolvedAction ? (
          <FeedbackActionControl
            action={resolvedAction}
            variant={compact ? "secondary" : "primary"}
          />
        ) : undefined
      }
    />
  );
}
