import { isStripePaymentsEnabled } from "@/config/env-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processStripeWebhookRequest } from "@/lib/stripe/webhooks/process";
import { StripeDomainError } from "@/lib/stripe/shared/errors";

export const runtime = "nodejs";
export const MAX_STRIPE_WEBHOOK_BODY_BYTES = 1024 * 1024;

async function readBoundedRawBody(request: Request): Promise<Buffer> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_STRIPE_WEBHOOK_BODY_BYTES) {
    throw new StripeDomainError("stripe_webhook_payload_too_large");
  }
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

export async function POST(request: Request): Promise<Response> {
  if (!isStripePaymentsEnabled()) {
    return new Response(null, { status: 404 });
  }

  try {
    const signature = request.headers.get("stripe-signature");
    const rawBody = await readBoundedRawBody(request);
    const result = await processStripeWebhookRequest({
      rawBody,
      signatureHeader: signature,
      supabaseAdmin: createAdminClient(),
    });

    return Response.json(result.body, { status: result.httpStatus });
  } catch (error) {
    if (error instanceof StripeDomainError) {
      if (error.code === "stripe_webhook_payload_too_large") {
        return Response.json({ error: "payload_too_large" }, { status: 413 });
      }
      if (
        error.code.includes("signature") ||
        error.code.includes("StripeSignature")
      ) {
        return Response.json({ error: "invalid_signature" }, { status: 400 });
      }
      return Response.json({ error: "webhook_error" }, { status: 500 });
    }

    return Response.json({ error: "webhook_error" }, { status: 500 });
  }
}
