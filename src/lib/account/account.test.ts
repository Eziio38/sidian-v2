import { describe, expect, it, vi } from "vitest";

import { summariseAccountClosure } from "./reporting";
import { closeAccount, exportAccountData } from "./service";
import type { AccountAdminClient, AccountSessionClient } from "./service";

function sessionClient(result: {
  data?: unknown;
  error?: { message?: string } | null;
}): AccountSessionClient & { rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
  });
  return { rpc };
}

function adminClient(options: {
  removeError?: { message?: string } | null;
  authError?: { message?: string } | null;
}) {
  const remove = vi
    .fn()
    .mockResolvedValue({ error: options.removeError ?? null });
  const updateUserById = vi
    .fn()
    .mockResolvedValue({ error: options.authError ?? null });
  const admin: AccountAdminClient = {
    storage: { from: () => ({ remove }) },
    auth: { admin: { updateUserById } },
  };
  return { admin, remove, updateUserById };
}

const CLOSURE_PAYLOAD = {
  prestataire_id: "11111111-1111-4111-8111-111111111111",
  already_closed: false,
  closed_at: "2026-08-03T12:00:00+00:00",
  anonymised: {
    profile_identity: true,
    documents_soft_deleted: 2,
    messages_erased: 5,
    conversations_cleared: 1,
  },
  retained_for_legal_obligation: { clients: 3, creances: 4, payments: 2 },
  storage_paths: ["tenant/doc-a/facture.pdf", "tenant/doc-b/avoir.pdf"],
};

describe("exportAccountData", () => {
  it("n’envoie aucun identifiant de tenant à la RPC", async () => {
    const session = sessionClient({ data: { schema_version: 1 } });

    const result = await exportAccountData(session);

    expect(result).toEqual({ ok: true, value: { schema_version: 1 } });
    expect(session.rpc).toHaveBeenCalledWith("export_current_account_data");
    expect(session.rpc.mock.calls[0]).toHaveLength(1);
  });

  it("traduit un compte clôturé en refus explicite", async () => {
    const session = sessionClient({
      error: { message: 'account_closed dans "close"' },
    });

    const result = await exportAccountData(session);

    expect(result).toEqual({
      ok: false,
      code: "account_closed",
      message: "Ce compte est clôturé.",
    });
  });

  it("n’expose jamais le message brut de la base", async () => {
    const session = sessionClient({
      error: { message: 'relation "public.creance" does not exist' },
    });

    const result = await exportAccountData(session);

    expect(result).toEqual({
      ok: false,
      code: "account_export_unavailable",
      message: "L’export de vos données n’a pas pu être produit pour le moment.",
    });
  });
});

describe("closeAccount", () => {
  it("clôture, purge les octets et révoque l’identité Auth", async () => {
    const session = sessionClient({ data: CLOSURE_PAYLOAD });
    const { admin, remove, updateUserById } = adminClient({});

    const result = await closeAccount({
      session,
      admin,
      userId: "44444444-4444-4444-8444-444444444444",
    });

    expect(session.rpc).toHaveBeenCalledWith("close_current_account");
    expect(remove).toHaveBeenCalledWith(CLOSURE_PAYLOAD.storage_paths);
    expect(updateUserById).toHaveBeenCalledWith(
      "44444444-4444-4444-8444-444444444444",
      expect.objectContaining({
        email: `compte-clos+${CLOSURE_PAYLOAD.prestataire_id}@sidian.invalid`,
        ban_duration: "876000h",
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      prestataireId: CLOSURE_PAYLOAD.prestataire_id,
      alreadyClosed: false,
      closedAt: CLOSURE_PAYLOAD.closed_at,
      anonymised: {
        profileIdentity: true,
        documentsSoftDeleted: 2,
        messagesErased: 5,
        conversationsCleared: 1,
      },
      retainedForLegalObligation: { clients: 3, creances: 4, payments: 2 },
      storageObjectsRemoved: true,
      storageObjectsCount: 2,
      authIdentityRevoked: true,
    });
  });

  it("signale les octets non retirés au lieu d’annoncer un effacement complet", async () => {
    const session = sessionClient({ data: CLOSURE_PAYLOAD });
    const { admin } = adminClient({ removeError: { message: "boom" } });

    const result = await closeAccount({ session, admin, userId: "user" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storageObjectsRemoved).toBe(false);
    expect(summariseAccountClosure(result.value)).toContain(
      "Vos documents ont été retirés de l’application, mais leurs fichiers n’ont pas pu être effacés du stockage. Contactez le support pour finaliser cette suppression.",
    );
  });

  it("signale une révocation d’accès incomplète", async () => {
    const session = sessionClient({ data: CLOSURE_PAYLOAD });
    const { admin } = adminClient({ authError: { message: "auth down" } });

    const result = await closeAccount({ session, admin, userId: "user" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.authIdentityRevoked).toBe(false);
    expect(summariseAccountClosure(result.value)).toContain(
      "Votre accès n’a pas pu être révoqué complètement. Contactez le support sans attendre.",
    );
  });

  it("reste idempotent sur un compte déjà clôturé", async () => {
    const session = sessionClient({
      data: {
        prestataire_id: CLOSURE_PAYLOAD.prestataire_id,
        already_closed: true,
        closed_at: CLOSURE_PAYLOAD.closed_at,
        storage_paths: [],
      },
    });
    const { admin, remove } = adminClient({});

    const result = await closeAccount({ session, admin, userId: "user" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.alreadyClosed).toBe(true);
    expect(remove).not.toHaveBeenCalled();
    expect(summariseAccountClosure(result.value)).toEqual([
      "Ce compte était déjà clôturé.",
      "Vos factures, paiements et clients associés sont conservés : la loi impose de garder les pièces comptables. Le reste de votre compte a été anonymisé.",
    ]);
  });

  it("ne prétend pas avoir clôturé quand la RPC échoue", async () => {
    const session = sessionClient({ error: { message: "deadlock detected" } });
    const { admin, remove, updateUserById } = adminClient({});

    const result = await closeAccount({ session, admin, userId: "user" });

    expect(result).toEqual({
      ok: false,
      code: "account_closure_unavailable",
      message: "La clôture du compte n’a pas pu être effectuée pour le moment.",
    });
    expect(remove).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
  });
});

describe("summariseAccountClosure", () => {
  it("nomme toujours la conservation légale", () => {
    const lines = summariseAccountClosure({
      prestataireId: "id",
      alreadyClosed: false,
      closedAt: null,
      anonymised: {
        profileIdentity: true,
        documentsSoftDeleted: 0,
        messagesErased: 0,
        conversationsCleared: 0,
      },
      retainedForLegalObligation: { clients: 0, creances: 0, payments: 0 },
      storageObjectsRemoved: true,
      storageObjectsCount: 0,
      authIdentityRevoked: true,
    });

    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/pièces comptables/);
    expect(lines.join(" ")).not.toMatch(/entièrement supprimé/);
  });
});
