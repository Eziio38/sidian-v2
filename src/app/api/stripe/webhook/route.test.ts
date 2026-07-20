import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isStripePaymentsEnabled: vi.fn(() => true),
  createAdminClient: vi.fn(() => ({ kind: "admin" })),
  processStripeWebhookRequest: vi.fn(async () => ({
    httpStatus: 200,
    body: { received: true },
  })),
}));

vi.mock("@/config/env-server", () => ({
  isStripePaymentsEnabled: mocks.isStripePaymentsEnabled,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/stripe/webhooks/process", () => ({
  processStripeWebhookRequest: mocks.processStripeWebhookRequest,
}));

import {
  MAX_STRIPE_WEBHOOK_BODY_BYTES,
  POST,
} from "@/app/api/stripe/webhook/route";

describe("route webhook Stripe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isStripePaymentsEnabled.mockReturnValue(true);
  });

  it("retourne 404 immédiatement lorsque Stripe est désactivé", async () => {
    mocks.isStripePaymentsEnabled.mockReturnValue(false);
    let headerReads = 0;
    let bodyReads = 0;
    const request = {
      get headers() {
        headerReads += 1;
        throw new Error("headers must not be read");
      },
      get body() {
        bodyReads += 1;
        throw new Error("body must not be read");
      },
    } as unknown as Request;

    const response = await POST(request);

    expect(response.status).toBe(404);
    expect(headerReads).toBe(0);
    expect(bodyReads).toBe(0);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.processStripeWebhookRequest).not.toHaveBeenCalled();
  });

  it("refuse un Content-Length supérieur à 1 Mio avant traitement", async () => {
    const response = await POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: {
          "content-length": String(MAX_STRIPE_WEBHOOK_BODY_BYTES + 1),
          "stripe-signature": "invalid",
        },
        body: "{}",
      }),
    );
    expect(response.status).toBe(413);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("refuse également un flux dont la taille réelle dépasse la limite", async () => {
    const response = await POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "invalid" },
        body: new Uint8Array(MAX_STRIPE_WEBHOOK_BODY_BYTES + 1),
      }),
    );
    expect(response.status).toBe(413);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
