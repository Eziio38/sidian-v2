"use client";

import { ErrorState } from "@/components/feedback";
import { UX_COPY } from "@/lib/ux/microcopy";

type AppErrorProps = {
  error: Error & { digest?: string };
  unstable_retry: () => void;
};

export default function AppError({ error, unstable_retry }: AppErrorProps) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gris-50 px-4 py-12">
      <div className="w-full max-w-xl">
        <p className="mb-3 text-sm font-semibold text-sidian-blue">Sidian</p>
        <ErrorState
          title={UX_COPY.errorGeneric.title}
          description={UX_COPY.errorGeneric.description}
          onRetry={unstable_retry}
          digest={error.digest}
        />
      </div>
    </main>
  );
}
