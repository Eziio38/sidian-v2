import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("annonce la page active sans marquer Accueil sur les sous-routes métier", () => {
    render(<AppNavigation />);

    expect(
      screen.getByRole("link", { name: "Dossiers" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("link", { name: "Accueil" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("rend la navigation Premium AI Workspace", () => {
    render(<AppNavigation compact />);

    expect(screen.getByRole("link", { name: "Accueil" })).toHaveAttribute(
      "href",
      "/app/assistant",
    );
    expect(screen.getByRole("link", { name: "Paiements" })).toHaveAttribute(
      "href",
      "/app/paiements",
    );
    expect(screen.getByRole("link", { name: "Activité" })).toHaveAttribute(
      "href",
      "/app/activite",
    );
    expect(screen.getByRole("link", { name: "Dossiers" })).toHaveAttribute(
      "href",
      "/app/paiements-a-recevoir",
    );
    expect(screen.queryByRole("link", { name: "Paramètres" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Bien démarrer" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Connexion Stripe" })).toBeNull();
  });

  it("n’utilise pas le libellé Historique", () => {
    render(<AppNavigation />);
    expect(screen.queryByRole("link", { name: "Historique" })).toBeNull();
  });

  it("affiche Sidian et délègue Accueil au démarrage d’une conversation vide", async () => {
    const user = userEvent.setup();
    const onHomeNavigate = vi.fn();
    render(<AppNavigation onHomeNavigate={onHomeNavigate} />);

    expect(screen.getByText("Sidian")).toBeVisible();
    await user.click(screen.getByRole("link", { name: "Accueil" }));
    expect(onHomeNavigate).toHaveBeenCalledTimes(1);
  });

  it("place Demander à Sidian juste après Sidian avec le même rythme de navigation", async () => {
    const user = userEvent.setup();
    const onNewConversation = vi.fn();
    render(
      <AppNavigation
        showNewConversation
        onNewConversation={onNewConversation}
      />,
    );

    const home = screen.getByRole("link", { name: "Accueil" });
    const newConversation = screen.getByRole("button", {
      name: "Demander à Sidian",
    });
    expect(home.closest("li")?.nextElementSibling).toBe(
      newConversation.closest("li"),
    );

    await user.click(newConversation);
    expect(onNewConversation).toHaveBeenCalledTimes(1);
  });
});
