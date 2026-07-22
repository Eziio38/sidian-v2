import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireConfirmedUser: vi.fn(async () => ({ id: "user_1" })),
  createClient: vi.fn(async () => ({ kind: "user" })),
  createAdminClient: vi.fn(async () => ({ kind: "admin" })),
  reconcile: vi.fn(),
  revalidatePath: vi.fn(),
  logServerEvent: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/session", () => ({
  requireConfirmedUser: mocks.requireConfirmedUser,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/stripe/reconciliation/payment-reconciliation", () => ({
  reconcilePaymentReceivableFromStripe: mocks.reconcile,
}));
vi.mock("@/lib/observability/server-logger", () => ({
  logServerEvent: mocks.logServerEvent,
}));

import { reconcilePaymentReceivableAction } from "./payment-reconciliation";

const RECEIVABLE_ID = "11111111-1111-4111-8111-111111111111";

function form(receivableId = RECEIVABLE_ID): FormData {
  const data = new FormData();
  data.set("receivableId", receivableId);
  return data;
}

describe("action prestataire de réconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reconcile.mockResolvedValue({
      status: "up_to_date",
      projectionRepaired: false,
    });
  });

  it("authentifie et ne transmet que l’identité serveur et l’UUID métier", async () => {
    const result = await reconcilePaymentReceivableAction(undefined, form());

    expect(result).toMatchObject({ ok: true, status: "up_to_date" });
    expect(mocks.reconcile).toHaveBeenCalledWith({
      supabaseUser: { kind: "user" },
      supabaseAdmin: { kind: "admin" },
      userId: "user_1",
      receivableId: RECEIVABLE_ID,
    });
    expect(JSON.stringify(mocks.reconcile.mock.calls[0])).not.toMatch(
      /(?:acct_|cs_|pi_|cus_)/,
    );
  });

  it("rejette un identifiant invalide avant la service role", async () => {
    const result = await reconcilePaymentReceivableAction(
      undefined,
      form("not-a-uuid"),
    );

    expect(result).toEqual({
      ok: false,
      status: "invalid",
      message: "Paiement à recevoir introuvable.",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("présente le garde-fou humain sans exposer d’identifiant Stripe", async () => {
    mocks.reconcile.mockResolvedValue({
      status: "human_required",
      projectionRepaired: true,
    });

    const result = await reconcilePaymentReceivableAction(undefined, form());

    expect(result).toMatchObject({ ok: true, status: "human_required" });
    expect(JSON.stringify(result)).not.toMatch(/(?:acct_|cs_|pi_|cus_)/);
    expect(result.message).toContain("Aucun effet financier ambigu");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/approbations");
  });

  it("échoue fermé si Stripe n’est pas vérifiable", async () => {
    mocks.reconcile.mockResolvedValue({
      status: "retry",
      projectionRepaired: false,
    });

    const result = await reconcilePaymentReceivableAction(undefined, form());

    expect(result).toEqual({
      ok: false,
      status: "retry",
      message:
        "Stripe ne peut pas être vérifié de façon fiable maintenant. Aucune modification financière n’a été appliquée.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

