export type FeedbackTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

export type FeedbackAction = {
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
};

export const feedbackToneClasses: Record<
  FeedbackTone,
  { border: string; bg: string; title: string; body: string; badge: string }
> = {
  neutral: {
    border: "border-gris-200",
    bg: "bg-white",
    title: "text-nuit",
    body: "text-gris-500",
    badge: "bg-gris-100 text-gris-500",
  },
  info: {
    border: "border-gris-200",
    bg: "bg-[var(--sidian-brume,#EDF2FF)]",
    title: "text-nuit",
    body: "text-gris-500",
    badge: "bg-[var(--sidian-brume,#EDF2FF)] text-sidian-blue",
  },
  success: {
    border: "border-emerald-200",
    bg: "bg-emerald-50",
    title: "text-emerald-900",
    body: "text-emerald-800",
    badge: "bg-emerald-100 text-emerald-800",
  },
  warning: {
    border: "border-amber-200",
    bg: "bg-amber-50",
    title: "text-amber-900",
    body: "text-amber-800",
    badge: "bg-amber-100 text-amber-800",
  },
  danger: {
    border: "border-red-200",
    bg: "bg-red-50",
    title: "text-red-900",
    body: "text-red-700",
    badge: "bg-red-100 text-red-700",
  },
};
