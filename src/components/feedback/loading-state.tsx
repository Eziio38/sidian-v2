import { UX_COPY } from "@/lib/ux/microcopy";
import {
  PageLoading,
  Skeleton as DesignSystemSkeleton,
  Spinner,
} from "@/design-system";
import { cx } from "@/design-system/utils";

import styles from "./feedback.module.css";

type LoadingStateProps = {
  label?: string;
  className?: string;
};

export function LoadingState({
  label = UX_COPY.loading.description,
  className = "",
}: LoadingStateProps) {
  return (
    <div
      data-testid="loading-state"
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cx(styles.loading, className)}
    >
      <Spinner label={label} />
    </div>
  );
}

type SkeletonProps = {
  className?: string;
  /** Nombre de barres (défaut 3). */
  lines?: number;
  label?: string;
};

export function Skeleton({
  className = "",
  lines = 3,
  label = UX_COPY.skeleton.description,
}: SkeletonProps) {
  return (
    <div
      data-testid="skeleton"
      aria-busy="true"
      aria-label={label}
      className={cx(styles.skeletonStack, className)}
    >
      {Array.from({ length: lines }, (_, index) => (
        <DesignSystemSkeleton
          key={index}
          short={index === lines - 1}
        />
      ))}
      <p className="sr-only">{label}</p>
    </div>
  );
}

type PageSkeletonProps = {
  label?: string;
};

/** Skeleton pleine page — aligné sur le loading app existant. */
export function PageSkeleton({
  label = "Chargement de ton espace Sidian",
}: PageSkeletonProps) {
  return (
    <main
      data-testid="page-skeleton"
      className={styles.pageSkeleton}
      aria-busy="true"
      aria-label={label}
    >
      <PageLoading />
      <p className="sr-only">{UX_COPY.loading.description}</p>
    </main>
  );
}

type GeneratingIndicatorProps = {
  label?: string;
  className?: string;
};

export function GeneratingIndicator({
  label = UX_COPY.generating.title,
  className = "",
}: GeneratingIndicatorProps) {
  return (
    <div
      data-testid="generating-indicator"
      role="status"
      aria-live="polite"
      className={cx(styles.generating, className)}
    >
      <span className={styles.dots} aria-hidden>
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.dot} />
      </span>
      <span>{label}</span>
    </div>
  );
}
