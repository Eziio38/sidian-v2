import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /app/activite est le SEUL point d'entrée vers /app/approbations depuis
 * l'interface (l'ancien tableau de bord a été supprimé). Sans ce test, la page
 * d'approbations peut devenir injoignable sans qu'aucune suite n'échoue.
 */

const mocks = vi.hoisted(() => ({
  requireConfirmedUser: vi.fn(async () => ({ id: "user-1" })),
  createClient: vi.fn(async () => ({ kind: "supabase" })),
  ensurePrestataireForUser: vi.fn(async () => ({
    id: "prestataire-1",
    nom: "Atelier Test",
    email: "atelier@test.fr",
  })),
  loadDashboard: vi.fn(async () => ({ events: [] })),
  listApprovalRequests: vi.fn(async () => [] as { status: string }[]),
}));

vi.mock("@/lib/auth/session", () => ({
  requireConfirmedUser: mocks.requireConfirmedUser,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/auth/ensure-prestataire", () => ({
  ensurePrestataireForUser: mocks.ensurePrestataireForUser,
}));
vi.mock("@/lib/dashboard/load-dashboard", () => ({
  loadDashboard: mocks.loadDashboard,
}));
vi.mock("@/lib/approvals/approvals", () => ({
  listApprovalRequests: mocks.listApprovalRequests,
}));
vi.mock("@/components/app/app-shell", () => ({
  AppShell: ({
    actions,
    children,
  }: {
    actions?: ReactNode;
    children?: ReactNode;
  }) => (
    <div>
      <div data-testid="app-shell-actions">{actions}</div>
      {children}
    </div>
  ),
}));

const { default: ActivitePage } = await import("./page");

async function renderPage() {
  render(await ActivitePage());
}

describe("ActivitePage — accès aux approbations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("expose un lien vers /app/approbations dès qu'une décision est en attente", async () => {
    mocks.listApprovalRequests.mockResolvedValueOnce([{ status: "pending" }]);

    await renderPage();

    expect(
      screen.getByRole("link", { name: "1 décision à prendre" }),
    ).toHaveAttribute("href", "/app/approbations");
  });

  it("pluralise le lien au-delà d'une décision en attente", async () => {
    mocks.listApprovalRequests.mockResolvedValueOnce([
      { status: "pending" },
      { status: "pending" },
      { status: "approved" },
    ]);

    await renderPage();

    expect(
      screen.getByRole("link", { name: "2 décisions à prendre" }),
    ).toHaveAttribute("href", "/app/approbations");
  });

  it("n'affiche aucun lien lorsqu'il n'y a rien à décider", async () => {
    await renderPage();

    expect(screen.queryByRole("link")).toBeNull();
  });
});
