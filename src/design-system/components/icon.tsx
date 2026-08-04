import type { LucideIcon } from "lucide-react";

import { cx } from "../utils";
import styles from "./icon.module.css";

export type IconSize = "xs" | "sm" | "md" | "lg";

export type IconProps = {
  icon: LucideIcon;
  size?: IconSize;
  className?: string;
  /** Decorative by default. Set a label only for standalone semantic icons. */
  label?: string;
};

export function Icon({
  icon: Glyph,
  size = "md",
  className,
  label,
}: IconProps) {
  return (
    <Glyph
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={cx(styles.icon, styles[size], className)}
    />
  );
}
