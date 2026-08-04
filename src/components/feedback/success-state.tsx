import { UX_COPY } from "@/lib/ux/microcopy";

import { StatusBanner } from "./status-banner";

type SuccessStateProps = {
  title?: string;
  description?: string;
  className?: string;
};

export function SuccessState({
  title = UX_COPY.successGeneric.title,
  description = UX_COPY.successGeneric.description,
  className = "",
}: SuccessStateProps) {
  return (
    <StatusBanner
      tone="success"
      badge="OK"
      title={title}
      description={description}
      className={className}
    />
  );
}
