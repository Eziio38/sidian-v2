"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { UX_COPY } from "@/lib/ux/microcopy";

import { FeedbackActionControl } from "./status-banner";
import styles from "./confirm-irreversible.module.css";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

type ConfirmIrreversibleProps = {
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Confirmation native avant submit (simple, accessible). */
  useNativeConfirm?: boolean;
  onConfirm?: () => void;
  trigger?: ReactNode;
  formAction?: (formData: FormData) => void | Promise<void>;
  formChildren?: ReactNode;
  pending?: boolean;
  className?: string;
};

/**
 * Confirmation explicite pour une action difficilement réversible.
 */
export function ConfirmIrreversible({
  title = UX_COPY.irreversibleConfirm.title,
  description = UX_COPY.irreversibleConfirm.description,
  confirmLabel = UX_COPY.irreversibleConfirm.actionLabel ?? "Confirmer",
  cancelLabel = UX_COPY.irreversibleConfirm.secondaryLabel ?? "Annuler",
  useNativeConfirm = false,
  onConfirm,
  trigger,
  formAction,
  formChildren,
  pending = false,
  className = "",
}: ConfirmIrreversibleProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closedRootRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  // Ouverture : le focus entre dans le dialogue. Sans cela l'alertdialog était
  // annoncé mais jamais atteignable au clavier.
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    // Le déclencheur est déjà démonté quand cet effet s'exécute : `activeElement`
    // vaut alors <body>, qui n'est pas une cible de restitution valable.
    previouslyFocusedRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
    const frame = window.requestAnimationFrame(() => {
      // `FeedbackActionControl` ne transmet pas de ref : le bouton de
      // confirmation est le premier élément focusable rendu dans le dialogue.
      dialogRef.current
        ?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  // Restitution du focus à la fermeture. Contrairement aux dialogues en surcouche,
  // le déclencheur est démonté pendant l'ouverture : l'élément mémorisé est alors
  // détaché du document, on retombe sur le premier contrôle du bloc refermé.
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    const previous = previouslyFocusedRef.current;
    previouslyFocusedRef.current = null;
    if (previous?.isConnected) {
      previous.focus();
      return;
    }
    closedRootRef.current
      ?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      ?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ??
          [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, pending]);

  if (formAction && useNativeConfirm) {
    return (
      <form
        action={formAction}
        className={className}
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          if (!window.confirm(`${title}\n\n${description}`)) {
            event.preventDefault();
          }
        }}
      >
        {formChildren}
        <button
          type="submit"
          disabled={pending}
          className={styles.textTrigger}
        >
          {pending ? "…" : confirmLabel}
        </button>
      </form>
    );
  }

  if (formAction) {
    return (
      <div ref={closedRootRef} className={className}>
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={styles.textTrigger}
          >
            {confirmLabel}
          </button>
        ) : (
          <div
            ref={dialogRef}
            role="alertdialog"
            data-testid="confirm-irreversible-dialog"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-desc`}
            className={styles.dialog}
          >
            <h2 id={`${id}-title`} className={styles.title}>
              {title}
            </h2>
            <p id={`${id}-desc`} className={styles.description}>
              {description}
            </p>
            <div className={styles.actions}>
              <form action={formAction}>
                {formChildren}
                <FeedbackActionControl
                  type="submit"
                  action={{
                    label: pending ? "…" : confirmLabel,
                    disabled: pending,
                  }}
                  variant="danger"
                />
              </form>
              <FeedbackActionControl
                action={{
                  label: cancelLabel,
                  onClick: () => setOpen(false),
                  disabled: pending,
                }}
                variant="secondary"
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <div ref={closedRootRef} className={className}>
        {trigger ? (
          <button type="button" onClick={() => setOpen(true)}>
            {trigger}
          </button>
        ) : (
          <FeedbackActionControl
            action={{
              label: confirmLabel,
              onClick: () => setOpen(true),
            }}
            variant="danger"
          />
        )}
      </div>
    );
  }

  return (
    <div
      ref={dialogRef}
      role="alertdialog"
      data-testid="confirm-irreversible-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-desc`}
      className={`${styles.dialog} ${className}`}
    >
      <h2 id={`${id}-title`} className={styles.title}>
        {title}
      </h2>
      <p id={`${id}-desc`} className={styles.description}>
        {description}
      </p>
      <div className={styles.actions}>
        <FeedbackActionControl
          action={{
            label: confirmLabel,
            onClick: () => {
              setOpen(false);
              onConfirm?.();
            },
          }}
          variant="danger"
        />
        <FeedbackActionControl
          action={{
            label: cancelLabel,
            onClick: () => setOpen(false),
          }}
          variant="secondary"
        />
      </div>
    </div>
  );
}
