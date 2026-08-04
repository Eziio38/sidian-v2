import { createElement, type HTMLAttributes, type ReactNode } from "react";

import { cx } from "../utils";
import styles from "./card.module.css";

export type CardVariant =
  | "info"
  | "protection"
  | "payment"
  | "client"
  | "error"
  | "success"
  | "timeline"
  | "summary";

export type CardProps = HTMLAttributes<HTMLElement> & {
  variant?: CardVariant;
  title?: string;
  titleAs?: "h2" | "h3" | "h4";
  description?: string;
  accessory?: ReactNode;
  footer?: ReactNode;
  elevation?: "flat" | "raised";
  density?: "default" | "compact";
};

export function Card({
  variant = "info",
  title,
  /*
   * `h2` par défaut, aligné sur EmptyState : les cartes d'erreur et de statut
   * (ErrorCard / StatusBanner / ErrorState) sont rendues directement sous le
   * `h1` de la page, et un `h3` y créait un saut de niveau h1 → h3.
   */
  titleAs = "h2",
  description,
  accessory,
  footer,
  elevation = "flat",
  density = "default",
  className,
  children,
  ...props
}: CardProps) {
  return (
    <article
      data-card-variant={variant}
      className={cx(
        styles.card,
        styles[variant],
        elevation === "raised" && styles.raised,
        density === "compact" && styles.compact,
        className,
      )}
      {...props}
    >
      {title || description || accessory ? (
        <header className={styles.header}>
          <div>
            {title
              ? createElement(titleAs, { className: styles.title }, title)
              : null}
            {description ? (
              <p className={styles.description}>{description}</p>
            ) : null}
          </div>
          {accessory}
        </header>
      ) : null}
      {children ? <div className={styles.body}>{children}</div> : null}
      {footer ? <footer className={styles.footer}>{footer}</footer> : null}
    </article>
  );
}

type NamedCardProps = Omit<CardProps, "variant">;

export function InfoCard(props: NamedCardProps) {
  return <Card variant="info" {...props} />;
}

export function ProtectionCard(props: NamedCardProps) {
  return <Card variant="protection" {...props} />;
}

export function PaymentCard(props: NamedCardProps) {
  return <Card variant="payment" {...props} />;
}

export function ClientCard(props: NamedCardProps) {
  return <Card variant="client" {...props} />;
}

export function ErrorCard(props: NamedCardProps) {
  return <Card variant="error" {...props} />;
}

export function SuccessCard(props: NamedCardProps) {
  return <Card variant="success" {...props} />;
}

export function SummaryCard(props: NamedCardProps) {
  return <Card variant="summary" {...props} />;
}

export type TimelineItem = {
  id: string;
  label: string;
  detail?: string;
};

export type TimelineCardProps = NamedCardProps & {
  items: readonly TimelineItem[];
};

export function TimelineCard({ items, ...props }: TimelineCardProps) {
  return (
    <Card variant="timeline" {...props}>
      <ol className={styles.timelineList}>
        {items.map((item) => (
          <li key={item.id} className={styles.timelineItem}>
            <span className={styles.timelineDot} aria-hidden />
            <span>
              {item.label}
              {item.detail ? ` — ${item.detail}` : null}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
