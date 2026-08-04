"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

import { IconButton } from "@/design-system";
import { cx } from "@/design-system/utils";

import styles from "./workspace-toast.module.css";

type WorkspaceToastProps = {
  message: string | null;
  tone?: "warning" | "info";
  onDismiss: () => void;
  durationMs?: number;
};

export function WorkspaceToast({
  message,
  tone = "warning",
  onDismiss,
  durationMs = 5200,
}: WorkspaceToastProps) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, message, onDismiss]);

  if (!message) return null;

  return (
    <div
      className={styles.host}
      role="status"
      aria-live="polite"
      data-testid="workspace-toast"
    >
      <div className={cx(styles.toast, styles[tone])}>
        <p className={styles.message}>{message}</p>
        <IconButton
          icon={X}
          size="sm"
          label="Fermer la notification"
          title="Fermer"
          onClick={onDismiss}
          className={styles.dismiss}
        />
      </div>
    </div>
  );
}
