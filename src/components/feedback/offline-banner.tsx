"use client";

import { useSyncExternalStore } from "react";

import { UX_COPY } from "@/lib/ux/microcopy";

import { StatusBanner } from "./status-banner";

function subscribeOnline(onStoreChange: () => void) {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

function getOnlineSnapshot() {
  return navigator.onLine;
}

function getServerOnlineSnapshot() {
  return true;
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    getOnlineSnapshot,
    getServerOnlineSnapshot,
  );
}

type OfflineBannerProps = {
  className?: string;
  onRetry?: () => void;
  surface?: "light" | "dark";
};

export function OfflineBanner({
  className = "",
  onRetry,
  surface = "light",
}: OfflineBannerProps) {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <StatusBanner
      tone="warning"
      surface={surface}
      title={UX_COPY.offline.title}
      description={UX_COPY.offline.description}
      badge="Hors ligne"
      className={className}
      action={
        onRetry
          ? {
              label: UX_COPY.offline.actionLabel ?? "Réessayer",
              onClick: onRetry,
            }
          : undefined
      }
    />
  );
}
