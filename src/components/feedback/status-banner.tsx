import Link from "next/link";

import {
  feedbackToneClasses,
  type FeedbackAction,
  type FeedbackTone,
} from "./types";

type StatusBannerProps = {
  title: string;
  description?: string;
  tone?: FeedbackTone;
  badge?: string;
  action?: FeedbackAction;
  className?: string;
  role?: "status" | "alert";
  /** Surface sombre (assistant) — texte clair, fonds translucides. */
  surface?: "light" | "dark";
};

const darkToneClasses: Record<
  FeedbackTone,
  { border: string; bg: string; title: string; body: string; badge: string }
> = {
  neutral: {
    border: "border-white/10",
    bg: "bg-white/[0.04]",
    title: "text-assistant-text",
    body: "text-assistant-muted",
    badge: "bg-white/10 text-assistant-muted",
  },
  info: {
    border: "border-white/10",
    bg: "bg-sidian-blue/15",
    title: "text-assistant-text",
    body: "text-assistant-muted",
    badge: "bg-sidian-blue/20 text-[#9BB4FF]",
  },
  success: {
    border: "border-emerald-400/20",
    bg: "bg-emerald-500/10",
    title: "text-emerald-100",
    body: "text-emerald-200/80",
    badge: "bg-emerald-500/20 text-emerald-200",
  },
  warning: {
    border: "border-amber-400/20",
    bg: "bg-amber-500/10",
    title: "text-amber-50",
    body: "text-amber-100/80",
    badge: "bg-amber-500/20 text-amber-100",
  },
  danger: {
    border: "border-red-400/20",
    bg: "bg-red-500/10",
    title: "text-red-100",
    body: "text-red-200/80",
    badge: "bg-red-500/20 text-red-100",
  },
};

export function StatusBanner({
  title,
  description,
  tone = "info",
  badge,
  action,
  className = "",
  role,
  surface = "light",
}: StatusBannerProps) {
  const tones =
    surface === "dark" ? darkToneClasses[tone] : feedbackToneClasses[tone];
  const resolvedRole = role ?? (tone === "danger" ? "alert" : "status");

  return (
    <div
      role={resolvedRole}
      className={`rounded-xl border px-4 py-4 sm:px-5 ${tones.border} ${tones.bg} ${className}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {badge ? (
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tones.badge}`}
            >
              {badge}
            </span>
          ) : null}
          <p
            className={`text-sm font-semibold ${tones.title} ${badge ? "mt-2" : ""}`}
          >
            {title}
          </p>
          {description ? (
            <p className={`mt-1 max-w-2xl text-sm leading-relaxed ${tones.body}`}>
              {description}
            </p>
          ) : null}
        </div>
        {action ? <FeedbackActionControl action={action} /> : null}
      </div>
    </div>
  );
}

export function FeedbackActionControl({
  action,
  variant = "secondary",
  type = "button",
}: {
  action: FeedbackAction;
  variant?: "primary" | "secondary" | "danger";
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
  const variants = {
    primary:
      "bg-sidian-blue text-white hover:bg-[#315fd9] focus-visible:outline-sidian-blue",
    secondary:
      "border border-gris-200 bg-white text-nuit hover:border-sidian-blue hover:text-sidian-blue focus-visible:outline-sidian-blue",
    danger:
      "bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600",
  };

  if (action.href && !action.disabled) {
    return (
      <Link href={action.href} className={`${base} ${variants[variant]}`}>
        {action.label}
      </Link>
    );
  }

  return (
    <button
      type={type}
      disabled={action.disabled}
      onClick={action.onClick}
      className={`${base} ${variants[variant]}`}
    >
      {action.label}
    </button>
  );
}
