import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isStripePaymentsEnabled: vi.fn(() => true),
  createAdminClient: vi.fn(() => ({ kind: "admin" })),
  processStripeWebhookRequest: vi.fn(async () => ({
    httpStatus: 200,
    body: { received: true },
  })),
  evaluateStripeWebhookRateLimit: vi.fn(async () =>
    ({ status: "allowed" }) as
      | { status: "allowed" }
      | { status: "limited"; resetAt: string | null }
      | { status: "unavailable" },
  ),
  logServerEvent: vi.fn(),
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
vi.mock("@/lib/stripe/webhooks/rate-limit", () => ({
  evaluateStripeWebhookRateLimit: mocks.evaluateStripeWebhookRateLimit,
}));
vi.mock("@/lib/observability/server-logger", () => ({
  logServerEvent: mocks.logServerEvent,
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
    expect(mocks.createAdminClient).toHaveBeenCalledOnce();
    expect(mocks.evaluateStripeWebhookRateLimit).toHaveBeenCalledOnce();
    expect(mocks.processStripeWebhookRequest).not.toHaveBeenCalled();
  });

  it("refuse sans acquitter le webhook lorsque le quota persistant est dépassé", async () => {
    mocks.evaluateStripeWebhookRateLimit.mockResolvedValueOnce({
      status: "limited",
      resetAt: "2026-07-21T20:01:00.000Z",
    });

    const response = await POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(429);
    expect(mocks.processStripeWebhookRequest).not.toHaveBeenCalled();
  });

  it("ne lit pas le body avant de refuser un quota dépassé", async () => {
    mocks.evaluateStripeWebhookRateLimit.mockResolvedValueOnce({
      status: "limited",
      resetAt: null,
    });
    let bodyReads = 0;
    const request = {
      headers: new Headers({ "stripe-signature": "sig_test" }),
      get body() {
        bodyReads += 1;
        throw new Error("body must not be read");
      },
    } as unknown as Request;

    const response = await POST(request);

    expect(response.status).toBe(429);
    expect(bodyReads).toBe(0);
    expect(mocks.processStripeWebhookRequest).not.toHaveBeenCalled();
  });

  it("échoue fermé en 503 si le quota persistant est indisponible", async () => {
    mocks.evaluateStripeWebhookRateLimit.mockResolvedValueOnce({
      status: "unavailable",
    });

    const requestId = "11111111-1111-4111-8111-111111111111";
    const response = await POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: {
          "stripe-signature": "sig_test",
          "x-sidian-request-id": requestId,
        },
        body: "{}",
      }),
    );

    expect(response.status).toBe(503);
    expect(mocks.processStripeWebhookRequest).not.toHaveBeenCalled();
    expect(mocks.logServerEvent).toHaveBeenCalledWith(
      "error",
      "security.rate_limit_unavailable",
      {
        requestId,
        operation: "stripe_webhook",
        component: "stripe",
      },
    );
    expect(JSON.stringify(mocks.logServerEvent.mock.calls)).not.toContain(
      "sig_test",
    );
  });

  it("préserve le body brut, la signature et le même client admin après quota", async () => {
    const response = await POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: '{"id":"evt_test"}',
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.processStripeWebhookRequest).toHaveBeenCalledWith({
      rawBody: Buffer.from('{"id":"evt_test"}'),
      signatureHeader: "sig_test",
      supabaseAdmin: { kind: "admin" },
    });
  });
});
