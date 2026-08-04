import { describe, expect, it, vi } from "vitest";

import {
  configureCurrentPrestataireProfile,
  getCurrentPrestataireProfile,
} from "./profile-core";

const profile = {
  id: "11111111-1111-4111-8111-111111111111",
  nom: "Atelier Horizon",
  email: "bonjour@atelier.test",
  profil_agent_defaut: "controle" as const,
  onboarding_profile_completed_at: "2026-07-21T10:00:00.000Z",
};

describe("profil prestataire", () => {
  it("lit uniquement le profil du tenant exposé par RLS", async () => {
    const single = vi.fn().mockResolvedValue({ data: profile, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const from = vi.fn().mockReturnValue({ select });

    await expect(
      getCurrentPrestataireProfile({ from } as never),
    ).resolves.toEqual(profile);
    expect(from).toHaveBeenCalledWith("prestataire");
    expect(single).toHaveBeenCalledOnce();
  });

  it("ne transmet que le nom et le profil à la RPC tenant-safe", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: profile, error: null });

    await expect(
      configureCurrentPrestataireProfile({ rpc } as never, {
        nom: "Atelier Horizon",
        profilAgent: "controle",
      }),
    ).resolves.toEqual(profile);

    expect(rpc).toHaveBeenCalledWith(
      "configure_current_prestataire_profile",
      {
        p_nom: "Atelier Horizon",
        p_profil_agent: "controle",
      },
    );
  });

  it("ne renvoie jamais l’erreur brute de la base", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "sensitive database detail" },
    });

    await expect(
      configureCurrentPrestataireProfile({ rpc } as never, {
        nom: "Atelier Horizon",
        profilAgent: "controle",
      }),
    ).rejects.toThrow("prestataire_profile_update_failed");
  });
});
