import type { HTMLAttributes } from "react";

import { cx } from "../utils";
import styles from "./badge.module.css";

export type BadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "outline";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: BadgeProps) {
  return <span className={cx(styles.badge, styles[tone], className)} {...props} />;
}
