"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button, IconButton } from "@/design-system";
import { cx } from "@/design-system/utils";

import styles from "./suggestion-date-picker.module.css";

type SuggestionDatePickerProps = {
  value: string;
  min?: string;
  onChange: (isoDate: string) => void;
};

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"] as const;

/** Libellé complet lu par les lecteurs d'écran — le numéro seul est ambigu. */
const FULL_DATE_LABEL = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function parseIso(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

function addMonths(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + count, 1, 12);
}

function addDays(date: Date, count: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}

/** ±1 mois en conservant le quantième, borné à la longueur du mois cible. */
function shiftMonthKeepingDay(date: Date, count: number): Date {
  const target = addMonths(date, count);
  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
    12,
  ).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return target;
}

function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function SuggestionDatePicker({
  value,
  min,
  onChange,
}: SuggestionDatePickerProps) {
  const selected = useMemo(() => parseIso(value), [value]);
  const minDate = useMemo(() => parseIso(min ?? ""), [min]);
  const todayIso = useMemo(() => toIso(new Date()), []);

  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(selected ?? new Date()),
  );
  // Ancre du roving tabindex : un seul jour est atteignable au clavier.
  const [focusedIso, setFocusedIso] = useState(() => {
    if (selected) return toIso(selected);
    const today = parseIso(todayIso);
    if (!minDate || (today && today >= minDate)) return todayIso;
    return toIso(minDate);
  });

  const gridRef = useRef<HTMLDivElement>(null);
  // Le focus DOM ne bouge que sur demande explicite du clavier : un simple
  // re-rendu ne doit jamais voler le focus au reste de la page.
  const focusRequested = useRef(false);
  const monthLabelId = useId();

  const isDisabled = useCallback(
    (date: Date) => Boolean(minDate && date < minDate),
    [minDate],
  );

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("fr-FR", {
        month: "long",
        year: "numeric",
      }).format(visibleMonth),
    [visibleMonth],
  );

  const selectedIso = selected ? toIso(selected) : null;

  const weeks = useMemo(() => {
    const first = startOfMonth(visibleMonth);
    const offset = (first.getDay() + 6) % 7; // Monday-first
    const start = addDays(first, -offset);

    const cells = Array.from({ length: 42 }, (_, index) => {
      const date = addDays(start, index);
      const iso = toIso(date);
      return {
        date,
        iso,
        inMonth: date.getMonth() === visibleMonth.getMonth(),
        disabled: isDisabled(date),
        isSelected: selectedIso === iso,
        isToday: todayIso === iso,
        label: FULL_DATE_LABEL.format(date),
      };
    });

    return Array.from({ length: 6 }, (_, week) =>
      cells.slice(week * 7, week * 7 + 7),
    );
  }, [isDisabled, selectedIso, todayIso, visibleMonth]);

  // Exactement un jour porte tabIndex=0. Si l'ancre sort de la grille (mois
  // changé à la souris), on retombe sur le premier jour sélectionnable visible.
  const activeIso = useMemo(() => {
    const cells = weeks.flat();
    const anchored = cells.find((day) => day.iso === focusedIso && !day.disabled);
    if (anchored) return anchored.iso;
    const selectedCell = cells.find((day) => day.isSelected && !day.disabled);
    if (selectedCell) return selectedCell.iso;
    const firstInMonth = cells.find((day) => day.inMonth && !day.disabled);
    if (firstInMonth) return firstInMonth.iso;
    return cells.find((day) => !day.disabled)?.iso ?? null;
  }, [focusedIso, weeks]);

  useEffect(() => {
    if (!focusRequested.current) return;
    focusRequested.current = false;
    if (!activeIso) return;
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-iso="${activeIso}"]`)
      ?.focus();
  }, [activeIso]);

  const focusDay = useCallback(
    (iso: string) => {
      const target = parseIso(iso);
      if (!target) return;
      if (iso === activeIso) {
        gridRef.current
          ?.querySelector<HTMLButtonElement>(`[data-iso="${iso}"]`)
          ?.focus();
        return;
      }
      focusRequested.current = true;
      setFocusedIso(iso);
      setVisibleMonth((current) =>
        isSameMonth(current, target) ? current : startOfMonth(target),
      );
    },
    [activeIso],
  );

  /**
   * Les jours antérieurs à `min` ne doivent jamais recevoir le focus : on
   * poursuit dans le sens du déplacement jusqu'au premier jour sélectionnable,
   * et on ne bouge pas si la fenêtre de recherche n'en contient aucun.
   */
  const resolveTarget = useCallback(
    (from: Date, step: 1 | -1, maxScan: number): string | null => {
      let candidate = from;
      for (let index = 0; index <= maxScan; index += 1) {
        if (!isDisabled(candidate)) return toIso(candidate);
        candidate = addDays(candidate, step);
      }
      return null;
    },
    [isDisabled],
  );

  const handleGridKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!activeIso) return;
      const active = parseIso(activeIso);
      if (!active) return;

      if (event.key === "Enter" || event.key === " ") {
        // On court-circuite l'activation native du bouton pour garantir une
        // seule sélection, quel que soit le chemin (Entrée = click implicite).
        event.preventDefault();
        setFocusedIso(activeIso);
        onChange(activeIso);
        return;
      }

      let target: string | null = null;
      switch (event.key) {
        case "ArrowLeft":
          target = resolveTarget(addDays(active, -1), -1, 45);
          break;
        case "ArrowRight":
          target = resolveTarget(addDays(active, 1), 1, 45);
          break;
        case "ArrowUp":
          target = resolveTarget(addDays(active, -7), -1, 45);
          break;
        case "ArrowDown":
          target = resolveTarget(addDays(active, 7), 1, 45);
          break;
        case "Home":
          target = resolveTarget(
            addDays(active, -((active.getDay() + 6) % 7)),
            1,
            6,
          );
          break;
        case "End":
          target = resolveTarget(
            addDays(active, 6 - ((active.getDay() + 6) % 7)),
            -1,
            6,
          );
          break;
        case "PageUp":
          target = resolveTarget(shiftMonthKeepingDay(active, -1), 1, 31);
          break;
        case "PageDown":
          target = resolveTarget(shiftMonthKeepingDay(active, 1), 1, 31);
          break;
        default:
          return;
      }

      event.preventDefault();
      if (target) focusDay(target);
    },
    [activeIso, focusDay, onChange, resolveTarget],
  );

  return (
    <div
      className={styles.picker}
      data-testid="suggestion-date-picker"
      role="dialog"
      aria-label="Choisir une date"
    >
      <div className={styles.header}>
        <IconButton
          type="button"
          icon={ChevronLeft}
          size="sm"
          label="Mois précédent"
          onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
        />
        <p id={monthLabelId} className={styles.month} aria-live="polite">
          {monthLabel}
        </p>
        <IconButton
          type="button"
          icon={ChevronRight}
          size="sm"
          label="Mois suivant"
          onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
        />
      </div>

      <div className={styles.weekdays} aria-hidden>
        {WEEKDAYS.map((day, index) => (
          <span key={`${day}-${index}`} className={styles.weekday}>
            {day}
          </span>
        ))}
      </div>

      <div
        ref={gridRef}
        className={styles.grid}
        role="grid"
        aria-labelledby={monthLabelId}
        onKeyDown={handleGridKeyDown}
      >
        {weeks.map((week) => (
          <div key={week[0]!.iso} role="row" className={styles.week}>
            {week.map((day) => (
              <div
                key={day.iso}
                role="gridcell"
                aria-selected={day.isSelected}
                className={styles.cell}
              >
                <button
                  type="button"
                  disabled={day.disabled}
                  data-iso={day.iso}
                  data-testid={`suggestion-date-day-${day.iso}`}
                  tabIndex={day.iso === activeIso ? 0 : -1}
                  aria-label={day.label}
                  aria-current={day.isToday ? "date" : undefined}
                  className={cx(
                    styles.day,
                    !day.inMonth && styles.dayMuted,
                    day.isToday && styles.dayToday,
                    day.isSelected && styles.daySelected,
                  )}
                  onClick={() => {
                    setFocusedIso(day.iso);
                    onChange(day.iso);
                  }}
                >
                  {day.date.getDate()}
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            const today = toIso(new Date());
            if (minDate && parseIso(today)! < minDate) return;
            setFocusedIso(today);
            onChange(today);
          }}
        >
          Aujourd’hui
        </Button>
      </div>
    </div>
  );
}
