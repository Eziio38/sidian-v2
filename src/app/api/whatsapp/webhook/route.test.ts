import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WhatsAppEnv } from "@/lib/communication-channels/whatsapp/env";
import type { WhatsAppWebhookRuntimeDeps } from "@/lib/communication-channels/whatsapp/webhook/create-live-deps";

const APP_SECRET = "app_secret_de_test_32_caracteres!";
const VERIFY_TOKEN = "verify_token_test";

const mocks = vi.hoisted(() => ({
  loadWhatsAppEnv: vi.fn(),
  createAdminClient: vi.fn(async () => {
    throw new Error("createAdminClient must not be called in tests");
  }),
  logServerEvent: vi.fn(),
}));

vi.mock("@/lib/communication-channels/whatsapp/env", () => ({
  loadWhatsAppEnv: mocks.loadWhatsAppEnv,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/observability/server-logger", () => ({
  logServerEvent: mocks.logServerEvent,
}));

import {
  GET,
  MAX_WHATSAPP_WEBHOOK_BODY_BYTES,
  POST,
  handleWhatsAppWebhookPost,
} from "@/app/api/whatsapp/webhook/route";

function env(overrides: Partial<WhatsAppEnv> = {}): WhatsAppEnv {
  return {
    enabled: true,
    mode: "stub",
    graphApiVersion: "v21.0",
    httpTimeoutMs: 8_000,
    webhookVerifyToken: VERIFY_TOKEN,
    ...overrides,
  };
}

function signed(rawBody: string | Uint8Array): string {
  return `sha256=${createHmac("sha256", APP_SECRET).update(Buffer.from(rawBody)).digest("hex")}`;
}

describe("route webhook WhatsApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadWhatsAppEnv.mockReturnValue(env());
  });

  describe("GET — challenge Meta", () => {
    it("renvoie le challenge quand le verify token correspond", async () => {
      const response = await GET(
        new Request(
          "http://localhost/api/whatsapp/webhook?hub.mode=subscribe" +
            `&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1234567890`,
        ),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/plain");
      await expect(response.text()).resolves.toBe("1234567890");
    });

    it("refuse en 403 un verify token incorrect sans révéler le challenge", async () => {
      const response = await GET(
        new Request(
          "http://localhost/api/whatsapp/webhook?hub.mode=subscribe" +
            "&hub.verify_token=mauvais_token&hub.challenge=1234567890",
        ),
      );

      expect(response.status).toBe(403);
      await expect(response.text()).resolves.toBe("");
    });

    it("renvoie 404 lorsque le provider est désactivé", async () => {
      mocks.loadWhatsAppEnv.mockReturnValue(
        env({ enabled: false, mode: "disabled" }),
      );

      const response = await GET(
        new Request(
          "http://localhost/api/whatsapp/webhook?hub.mode=subscribe" +
            `&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1234567890`,
        ),
      );

      expect(response.status).toBe(404);
    });
  });

  describe("POST", () => {
    it("renvoie 404 sans lire le body lorsque le provider est désactivé", async () => {
      mocks.loadWhatsAppEnv.mockReturnValue(
        env({ enabled: false, mode: "disabled" }),
      );

      let bodyReads = 0;
      const request = {
        headers: new Headers(),
        get body() {
          bodyReads += 1;
          throw new Error("body must not be read");
        },
      } as unknown as Request;

      const response = await POST(request);

      expect(response.status).toBe(404);
      expect(bodyReads).toBe(0);
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    });

    it("refuse en 401 une signature HMAC invalide", async () => {
      mocks.loadWhatsAppEnv.mockReturnValue(env({ appSecret: APP_SECRET }));

      const response = await POST(
        new Request("http://localhost/api/whatsapp/webhook", {
          method: "POST",
          headers: { "x-hub-signature-256": signed("{}") },
          body: '{"object":"whatsapp_business_account"}',
        }),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: "invalid_signature",
      });
      // Le secret ne doit jamais transiter par les logs.
      expect(JSON.stringify(mocks.logServerEvent.mock.calls)).not.toContain(
        APP_SECRET,
      );
    });

    it("refuse en 401 une signature absente quand un app secret est configuré", async () => {
      mocks.loadWhatsAppEnv.mockReturnValue(env({ appSecret: APP_SECRET }));

      const response = await POST(
        new Request("http://localhost/api/whatsapp/webhook", {
          method: "POST",
          body: "{}",
        }),
      );

      expect(response.status).toBe(401);
    });

    it("refuse en 413 un payload dépassant la limite avant tout parsing", async () => {
      const oversized = new Uint8Array(MAX_WHATSAPP_WEBHOOK_BODY_BYTES + 1);

      const response = await POST(
        new Request("http://localhost/api/whatsapp/webhook", {
          method: "POST",
          headers: { "x-hub-signature-256": signed(oversized) },
          body: oversized,
        }),
      );

      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toEqual({
        error: "payload_too_large",
      });
    });

    it("échoue fermé en 503 si le mode live retombe sur une persistance mémoire", async () => {
      mocks.loadWhatsAppEnv.mockReturnValue(
        env({
          mode: "live",
          appSecret: APP_SECRET,
          accessToken: "token",
          phoneNumberId: "phone",
          senderE164: "+33600000000",
        }),
      );

      const memoryDeps = {
        messages: {} as WhatsAppWebhookRuntimeDeps["messages"],
        events: {} as WhatsAppWebhookRuntimeDeps["events"],
        eventsAreMemory: true,
        inboundService: null,
      } satisfies WhatsAppWebhookRuntimeDeps;

      const response = await handleWhatsAppWebhookPost(
        new Request("http://localhost/api/whatsapp/webhook", {
          method: "POST",
          headers: { "x-hub-signature-256": signed("{}") },
          body: "{}",
        }),
        { deps: memoryDeps },
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: "misconfigured",
      });
      expect(mocks.logServerEvent).toHaveBeenCalledWith(
        "error",
        "whatsapp.webhook_misconfigured",
        expect.anything(),
      );
    });
  });
});
