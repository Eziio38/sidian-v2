"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";

import { CONVERSATION_TITLE_MAX_LENGTH } from "./conversation-title";
import styles from "./conversation-title-bar.module.css";

type ConversationTitleBarProps = {
  title: string;
  onRename: (title: string) => void;
};

export function ConversationTitleBar({
  title,
  onRename,
}: ConversationTitleBarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  function commit() {
    // Entrée puis perte de focus déclenchent tous deux la validation :
    // sans ce verrou, un même titre partirait deux fois au serveur.
    if (committedRef.current) return;
    committedRef.current = true;
    const next = draft.trim();
    setEditing(false);
    if (!next || next === title) {
      setDraft(title);
      return;
    }
    onRename(next);
  }

  if (editing) {
    return (
      <div className={styles.root} data-testid="conversation-title-bar">
        <input
          ref={inputRef}
          data-testid="conversation-title-input"
          className={styles.input}
          value={draft}
          aria-label="Titre de la discussion"
          maxLength={CONVERSATION_TITLE_MAX_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              committedRef.current = true;
              setDraft(title);
              setEditing(false);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className={styles.root} data-testid="conversation-title-bar">
      <button
        type="button"
        className={styles.titleButton}
        data-testid="conversation-title-button"
        aria-label={`Modifier le titre : ${title}`}
        onClick={() => {
          committedRef.current = false;
          setDraft(title);
          setEditing(true);
        }}
      >
        <span className={styles.title}>{title}</span>
        <span className={styles.editIcon} aria-hidden>
          <Pencil size={13} strokeWidth={1.8} />
        </span>
      </button>
    </div>
  );
}
