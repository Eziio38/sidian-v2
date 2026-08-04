import { UX_COPY } from "@/lib/ux/microcopy";

import { StatusBanner } from "./status-banner";
import type { FeedbackAction } from "./types";

type PermissionDeniedProps = {
  title?: string;
  description?: string;
  action?: FeedbackAction;
  className?: string;
  surface?: "light" | "dark";
};

export function PermissionDenied({
  title = UX_COPY.permissionDenied.title,
  description = UX_COPY.permissionDenied.description,
  action,
  className = "",
  surface = "light",
}: PermissionDeniedProps) {
  return (
    <StatusBanner
      tone="warning"
      surface={surface}
      badge="Accès limité"
      title={title}
      description={description}
      action={action}
      className={className}
      role="status"
    />
  );
}
