import { loadWhatsAppEnv } from "@/lib/communication-channels/whatsapp/env";
import { requestIdFromHeaders } from "@/lib/observability/request-id";
import { logServerEvent } from "@/lib/observability/server-logger";
import {
  verifyWhatsAppSignature,
  verifyWhatsAppWebhookChallenge,
} from "@/lib/communication-channels/whatsapp/webhook/verify";
import { processWhatsAppStatusWebhook } from "@/lib/communication-channels/whatsapp/webhook/process";
import {
  assertLiveWebhookPersistence,
  createSupabaseWebhookEventRepository,
} from "@/lib/communication-channels/whatsapp/webhook/supabase-webhook-event-repository";
import {
  createLiveWhatsAppWebhookDeps,
  type WhatsAppWebhookRuntimeDeps,
} from "@/lib/communication-channels/whatsapp/webhook/create-live-deps";
import { createMemoryWebhookEventRepository } from "@/lib/communication-channels/whatsapp/webhook/process";
import { createMemoryCommunicationMessageRepository } from "@/lib/communication-channels/outbound/memory-repository";
import {
  hasInboundMessages,
  parseWhatsAppInboundMessages,
} from "@/lib/communication-channels/whatsapp/inbound";
import { createInboundCommunicationService } from "@/lib/communication-channels/inbound/service";
import {
  createMemoryGuidePaymentConfirmationRepository,
  createMemoryInboundMessageRepository,
  createMemoryInteractionSessionRepository,
} from "@/lib/communication-channels/inbound/memory-repositories";
import { createMemoryIdentityDirectory } from "@/lib/communication-channels/inbound/identity";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const MAX_WHATSAPP_WEBHOOK_BODY_BYTES = 512 * 1024;

/**
 * Trust boundary G1-P + G1-Q :
 * - GET : challenge Meta
 * - POST live : HMAC obligatoire
 * - statuses → delivery tracking
 * - messages → inbound actions (corrélation outbound, jamais tenant du payload)
 *
 * Live : repositories Supabase service_role via createAdminClient (jamais mémoire).
 * Stub/test : mémoire autorisée.
 */

type WhatsAppWebhookDeps = WhatsAppWebhookRuntimeDeps;

async function createDefaultDeps(): Promise<WhatsAppWebhookDeps> {
  const env = loadWhatsAppEnv();

  if (env.mode === "live") {
    if (!env.guideRecipientTechnicalId?.trim()) {
      throw new Error(
        "WhatsApp live webhook requires SIDIAN_WHATSAPP_GUIDE_RECIPIENT_TECHNICAL_ID.",
      );
    }
    // Attestation environnement + service_role — même chemin que Stripe webhook.
    const client = await createAdminClient();
    return createLiveWhatsAppWebhookDeps({
      client,
      guideRecipientTechnicalId: env.guideRecipientTechnicalId,
    });
  }

  const messages = createMemoryCommunicationMessageRepository();
  return {
    messages,
    events: createMemoryWebhookEventRepository(),
    eventsAreMemory: true,
    inboundService: createInboundCommunicationService({
      inbound: createMemoryInboundMessageRepository(),
      sessions: createMemoryInteractionSessionRepository(),
      confirmations: createMemoryGuidePaymentConfirmationRepository(),
      outboundMessages: messages,
      identities: createMemoryIdentityDirectory([]),
      guideRecipientTechnicalId: env.guideRecipientTechnicalId,
    }),
  };
}

let deps: WhatsAppWebhookDeps | null = null;
let depsInit: Promise<WhatsAppWebhookDeps> | null = null;

export function setWhatsAppWebhookDeps(next: WhatsAppWebhookDeps): void {
  deps = next;
  depsInit = Promise.resolve(next);
}

async function getDeps(): Promise<WhatsAppWebhookDeps> {
  if (deps) return deps;
  if (!depsInit) {
    depsInit = createDefaultDeps().then((resolved) => {
      deps = resolved;
      return resolved;
    });
  }
  return depsInit;
}

async function readBoundedRawBody(request: Request): Promise<Buffer> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_WHATSAPP_WEBHOOK_BODY_BYTES) {
      await reader.cancel();
      throw new Error("payload_too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function GET(request: Request): Promise<Response> {
  const env = loadWhatsAppEnv();
  if (!env.enabled || env.mode === "disabled") {
    return new Response(null, { status: 404 });
  }
  if (!env.webhookVerifyToken) {
    return new Response(null, { status: 503 });
  }

  const url = new URL(request.url);
  const result = verifyWhatsAppWebhookChallenge({
    mode: url.searchParams.get("hub.mode"),
    verifyToken: url.searchParams.get("hub.verify_token"),
    challenge: url.searchParams.get("hub.challenge"),
    expectedToken: env.webhookVerifyToken,
  });

  if (!result.ok) {
    return new Response(null, { status: 403 });
  }
  return new Response(result.challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

export async function POST(request: Request): Promise<Response> {
  const requestId = requestIdFromHeaders(request.headers);
  const env = loadWhatsAppEnv();

  if (!env.enabled || env.mode === "disabled") {
    return new Response(null, { status: 404 });
  }

  try {
    const current = await getDeps();
    assertLiveWebhookPersistence({
      mode: env.mode,
      isMemory: current.eventsAreMemory,
    });

    const rawBody = await readBoundedRawBody(request);

    // Live : HMAC obligatoire. Stub local : HMAC si appSecret configuré.
    const requireSignature = env.mode === "live" || Boolean(env.appSecret);
    if (requireSignature) {
      if (!env.appSecret) {
        return Response.json({ error: "misconfigured" }, { status: 503 });
      }
      const signature = request.headers.get("x-hub-signature-256");
      if (
        !verifyWhatsAppSignature({
          rawBody,
          signatureHeader: signature,
          appSecret: env.appSecret,
        })
      ) {
        logServerEvent("warn", "whatsapp.webhook_invalid_signature", {
          requestId,
        });
        return Response.json({ error: "invalid_signature" }, { status: 401 });
      }
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as unknown;
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }

    if (hasInboundMessages(payload)) {
      if (!current.inboundService) {
        return Response.json({ error: "inbound_unconfigured" }, { status: 503 });
      }
      const inboundMessages = parseWhatsAppInboundMessages(payload);
      let processed = 0;
      let duplicates = 0;
      for (const message of inboundMessages) {
        const result = await current.inboundService.processInboundMessage(message);
        if (result.detail === "duplicate") duplicates += 1;
        if (result.processingStatus === "processed") processed += 1;
      }
      logServerEvent("info", "whatsapp.inbound_processed", {
        requestId,
        count: inboundMessages.length,
        processed,
        duplicates,
      });
      // Réponse minimale — pas de domainEvent / IDs métier vers l'appelant webhook.
      return Response.json(
        {
          ok: true,
          inbound: {
            count: inboundMessages.length,
            processed,
            duplicates,
          },
        },
        { status: 200 },
      );
    }

    const result = await processWhatsAppStatusWebhook({
      payload,
      messages: current.messages,
      events: current.events,
    });

    logServerEvent("info", "whatsapp.webhook_processed", {
      requestId,
      accepted: result.accepted,
      duplicates: result.duplicates,
      applied: result.applied,
      unknown: result.unknown,
    });

    return Response.json({ ok: true, ...result }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "payload_too_large") {
      return Response.json({ error: "payload_too_large" }, { status: 413 });
    }
    if (
      error instanceof Error &&
      (error.message.includes("persistent webhook event repository") ||
        error.message.includes("service_role persistence"))
    ) {
      logServerEvent("error", "whatsapp.webhook_misconfigured", { requestId });
      return Response.json({ error: "misconfigured" }, { status: 503 });
    }
    logServerEvent("error", "whatsapp.webhook_failed", {
      requestId,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return Response.json({ error: "webhook_error" }, { status: 500 });
  }
}

/** Exposé pour wiring ops / tests — force Supabase en live. */
export {
  createSupabaseWebhookEventRepository,
  createLiveWhatsAppWebhookDeps,
};
