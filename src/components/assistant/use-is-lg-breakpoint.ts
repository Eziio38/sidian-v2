"use client";

import { useEffect, useState } from "react";

const LG_QUERY = "(min-width: 1024px)";

/**
 * Breakpoint `lg` — synchronisé via matchMedia après mount.
 * Évite le bug useSyncExternalStore coincé sur le snapshot serveur (drawer mobile).
 * SSR / premier paint : `false` (mobile-first).
 */
export function useIsLgBreakpoint(): boolean {
  const [isLg, setIsLg] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const media = window.matchMedia(LG_QUERY);
    const update = () => setIsLg(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return isLg;
}
