import { EmptyState as DesignSystemEmptyState } from "@/design-system";

import { FeedbackActionControl } from "./status-banner";
import type { FeedbackAction } from "./types";

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: FeedbackAction;
  className?: string;
};

export function EmptyState({
  title,
  description,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <DesignSystemEmptyState
      data-testid="empty-state"
      title={title}
      description={description}
      className={className}
      action={
        action ? (
          <FeedbackActionControl action={action} variant="primary" />
        ) : undefined
      }
    />
  );
}
