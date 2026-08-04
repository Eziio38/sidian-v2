"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { X } from "lucide-react";

import { Button, Icon, IconButton, Input } from "@/design-system";

import {
  DEFAULT_PROJECT_PERSONALIZATION,
  PROJECT_COLORS,
  PROJECT_ICON_OPTIONS,
  type ProjectColorId,
  type ProjectCreationDraft,
  type ProjectIconId,
} from "./project-personalization";
import styles from "./project-creation-drawer.module.css";

type ProjectCreationDrawerProps = {
  open: boolean;
  mode?: "create" | "edit";
  initialValue?: ProjectCreationDraft;
  anchor?: {
    left: number;
    top: number;
  } | null;
  onClose: () => void;
  onConfirm: (project: ProjectCreationDraft) => void;
};

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getAttribute("aria-hidden") !== "true");
}

export function ProjectCreationDrawer({
  open,
  mode = "create",
  initialValue,
  anchor,
  onClose,
  onConfirm,
}: ProjectCreationDrawerProps) {
  const titleId = useId();
  const drawerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [name, setName] = useState(initialValue?.name ?? "");
  const [icon, setIcon] = useState<ProjectIconId>(
    initialValue?.icon ?? DEFAULT_PROJECT_PERSONALIZATION.icon,
  );
  const [color, setColor] = useState<ProjectColorId>(
    initialValue?.color ?? DEFAULT_PROJECT_PERSONALIZATION.color,
  );
  const [nameTouched, setNameTouched] = useState(false);
  const normalizedName = name.trim();
  const drawerPositionStyle = anchor
    ? ({
        "--project-drawer-left": `${Math.round(anchor.left + 4)}px`,
        "--project-drawer-top": `${Math.max(12, Math.round(anchor.top))}px`,
      } as CSSProperties)
    : undefined;

  const resetDraft = useCallback(() => {
    setName(initialValue?.name ?? "");
    setIcon(initialValue?.icon ?? DEFAULT_PROJECT_PERSONALIZATION.icon);
    setColor(initialValue?.color ?? DEFAULT_PROJECT_PERSONALIZATION.color);
    setNameTouched(false);
  }, [initialValue?.color, initialValue?.icon, initialValue?.name]);

  const closeDrawer = useCallback(() => {
    resetDraft();
    onClose();
  }, [onClose, resetDraft]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;

      const items = focusableElements(drawerRef.current);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [closeDrawer, open]);

  function submit() {
    setNameTouched(true);
    if (!normalizedName) {
      inputRef.current?.focus();
      return;
    }
    onConfirm({ name: normalizedName, icon, color });
    resetDraft();
  }

  return (
    <div
      data-testid="project-creation-drawer-overlay"
      data-open={open ? "true" : "false"}
      data-anchored={anchor ? "true" : "false"}
      aria-hidden={open ? undefined : true}
      className={styles.overlay}
      style={drawerPositionStyle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeDrawer();
      }}
    >
      <div
        ref={drawerRef}
        data-testid="project-creation-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.drawer}
      >
        <header className={styles.header}>
          <div className={styles.headerCopy}>
            <h2 id={titleId} className={styles.title}>
              {mode === "edit" ? "Modifier le projet" : "Nouveau projet"}
            </h2>
          </div>
          <IconButton
            icon={X}
            size="sm"
            label="Fermer"
            className={styles.close}
            onClick={closeDrawer}
          />
        </header>

        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className={styles.body}>
            <Input
              ref={inputRef}
              label="Nom du projet"
              placeholder="Ex. Client Dupont"
              value={name}
              maxLength={60}
              autoComplete="off"
              required
              error={
                nameTouched && !normalizedName
                  ? "Donne un nom à ce projet."
                  : undefined
              }
              errorTestId="project-name-error"
              onBlur={() => setNameTouched(true)}
              onChange={(event) => setName(event.target.value)}
            />

            <fieldset className={styles.choiceGroup}>
              <legend className={styles.legend}>Icône</legend>
              <div className={styles.iconGrid}>
                {PROJECT_ICON_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-label={option.label}
                    aria-pressed={icon === option.id}
                    className={styles.iconChoice}
                    onClick={() => setIcon(option.id)}
                  >
                    <Icon icon={option.icon} size="sm" />
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className={styles.choiceGroup}>
              <legend className={styles.legend}>Couleur</legend>
              <div className={styles.colorGrid}>
                {PROJECT_COLORS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-label={option.label}
                    aria-pressed={color === option.id}
                    className={styles.colorChoice}
                    style={
                      {
                        "--project-swatch": option.value,
                      } as CSSProperties
                    }
                    onClick={() => setColor(option.id)}
                  >
                    <span aria-hidden className={styles.colorSwatch} />
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <footer className={styles.footer}>
            {mode === "create" ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={closeDrawer}
              >
                Annuler
              </Button>
            ) : null}
            <Button
              type="submit"
              size="sm"
              disabled={!normalizedName}
              data-testid="project-creation-submit"
            >
              {mode === "edit"
                ? "Enregistrer les modifications"
                : "Créer le projet"}
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
}
