"use client";

import { Button } from "@/design-system";
import { cx } from "@/design-system/utils";

import { resolveSuggestionIcon } from "./suggestion-icon";
import type { ComposerShortcut } from "./types";
import styles from "./composer-shortcuts.module.css";

type ComposerShortcutsProps = {
  shortcuts: ComposerShortcut[];
  onSelect: (shortcut: ComposerShortcut) => void;
  hidden?: boolean;
  welcomeMode?: boolean;
};

export function ComposerShortcuts({
  shortcuts,
  onSelect,
  hidden = false,
  welcomeMode = false,
}: ComposerShortcutsProps) {
  if (hidden || shortcuts.length === 0) {
    return null;
  }

  const visible = shortcuts.slice(0, 4);

  if (welcomeMode) {
    return (
      <div
        data-testid="composer-shortcuts"
        data-variant="welcome"
        className={styles.welcomeActions}
        role="group"
        aria-label="Actions suggérées"
      >
        {visible.map((shortcut) => {
          const icon = resolveSuggestionIcon(shortcut.action, shortcut.label);

          return (
            <Button
              key={shortcut.id}
              type="button"
              size="sm"
              variant="secondary"
              icon={icon}
              data-testid={`composer-shortcut-${shortcut.id}`}
              data-action={shortcut.action}
              onClick={() => onSelect(shortcut)}
              className={cx(
                styles.welcomePill,
                shortcut.emphasis === "primary" && styles.welcomePillPrimary,
              )}
            >
              {shortcut.label}
            </Button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      data-testid="composer-shortcuts"
      data-variant="conversation"
      className={styles.list}
      role="group"
      aria-label="Raccourcis"
    >
      {visible.map((shortcut) => {
        const icon = shortcut.icon
          ? undefined
          : resolveSuggestionIcon(shortcut.action, shortcut.label);

        return (
          <Button
            key={shortcut.id}
            type="button"
            size="sm"
            variant={shortcut.emphasis === "primary" ? "primary" : "secondary"}
            icon={icon}
            data-testid={`composer-shortcut-${shortcut.id}`}
            data-action={shortcut.action}
            onClick={() => onSelect(shortcut)}
            className={cx(
              styles.shortcut,
              shortcut.emphasis === "primary" && styles.primaryShortcut,
            )}
          >
            {shortcut.icon ? (
              <span className={styles.customIcon} aria-hidden>
                {shortcut.icon}
              </span>
            ) : null}
            {shortcut.label}
          </Button>
        );
      })}
    </div>
  );
}
