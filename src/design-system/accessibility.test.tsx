import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button, Card, ErrorCard, IconButton } from "./components";
import { ShieldCheck } from "lucide-react";

describe("Design system — restitution des états", () => {
  it("n'ajoute aucune région live aux boutons sans état de chargement", () => {
    // Monter une région live sur chaque bouton polluait l'arbre
    // d'accessibilité : une dizaine de régions vides par écran.
    render(<Button>Fermer</Button>);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("monte la région live du bouton avant tout chargement", () => {
    // `loading={false}` exprime « ce bouton pilote un chargement » : la région
    // doit préexister à sa mutation, un role="status" créé en même temps que le
    // message n'étant pas annoncé.
    const { rerender } = render(<Button loading={false}>Enregistrer</Button>);

    const live = screen.getByRole("status");
    expect(live).toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: "Enregistrer" })).toContainElement(
      live,
    );

    rerender(
      <Button loading loadingLabel="Enregistrement…">
        Enregistrer
      </Button>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Enregistrement…");
    // Le libellé visible est retiré de l'arbre d'accessibilité pendant le
    // chargement : le nom du bouton ne doit pas être dédoublé.
    expect(
      screen.getByRole("button", { name: "Enregistrement…" }),
    ).toHaveAttribute("aria-busy", "true");
  });

  it("garde le libellé accessible d'un IconButton pendant le chargement", () => {
    render(
      <IconButton
        icon={ShieldCheck}
        label="Ouvrir la protection"
        loading
        loadingLabel="Chargement…"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Ouvrir la protection" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Chargement…");
  });

  it("titre les cartes en h2 par défaut, sans saut de niveau depuis le h1", () => {
    render(
      <>
        <Card title="Synthèse" />
        <ErrorCard title="Action impossible" />
        <Card title="Détail" titleAs="h3" />
      </>,
    );

    expect(
      screen.getByRole("heading", { name: "Synthèse", level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Action impossible", level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Détail", level: 3 }),
    ).toBeInTheDocument();
  });
});
