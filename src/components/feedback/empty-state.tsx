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
    <div
      data-testid="empty-state"
      className={`rounded-xl border border-dashed border-gris-200 bg-white px-6 py-10 text-center ${className}`}
    >
      <h2 className="text-base font-semibold tracking-[-0.02em] text-nuit">
        {title}
      </h2>
      {description ? (
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gris-500">
          {description}
        </p>
      ) : null}
      {action ? (
        <div className="mt-5 flex justify-center">
          <FeedbackActionControl action={action} variant="primary" />
        </div>
      ) : null}
    </div>
  );
}
