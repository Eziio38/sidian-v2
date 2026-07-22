"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function RecheckAuthorizationButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
      className="mt-6 w-full rounded-xl border border-gris-200 bg-white px-4 py-3 text-sm font-medium text-nuit transition hover:bg-gris-50 disabled:opacity-60"
    >
      {pending ? "Vérification…" : "Vérifier à nouveau"}
    </button>
  );
}
