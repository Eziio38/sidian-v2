import { readFileSync } from "node:fs";
import path from "node:path";

import { render, screen } from "@testing-library/react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { describe, expect, it } from "vitest";

import {
  Badge,
  Button,
  CardLoading,
  Composer,
  EmptyState,
  IconButton,
  Input,
  ProtectionCard,
  Select,
  Spinner,
  TimelineCard,
  Typography,
} from "./components";
import {
  colorTokens,
  layoutTokens,
  spacingTokens,
  typographyRoles,
} from "./tokens";

describe("Sidian Design System", () => {
  it("expose les rôles et références de tokens officiels", () => {
    expect(typographyRoles).toEqual([
      "display",
      "h1",
      "h2",
      "h3",
      "title",
      "body",
      "bodySmall",
      "caption",
      "label",
      "code",
    ]);
    expect(colorTokens.accent).toBe("var(--ds-color-accent)");
    expect(spacingTokens[4]).toBe("var(--ds-space-4)");
    expect(layoutTokens.sidebarWidth).toBe("var(--ds-layout-sidebar-width)");
  });

  it("contient les familles de tokens requises dans la source CSS", () => {
    const css = readFileSync(
      path.join(process.cwd(), "src/design-system/tokens.css"),
      "utf8",
    );

    for (const token of [
      "--ds-color-background",
      "--ds-type-display-size",
      "--ds-space-24",
      "--ds-radius-pill",
      "--ds-shadow-xl",
      "--ds-duration-normal",
      "--ds-layout-sidebar-width",
      "--ds-breakpoint-md",
    ]) {
      expect(css).toContain(token);
    }
  });

  it("rend les boutons avec leurs états accessibles", () => {
    render(
      <>
        <Button icon={ArrowRight}>Continuer</Button>
        <Button loading loadingLabel="Enregistrement…">
          Enregistrer
        </Button>
        <Button disabled>Indisponible</Button>
        <IconButton icon={ShieldCheck} label="Ouvrir la protection" />
      </>,
    );

    expect(screen.getByRole("button", { name: "Continuer" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Enregistrement…" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("button", { name: "Enregistrement…" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Indisponible" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Ouvrir la protection" }),
    ).toBeInTheDocument();
  });

  it("relie labels, aides et erreurs aux champs", () => {
    render(
      <>
        <Input
          label="Montant"
          hint="Montant TTC"
          error="Vérifie le montant saisi."
          required
        />
        <Select label="Statut">
          <option>À suivre</option>
        </Select>
        <Composer placeholder="Demande quelque chose à Sidian…" />
      </>,
    );

    const input = screen.getByLabelText(/Montant/);
    const describedBy = input.getAttribute("aria-describedby") ?? "";

    expect(input).toBeInvalid();
    expect(describedBy).toContain("-hint");
    expect(describedBy).toContain("-error");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Vérifie le montant saisi.",
    );
    expect(screen.getByLabelText("Statut")).toBeInTheDocument();
    expect(screen.getByLabelText("Demande à Sidian")).toHaveAttribute(
      "placeholder",
      "Demande quelque chose à Sidian…",
    );
  });

  it("rend les cartes, badges, états vides et chargements", () => {
    render(
      <>
        <ProtectionCard
          title="Protection prête"
          description="Dossier à relire."
        />
        <TimelineCard
          title="Activité"
          items={[{ id: "one", label: "Paiement créé" }]}
        />
        <Badge tone="success">Réglé</Badge>
        <EmptyState title="Aucun paiement" />
        <Spinner />
        <CardLoading />
        <Typography variant="h2">Synthèse</Typography>
      </>,
    );

    expect(screen.getByText("Protection prête").closest("article")).toHaveAttribute(
      "data-card-variant",
      "protection",
    );
    expect(screen.getByText("Paiement créé")).toBeInTheDocument();
    expect(screen.getByText("Réglé")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Aucun paiement" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(
      screen.getByRole("heading", { name: "Synthèse", level: 2 }),
    ).toBeInTheDocument();
  });
});
