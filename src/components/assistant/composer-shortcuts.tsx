"use client";

import { SuggestionIcon } from "./suggestion-icons";
import type { ComposerShortcut } from "./types";

type ComposerShortcutsProps = {
  shortcuts: ComposerShortcut[];
  onSelect: (shortcut: ComposerShortcut) => void;
  hidden?: boolean;
};

export function ComposerShortcuts({
  shortcuts,
  onSelect,
  hidden = false,
}: ComposerShortcutsProps) {
  if (hidden || shortcuts.length === 0) {
    return null;
  }

  const visible = shortcuts.slice(0, 3);

  return (
    <div
      data-testid="composer-shortcuts"
      className="mt-0 flex flex-nowrap gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="group"
      aria-label="Raccourcis"
    >
      {visible.map((shortcut) => (
        <button
          key={shortcut.id}
          type="button"
          data-testid={`composer-shortcut-${shortcut.id}`}
          data-action={shortcut.action}
          onClick={() => onSelect(shortcut)}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border-0 bg-white/[0.045] px-4 py-2 text-[12px] text-assistant-muted shadow-none outline-none transition-[background-color,color,transform] duration-[180ms] ease-out hover:bg-white/[0.08] hover:text-assistant-text motion-safe:hover:-translate-y-px motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
        >
          {shortcut.icon ?? (
            <SuggestionIcon action={shortcut.action} label={shortcut.label} />
          )}
          {shortcut.label}
        </button>
      ))}
    </div>
  );
}
