import { UX_COPY } from "@/lib/ux/microcopy";

type DisabledHintProps = {
  title?: string;
  description?: string;
  className?: string;
};

export function DisabledHint({
  title = UX_COPY.disabledGeneric.title,
  description = UX_COPY.disabledGeneric.description,
  className = "",
}: DisabledHintProps) {
  return (
    <p
      data-testid="disabled-hint"
      className={`text-sm leading-relaxed text-gris-500 ${className}`}
    >
      <span className="font-medium text-nuit">{title}</span>
      {" — "}
      {description}
    </p>
  );
}
