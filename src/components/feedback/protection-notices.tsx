import { UX_COPY } from "@/lib/ux/microcopy";

import { StatusBanner } from "./status-banner";
import type { FeedbackAction } from "./types";

type IncompleteProtectionProps = {
  title?: string;
  description?: string;
  action?: FeedbackAction;
  className?: string;
  surface?: "light" | "dark";
};

export function IncompleteProtectionNotice({
  title = UX_COPY.incompleteProtection.title,
  description = UX_COPY.incompleteProtection.description,
  action,
  className = "",
  surface = "light",
}: IncompleteProtectionProps) {
  return (
    <StatusBanner
      tone="info"
      surface={surface}
      badge="Brouillon"
      title={title}
      description={description}
      action={action}
      className={className}
    />
  );
}

type AutoDebitCeilingNoticeProps = {
  title?: string;
  description?: string;
  className?: string;
};

export function AutoDebitCeilingNotice({
  title = UX_COPY.autoDebitCeilingNotValidated.title,
  description = UX_COPY.autoDebitCeilingNotValidated.description,
  className = "",
}: AutoDebitCeilingNoticeProps) {
  return (
    <StatusBanner
      tone="warning"
      badge="En pause"
      title={title}
      description={description}
      className={className}
    />
  );
}
