import { createElement, type HTMLAttributes, type ReactNode } from "react";

import { cx } from "../utils";
import styles from "./empty-state.module.css";

export type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  title: string;
  titleAs?: "h2" | "h3";
  description?: string;
  illustration?: ReactNode;
  action?: ReactNode;
};

export function EmptyState({
  title,
  titleAs = "h2",
  description,
  illustration,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div className={cx(styles.emptyState, className)} {...props}>
      {illustration ? (
        <div className={styles.illustration} aria-hidden>
          {illustration}
        </div>
      ) : null}
      {createElement(titleAs, { className: styles.title }, title)}
      {description ? (
        <p className={styles.description}>{description}</p>
      ) : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
