import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppNavigation } from "./app-navigation";

const usePathname = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
}));

describe("AppNavigation", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/app/paiements-a-recevoir");
  });

  it("annonce la page active sans marquer le dashboard sur les sous-routes", () => {
    render(<AppNavigation />);

    expect(
      screen.getByRole("link", { name: "Paiements à recevoir" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("rend toutes les destinations de la Phase 2 accessibles", () => {
    render(<AppNavigation compact />);

    expect(screen.getByRole("link", { name: "Bien démarrer" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Connexion Stripe" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Approbations" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Paramètres" })).toBeVisible();
  });
});
