import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireConfirmedUser: vi.fn(),
  ensurePrestataireForUser: vi.fn(),
  configureCurrentPrestataireProfile: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/session", () => ({
  requireConfirmedUser: mocks.requireConfirmedUser,
}));
vi.mock("@/lib/auth/ensure-prestataire", () => ({
  ensurePrestataireForUser: mocks.ensurePrestataireForUser,
}));
vi.mock("@/lib/profile/profile", () => ({
  configureCurrentPrestataireProfile: mocks.configureCurrentPrestataireProfile,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { configureProfileAction } from "./profile";

describe("configureProfileAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireConfirmedUser.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      email_confirmed_at: "2026-07-21T10:00:00.000Z",
    });
    mocks.createClient.mockResolvedValue({});
    mocks.ensurePrestataireForUser.mockResolvedValue({ id: "prestataire" });
    mocks.configureCurrentPrestataireProfile.mockResolvedValue({ id: "prestataire" });
  });

  it("valide avant toute mutation serveur", async () => {
    const form = new FormData();
    form.set("nom", "A");
    form.set("profilAgent", "sans-garde-fou");

    const result = await configureProfileAction(undefined, form);

    expect(result.ok).toBe(false);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("dérive l’identité de la session et ne transmet que le profil validé", async () => {
    const form = new FormData();
    form.set("nom", "  Atelier   Horizon ");
    form.set("profilAgent", "controle");
    form.set("prestataireId", "tenant-injecte");

    await expect(configureProfileAction(undefined, form)).resolves.toEqual({
      ok: true,
    });
    expect(mocks.ensurePrestataireForUser).toHaveBeenCalledOnce();
    expect(mocks.configureCurrentPrestataireProfile).toHaveBeenCalledWith(
      {},
      { nom: "Atelier Horizon", profilAgent: "controle" },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/demarrage");
  });
});
