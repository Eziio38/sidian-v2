import {
  createElement,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import type { TypographyRole } from "../tokens";
import { cx } from "../utils";
import styles from "./typography.module.css";

export type TypographyTone = "primary" | "secondary" | "muted" | "inverse";

export type TypographyProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  variant?: TypographyRole;
  tone?: TypographyTone;
  children: ReactNode;
};

const defaultElements: Record<TypographyRole, ElementType> = {
  display: "p",
  h1: "h1",
  h2: "h2",
  h3: "h3",
  title: "p",
  body: "p",
  bodySmall: "p",
  caption: "p",
  label: "span",
  code: "code",
};

export function Typography({
  as,
  variant = "body",
  tone = "primary",
  className,
  children,
  ...props
}: TypographyProps) {
  return createElement(
    as ?? defaultElements[variant],
    {
      className: cx(
        styles.base,
        styles[variant],
        tone !== "primary" && styles[tone],
        className,
      ),
      ...props,
    },
    children,
  );
}
