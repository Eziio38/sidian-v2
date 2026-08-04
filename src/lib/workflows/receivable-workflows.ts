import "server-only";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import { reconcileCheckoutSessionsBeforeCancellation } from "@/lib/stripe/checkout/reconcile-before-cancellation";
import type { Database } from "@/types/database.generated";
import { cancelPaymentReceivable as commitPaymentReceivableCancellation } from "./receivable-workflows-core";

export {
  ensureFollowUpCase,
  updateFollowUpCase,
  type FollowUpCase,
} from "./receivable-workflows-core";

export async function cancelPaymentReceivableSafely(
  supabase: SupabaseClient<Database>,
  receivableId: string,
  options?: { stripe?: Stripe },
): Promise<void> {
  await reconcileCheckoutSessionsBeforeCancellation({
    supabase,
    receivableId,
    stripe: options?.stripe,
  });
  await commitPaymentReceivableCancellation(supabase, receivableId);
}
