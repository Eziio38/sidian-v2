import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireConfirmedUser: vi.fn(),
  getPrestataireForUser: vi.fn(),
  createSupabaseClient: vi.fn(),
  createClientPayeur: vi.fn(),
  revalidatePath: vi.fn(),
  createAdmin: vi.fn(),
  assertConversationScope: vi.fn(),
  attachConversationToClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireConfirmedUser: mocks.requireConfirmedUser,
}));
vi.mock("@/lib/auth/ensure-prestataire", () => ({
  getPrestataireForUser: mocks.getPrestataireForUser,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createSupabaseClient,
}));
vi.mock("@/lib/clients/client-payeur", () => ({
  archiveClientPayeur: vi.fn(),
  createClientPayeur: mocks.createClientPayeur,
  updateClientPayeur: vi.fn(),
}));
vi.mock("@/lib/creances/creance", () => ({
  archiveCreance: vi.fn(),
  createCreanceDraft: vi.fn(),
  updateCreanceDraft: vi.fn(),
}));
vi.mock("@/config/env-public", () => ({
  getPublicEnv: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock("@/lib/assistant-conversations", () => ({
  assertConversationScope: mocks.assertConversationScope,
  attachConversationToClient: mocks.attachConversationToClient,
}));
vi.mock("@/lib/agent/server/auth/service-role", () => ({
  createAgentPersistenceClient: mocks.createAdmin,
}));

import { createClientPayeurAction } from "./clients-creances";

const CREATION_KEY = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";

function formData(overrides: Record<string, string> = {}) {
  const data = new FormData();
  data.set("nom", overrides.nom ?? "Dupont Conseil");
  data.set("email", overrides.email ?? "finance@dupont.test");
  data.set("creationKey", overrides.creationKey ?? CREATION_KEY);
  if (overrides.conversationId) {
    data.set("conversationId", overrides.conversationId);
  }
  return data;
}

function lookupBuilder(
  results: Array<{ data: unknown; error: unknown }>,
): Record<string, unknown> {
  let cursor = 0;
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "limit"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => {
    const result = results[cursor] ?? { data: null, error: null };
    cursor += 1;
    return result;
  });
  return builder;
}

describe("createClientPayeurAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireConfirmedUser.mockResolvedValue({ id: "user-a" });
    mocks.getPrestataireForUser.mockResolvedValue({ id: "prestataire-a" });
    mocks.createAdmin.mockResolvedValue({ kind: "service-role" });
    mocks.assertConversationScope.mockResolvedValue(true);
    mocks.attachConversationToClient.mockResolvedValue({
      clientId: "client-a",
      clientName: "Dupont Conseil",
    });
  });

  it("réutilise le client du compte ayant le même email", async () => {
    const supabase = {
      from: vi.fn(() =>
        lookupBuilder([
          {
            data: {
              id: "client-a",
              nom: "Dupont Conseil",
              email: "finance@dupont.test",
              prestataire_id: "prestataire-a",
            },
            error: null,
          },
        ]),
      ),
    };
    mocks.createSupabaseClient.mockResolvedValue(supabase);

    const result = await createClientPayeurAction(
      undefined,
      formData({ conversationId: CONVERSATION_ID }),
    );

    expect(result).toEqual({
      ok: true,
      existing: true,
      client: {
        id: "client-a",
        name: "Dupont Conseil",
        email: "finance@dupont.test",
      },
    });
    expect(mocks.createClientPayeur).not.toHaveBeenCalled();
    expect(mocks.attachConversationToClient).toHaveBeenCalledWith({
      admin: { kind: "service-role" },
      prestataireId: "prestataire-a",
      conversationId: CONVERSATION_ID,
      clientId: "client-a",
    });
  });

  it("avertit avant un doublon évident portant le même nom", async () => {
    const builder = lookupBuilder([
      { data: null, error: null },
      { data: { id: "client-a" }, error: null },
    ]);
    mocks.createSupabaseClient.mockResolvedValue({
      from: vi.fn(() => builder),
    });

    const result = await createClientPayeurAction(undefined, formData());

    expect(result).toEqual({
      ok: false,
      message:
        "Un client portant ce nom existe déjà. Choisissez-le dans la liste ou utilisez un autre nom.",
    });
    expect(mocks.createClientPayeur).not.toHaveBeenCalled();
  });

  it("refuse d’associer un client à une discussion hors compte", async () => {
    mocks.createSupabaseClient.mockResolvedValue({
      from: vi.fn(() => lookupBuilder([])),
    });
    mocks.assertConversationScope.mockResolvedValue(false);

    const result = await createClientPayeurAction(
      undefined,
      formData({ conversationId: CONVERSATION_ID }),
    );

    expect(result).toEqual({
      ok: false,
      message: "La discussion associée est introuvable.",
    });
    expect(mocks.createClientPayeur).not.toHaveBeenCalled();
    expect(mocks.attachConversationToClient).not.toHaveBeenCalled();
  });

  it("crée puis associe le client seulement après les contrôles de périmètre", async () => {
    const builder = lookupBuilder([
      { data: null, error: null },
      { data: null, error: null },
    ]);
    mocks.createSupabaseClient.mockResolvedValue({
      from: vi.fn(() => builder),
    });
    mocks.createClientPayeur.mockResolvedValue({
      id: "client-new",
      nom: "Dupont Conseil",
      email: "finance@dupont.test",
      prestataire_id: "prestataire-a",
    });

    const result = await createClientPayeurAction(
      undefined,
      formData({ conversationId: CONVERSATION_ID }),
    );

    expect(result).toEqual({
      ok: true,
      existing: false,
      client: {
        id: "client-new",
        name: "Dupont Conseil",
        email: "finance@dupont.test",
      },
    });
    expect(mocks.createClientPayeur).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        nom: "Dupont Conseil",
        email: "finance@dupont.test",
        creationKey: CREATION_KEY,
      }),
    );
    expect(mocks.attachConversationToClient).toHaveBeenCalledWith({
      admin: { kind: "service-role" },
      prestataireId: "prestataire-a",
      conversationId: CONVERSATION_ID,
      clientId: "client-new",
    });
  });
});
