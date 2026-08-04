import { LoaderCircle } from "lucide-react";
import type { HTMLAttributes, ProgressHTMLAttributes } from "react";

import { cx } from "../utils";
import { Icon } from "./icon";
import styles from "./loading.module.css";

export type SpinnerProps = HTMLAttributes<HTMLSpanElement> & {
  label?: string;
};

export function Spinner({
  label = "Chargement…",
  className,
  ...props
}: SpinnerProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cx(styles.status, className)}
      {...props}
    >
      <Icon icon={LoaderCircle} size="sm" className={styles.spinnerIcon} />
      <span>{label}</span>
    </span>
  );
}

export type SkeletonProps = HTMLAttributes<HTMLSpanElement> & {
  short?: boolean;
};

export function Skeleton({ short = false, className, ...props }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={cx(
        styles.skeleton,
        styles.skeletonLine,
        short && styles.skeletonLineShort,
        className,
      )}
      {...props}
    />
  );
}

export type ProgressProps = ProgressHTMLAttributes<HTMLProgressElement> & {
  label: string;
};

export function Progress({ label, ...props }: ProgressProps) {
  return (
    <progress
      aria-label={label}
      className={styles.progress}
      {...props}
    />
  );
}

export function ComposerLoading() {
  return (
    <div
      className={styles.composerLoading}
      role="status"
      aria-label="Sidian prépare sa réponse"
    >
      <Spinner label="Sidian réfléchit…" />
    </div>
  );
}

export function CardLoading() {
  return (
    <div
      className={styles.cardLoading}
      role="status"
      aria-label="Chargement de la carte"
    >
      <Skeleton />
      <div className={styles.stack}>
        <Skeleton />
        <Skeleton short />
      </div>
    </div>
  );
}

export function PageLoading() {
  return (
    <div
      className={styles.pageLoading}
      role="status"
      aria-label="Chargement de la page"
    >
      <Skeleton short />
      <CardLoading />
      <CardLoading />
    </div>
  );
}
