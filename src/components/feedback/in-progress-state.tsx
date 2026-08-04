import { UX_COPY } from "@/lib/ux/microcopy";

import { LoadingState } from "./loading-state";
import { StatusBanner } from "./status-banner";

type InProgressStateProps = {
  title?: string;
  description?: string;
  className?: string;
  compact?: boolean;
};

export function InProgressState({
  title = UX_COPY.inProgress.title,
  description = UX_COPY.inProgress.description,
  className = "",
  compact = false,
}: InProgressStateProps) {
  if (compact) {
    return (
      <LoadingState
        label={`${title} ${description}`}
        className={className}
      />
    );
  }

  return (
    <StatusBanner
      tone="info"
      badge="En cours"
      title={title}
      description={description}
      className={className}
    />
  );
}
