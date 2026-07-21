import { isStripePaymentsEnabled } from "@/config/env-server";
import { requestIdFromHeaders } from "@/lib/observability/request-id";
import { logServerEvent } from "@/lib/observability/server-logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { processStripeWebhookRequest } from "@/lib/stripe/webhooks/process";
import { evaluateStripeWebhookRateLimit } from "@/lib/stripe/webhooks/rate-limit";
import { StripeDomainError } from "@/lib/stripe/shared/errors";

export const runtime = "nodejs";
export const MAX_STRIPE_WEBHOOK_BODY_BYTES = 1024 * 1024;

async function readBoundedRawBody(request: Request): Promise<Buffer> {
  if (!request.body) return Buffer.alloc(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_STRIPE_WEBHOOK_BODY_BYTES) {
      await reader.cancel();
      throw new StripeDomainError("stripe_webhook_payload_too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function assertDeclaredBodyLengthIsBounded(headers: Headers): void {
  const declaredLength = Number(headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_STRIPE_WEBHOOK_BODY_BYTES
  ) {
    throw new StripeDomainError("stripe_webhook_payload_too_large");
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isStripePaymentsEnabled()) {
    return new Response(null, { status: 404 });
  }

  const requestId = requestIdFromHeaders(request.headers);

  try {
    const signature = request.headers.get("stripe-signature");
    assertDeclaredBodyLengthIsBounded(request.headers);
    const supabaseAdmin = await createAdminClient();
    const rateLimit = await evaluateStripeWebhookRateLimit({
      requestHeaders: request.headers,
      supabaseAdmin,
    });
    if (rateLimit.status === "limited") {
      return Response.json({ error: "too_many_requests" }, { status: 429 });
    }
    if (rateLimit.status === "unavailable") {
      // Stripe réessaiera les réponses 5xx ; aucun événement n'est acquitté si
      // la défense persistante est indisponible.
      logServerEvent("error", "security.rate_limit_unavailable", {
        requestId,
        operation: "stripe_webhook",
        component: "stripe",
      });
      return Response.json({ error: "webhook_unavailable" }, { status: 503 });
    }

    const rawBody = await readBoundedRawBody(request);
    const result = await processStripeWebhookRequest({
      rawBody,
      signatureHeader: signature,
      supabaseAdmin,
    });

    return Response.json(result.body, { status: result.httpStatus });
  } catch (error) {
    if (error instanceof StripeDomainError) {
      if (error.code === "stripe_webhook_payload_too_large") {
        logServerEvent("warn", "stripe.webhook_failed", {
          requestId,
          errorCode: error.code,
          status: 413,
        });
        return Response.json({ error: "payload_too_large" }, { status: 413 });
      }
      if (
        error.code.includes("signature") ||
        error.code.includes("StripeSignature")
      ) {
        logServerEvent("warn", "stripe.webhook_failed", {
          requestId,
          errorCode: "invalid_signature",
          status: 400,
        });
        return Response.json({ error: "invalid_signature" }, { status: 400 });
      }
      logServerEvent("error", "stripe.webhook_failed", {
        requestId,
        errorCode: error.code,
        status: 500,
      });
      return Response.json({ error: "webhook_error" }, { status: 500 });
    }

    logServerEvent("error", "stripe.webhook_failed", {
      requestId,
      errorCode: error instanceof Error ? error.name : "unknown",
      status: 500,
    });
    return Response.json({ error: "webhook_error" }, { status: 500 });
  }
}
