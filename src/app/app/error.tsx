"use client";

import { BrandLockup } from "@/components/brand/brand-lockup";
import { ErrorState } from "@/components/feedback";
import { UX_COPY } from "@/lib/ux/microcopy";

import styles from "./error.module.css";

type AppErrorProps = {
  error: Error & { digest?: string };
  unstable_retry: () => void;
};

export default function AppError({
  error: _error,
  unstable_retry,
}: AppErrorProps) {
  return (
    <main className={styles.page}>
      <div className={styles.content}>
        <BrandLockup size="md" />
        {/*
          La page n'exposait qu'un h3 (le titre de la carte ErrorState) : aucun
          h1, donc une hiérarchie de titres qui démarre au niveau 3. Le titre est
          repris tel quel et masqué visuellement pour ne pas doubler la carte.
        */}
        <h1 className="sr-only">{UX_COPY.errorGeneric.title}</h1>
        <ErrorState
          title={UX_COPY.errorGeneric.title}
          description={UX_COPY.errorGeneric.description}
          onRetry={unstable_retry}
        />
      </div>
    </main>
  );
}
