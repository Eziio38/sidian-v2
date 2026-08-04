import {
  Badge,
  Button,
  ButtonLink,
  Card,
  type BadgeTone,
  type ButtonVariant,
  type CardVariant,
} from "@/design-system";

import type { FeedbackAction, FeedbackTone } from "./types";
import styles from "./feedback.module.css";

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

const toneVariants: Record<
  FeedbackTone,
  { card: CardVariant; badge: BadgeTone }
> = {
  neutral: { card: "summary", badge: "neutral" },
  info: { card: "info", badge: "info" },
  success: { card: "success", badge: "success" },
  warning: { card: "info", badge: "warning" },
  danger: { card: "error", badge: "danger" },
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
  void surface;
  const tones = toneVariants[tone];
  const resolvedRole = role ?? (tone === "danger" ? "alert" : "status");

  return (
    <Card
      role={resolvedRole}
      variant={tones.card}
      title={title}
      density="compact"
      className={className}
      accessory={
        badge ? (
          <Badge tone={tones.badge} className={styles.bannerBadge}>
            {badge}
          </Badge>
        ) : undefined
      }
      footer={
        action ? <FeedbackActionControl action={action} /> : undefined
      }
    >
      {description ? (
        <p className={styles.bannerBody}>{description}</p>
      ) : null}
    </Card>
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
  const variants: Record<typeof variant, ButtonVariant> = {
    primary: "primary",
    secondary: "secondary",
    danger: "destructive",
  };

  if (action.href && !action.disabled) {
    return (
      <ButtonLink
        href={action.href}
        variant={variants[variant]}
        aria-disabled={action.disabled}
      >
        {action.label}
      </ButtonLink>
    );
  }

  return (
    <Button
      type={type}
      variant={variants[variant]}
      disabled={action.disabled}
      onClick={action.onClick}
    >
      {action.label}
    </Button>
  );
}
