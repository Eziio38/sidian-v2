"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Redemande une vérification côté serveur (nouveau rendu du Server Component,
 * donc un nouvel appel à resolveCheckoutReturnStatus) — jamais une simple
 * relecture des query params déjà en main du navigateur.
 */
export function RecheckButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [clicked, setClicked] = useState(false);

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        setClicked(true);
        startTransition(() => {
          router.refresh();
        });
      }}
      className="w-full rounded-xl border border-gris-200 bg-white px-4 py-3 text-sm font-medium text-nuit transition hover:bg-gris-50 disabled:opacity-60"
    >
      {isPending ? "Vérification…" : clicked ? "Revérifier" : "Vérifier à nouveau"}
    </button>
  );
}
