import { z } from "zod";

import { AUTHORIZATION_RAW_TOKEN_RE } from "./token";

const STRIPE_CHECKOUT_SESSION_ID_RE = /^cs_[A-Za-z0-9_]+$/;

export function isStripeCheckoutSessionId(value: string): boolean {
  return (
    value.length >= 4 &&
    value.length <= 255 &&
    STRIPE_CHECKOUT_SESSION_ID_RE.test(value)
  );
}

const authorizationDecisionSchema = z.object({
  rawToken: z.string().regex(AUTHORIZATION_RAW_TOKEN_RE),
  sourceCheckoutSessionId: z
    .string()
    .min(4)
    .max(255)
    .refine(isStripeCheckoutSessionId),
  decision: z.enum(["accept", "decline"]),
});

const paymentLinkTokenSchema = z.string().regex(AUTHORIZATION_RAW_TOKEN_RE);

function formString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" ? value : null;
}

export function parseAuthorizationDecisionForm(formData: FormData) {
  return authorizationDecisionSchema.safeParse({
    rawToken: formString(formData, "authorization_token"),
    sourceCheckoutSessionId: formString(formData, "source_session_id"),
    decision: formString(formData, "decision"),
  });
}

export function parsePaymentLinkTokenForm(formData: FormData) {
  return paymentLinkTokenSchema.safeParse(formString(formData, "payment_token"));
}
