import type { ReactNode } from "react";

import styles from "./settings.module.css";

/** Empilement vertical régulier à l'intérieur d'un `WorkspacePanel`. */
export function SettingsBlock({ children }: { children: ReactNode }) {
  return <div className={styles.stack}>{children}</div>;
}

/** Phrase d'explication secondaire — jamais un état, jamais une action. */
export function SettingsNote({ children }: { children: ReactNode }) {
  return <p className={styles.note}>{children}</p>;
}
