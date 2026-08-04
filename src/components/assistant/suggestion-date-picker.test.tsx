import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SuggestionDatePicker } from "./suggestion-date-picker";

// lundi 3 août 2026 — semaine complète, mois à 6 rangées visibles.
const TODAY = new Date("2026-08-03T09:00:00");

function Harness({
  initial = "2026-08-12",
  min,
  onChange,
}: {
  initial?: string;
  min?: string;
  onChange?: (iso: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <SuggestionDatePicker
      value={value}
      min={min}
      onChange={(iso) => {
        setValue(iso);
        onChange?.(iso);
      }}
    />
  );
}

function tabbableDays(): HTMLElement[] {
  return screen
    .getAllByRole("gridcell")
    .flatMap((cell) => Array.from(cell.querySelectorAll("button")))
    .filter((button) => button.getAttribute("tabindex") === "0");
}

describe("SuggestionDatePicker — navigation clavier", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(TODAY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("n’expose qu’un seul jour dans l’ordre de tabulation", () => {
    render(<Harness />);

    const tabbable = tabbableDays();
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAttribute(
      "data-testid",
      "suggestion-date-day-2026-08-12",
    );
  });

  it("annonce la date complète en français", () => {
    render(<Harness />);

    expect(
      screen.getByTestId("suggestion-date-day-2026-08-03"),
    ).toHaveAccessibleName("lundi 3 août 2026");
  });

  it("marque le jour sélectionné via aria-selected", () => {
    render(<Harness />);

    const selected = screen.getAllByRole("gridcell", { selected: true });
    expect(selected).toHaveLength(1);
    expect(selected[0]!.querySelector("button")).toHaveAttribute(
      "data-testid",
      "suggestion-date-day-2026-08-12",
    );
  });

  it("déplace le focus avec les flèches (±1 jour, ±7 jours)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);

    const start = screen.getByTestId("suggestion-date-day-2026-08-12");
    start.focus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("suggestion-date-day-2026-08-13")).toHaveFocus();

    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByTestId("suggestion-date-day-2026-08-11")).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByTestId("suggestion-date-day-2026-08-18")).toHaveFocus();

    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(screen.getByTestId("suggestion-date-day-2026-08-04")).toHaveFocus();

    // Un seul jour reste tabulable après déplacement.
    expect(tabbableDays()).toHaveLength(1);
  });

  it("Home et End atteignent les bornes de la semaine", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);

    screen.getByTestId("suggestion-date-day-2026-08-12").focus();

    await user.keyboard("{Home}");
    expect(screen.getByTestId("suggestion-date-day-2026-08-10")).toHaveFocus();

    await user.keyboard("{End}");
    expect(screen.getByTestId("suggestion-date-day-2026-08-16")).toHaveFocus();
  });

  it("PageUp et PageDown changent le mois affiché", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);

    screen.getByTestId("suggestion-date-day-2026-08-12").focus();

    await user.keyboard("{PageDown}");
    expect(screen.getByText("septembre 2026")).toBeInTheDocument();
    expect(screen.getByTestId("suggestion-date-day-2026-09-12")).toHaveFocus();

    await user.keyboard("{PageUp}{PageUp}");
    expect(screen.getByText("juillet 2026")).toBeInTheDocument();
    expect(screen.getByTestId("suggestion-date-day-2026-07-12")).toHaveFocus();
  });

  it("change de mois quand une flèche franchit la frontière", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness initial="2026-08-31" />);

    screen.getByTestId("suggestion-date-day-2026-08-31").focus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("septembre 2026")).toBeInTheDocument();
    expect(screen.getByTestId("suggestion-date-day-2026-09-01")).toHaveFocus();
  });

  it("sélectionne avec Entrée puis avec Espace, une seule fois par frappe", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    screen.getByTestId("suggestion-date-day-2026-08-12").focus();
    await user.keyboard("{ArrowRight}{Enter}");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-08-13");

    await user.keyboard("{ArrowRight}[Space]");
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenNthCalledWith(2, "2026-08-14");
  });

  it("ne donne jamais le focus à un jour désactivé", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness initial="2026-08-03" min="2026-08-03" />);

    const anchor = screen.getByTestId("suggestion-date-day-2026-08-03");
    anchor.focus();

    // Les jours antérieurs à `min` sont désactivés : le focus ne recule pas.
    await user.keyboard("{ArrowLeft}");
    expect(anchor).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(anchor).toHaveFocus();

    expect(screen.getByTestId("suggestion-date-day-2026-08-02")).toBeDisabled();
    expect(
      screen.getByTestId("suggestion-date-day-2026-08-02"),
    ).toHaveAttribute("tabindex", "-1");
  });

  it("ancre le tabindex sur le premier jour sélectionnable quand le mois change à la souris", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness initial="2026-08-12" min="2026-08-03" />);

    await user.click(screen.getByRole("button", { name: "Mois précédent" }));

    // Juillet est entièrement antérieur à `min` : aucun jour du mois n'est
    // sélectionnable, l'ancre retombe sur la première date encore atteignable.
    const tabbable = tabbableDays();
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAttribute(
      "data-testid",
      "suggestion-date-day-2026-08-03",
    );
  });
});
