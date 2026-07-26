import { UX_COPY } from "@/lib/ux/microcopy";

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
      className={`flex items-center gap-3 text-sm text-gris-500 ${className}`}
    >
      <span
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gris-200 border-t-sidian-blue motion-reduce:animate-none"
        aria-hidden
      />
      <span>{label}</span>
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
      className={`animate-pulse motion-reduce:animate-none space-y-3 ${className}`}
    >
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          className={`h-4 rounded bg-gris-100 ${
            index === lines - 1 ? "w-2/3" : "w-full"
          }`}
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
      className="min-h-dvh bg-gris-50 px-4 py-8 sm:px-6 lg:px-8 lg:py-10"
      aria-busy="true"
      aria-label={label}
    >
      <div className="mx-auto max-w-6xl animate-pulse motion-reduce:animate-none">
        <div className="h-8 w-52 rounded-lg bg-gris-200" />
        <div className="mt-3 h-4 w-full max-w-xl rounded bg-gris-100" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-28 rounded-xl bg-white" />
          ))}
        </div>
        <div className="mt-6 h-72 rounded-xl bg-white" />
      </div>
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
      className={`flex items-center gap-2 text-[12px] text-assistant-muted/65 ${className}`}
    >
      <span className="flex gap-1" aria-hidden>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-assistant-muted/50 motion-reduce:animate-none" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-assistant-muted/50 motion-reduce:animate-none [animation-delay:120ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-assistant-muted/50 motion-reduce:animate-none [animation-delay:240ms]" />
      </span>
      <span>{label}</span>
    </div>
  );
}
