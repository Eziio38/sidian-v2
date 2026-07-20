import "server-only";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getSidianEnvironment,
  type SidianEnvironment,
} from "@/config/env-server";
import { getStripeClient } from "@/lib/stripe/client";
import {
  retrieveConnectedAccount,
  syncConnectedAccountProjection,
} from "@/lib/stripe/connect/retrieve-and-sync";
import {
  classifyStripeFailure,
  StripeDomainError,
  toSafeStripeError,
} from "@/lib/stripe/shared/errors";
import type { Database } from "@/types/database.generated";

type Db = Database;
type PrestataireRow = Db["public"]["Tables"]["prestataire"]["Row"];

export type EnsureConnectedAccountResult = {
  prestataire: PrestataireRow;
  account: Stripe.Account;
  created: boolean;
};

function terminalConnectError(code: string): StripeDomainError {
  return new StripeDomainError(code, undefined, "terminal");
}

function validateProvisionedAccount(params: {
  account: Stripe.Account | Stripe.DeletedAccount;
  prestataireId: string;
  operationKey?: string | null;
  sidianEnvironment: SidianEnvironment;
}): Stripe.Account {
  const account = params.account;
  if ("deleted" in account && account.deleted) {
    throw terminalConnectError("connect_reconciliation_account_deleted");
  }
  if (
    account.object !== "account" ||
    account.type !== "express" ||
    account.country !== "FR" ||
    account.controller?.type !== "application" ||
    account.controller.requirement_collection !== "stripe" ||
    account.controller.stripe_dashboard?.type !== "express"
  ) {
    throw terminalConnectError("connect_reconciliation_account_incompatible");
  }
  if (
    account.metadata?.sidian_prestataire_id !== params.prestataireId ||
    account.metadata?.sidian_environment !== params.sidianEnvironment ||
    (params.operationKey &&
      account.metadata?.sidian_provisioning_operation_id !== params.operationKey)
  ) {
    throw terminalConnectError("connect_reconciliation_metadata_mismatch");
  }
  return account;
}

async function findProvisionedAccounts(params: {
  stripe: Stripe;
  operationKey: string;
}): Promise<Array<Stripe.Account>> {
  const matches: Stripe.Account[] = [];
  let startingAfter: string | undefined;
  do {
    const page = await params.stripe.accounts.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    matches.push(
      ...page.data.filter(
        (account) =>
          account.metadata?.sidian_provisioning_operation_id ===
          params.operationKey,
      ),
    );
    startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (startingAfter);
  return matches;
}

async function assertAccountNotAttachedElsewhere(params: {
  supabase: SupabaseClient<Db>;
  prestataireId: string;
  stripeAccountId: string;
}): Promise<void> {
  const { data, error } = await params.supabase
    .from("prestataire")
    .select("id")
    .eq("stripe_account_id", params.stripeAccountId)
    .neq("id", params.prestataireId)
    .maybeSingle();
  if (error) {
    throw new StripeDomainError(
      "connect_account_binding_lookup_failed",
      undefined,
      "retryable",
    );
  }
  if (data) {
    throw terminalConnectError("connect_account_attached_to_other_prestataire");
  }
}

async function flushConnectAudit(params: {
  supabase: SupabaseClient<Db>;
  prestataireId: string;
  operationKey: string;
}): Promise<void> {
  const { data, error } = await params.supabase.rpc(
    "flush_stripe_connect_audit_outbox",
    {
      p_prestataire_id: params.prestataireId,
      p_operation_key: params.operationKey,
    },
  );
  if (error || !data) {
    throw new StripeDomainError(
      "connect_audit_flush_failed",
      undefined,
      "retryable",
    );
  }
}

async function persistProvisioningFailure(params: {
  supabase: SupabaseClient<Db>;
  prestataireId: string;
  operationKey: string;
  error: unknown;
}): Promise<void> {
  const failure = classifyStripeFailure(params.error);
  const { error } = await params.supabase.rpc(
    "fail_prestataire_connect_provisioning",
    {
      p_prestataire_id: params.prestataireId,
      p_operation_key: params.operationKey,
      p_retryable: failure.disposition === "retryable",
      p_error_code: failure.code,
    },
  );
  if (error) {
    throw new StripeDomainError(
      "connect_failure_persistence_failed",
      undefined,
      "retryable",
    );
  }
}

export async function ensureConnectedAccountForCurrentPrestataire(params: {
  supabaseUser: SupabaseClient<Db>;
  supabaseAdmin: SupabaseClient<Db>;
  stripe?: Stripe;
  sidianEnvironment?: SidianEnvironment;
}): Promise<EnsureConnectedAccountResult> {
  const stripe = params.stripe ?? getStripeClient();
  const sidianEnvironment =
    params.sidianEnvironment ?? getSidianEnvironment();
  const { data: claimed, error: claimError } = await params.supabaseUser.rpc(
    "claim_current_prestataire_connect_provisioning",
    { p_lease_seconds: 120 },
  );

  if (claimError || !claimed) {
    throw new StripeDomainError("prestataire_connect_claim_failed");
  }
  const prestataire = claimed as PrestataireRow;
  const operationKey = prestataire.stripe_connect_operation_key;

  if (prestataire.stripe_account_id) {
    const account = validateProvisionedAccount({
      account: await retrieveConnectedAccount(prestataire.stripe_account_id, stripe),
      prestataireId: prestataire.id,
      operationKey,
      sidianEnvironment,
    });
    await assertAccountNotAttachedElsewhere({
      supabase: params.supabaseAdmin,
      prestataireId: prestataire.id,
      stripeAccountId: account.id,
    });
    if (operationKey) {
      await flushConnectAudit({
        supabase: params.supabaseAdmin,
        prestataireId: prestataire.id,
        operationKey,
      });
    }
    await syncConnectedAccountProjection({
      supabase: params.supabaseAdmin,
      prestataireId: prestataire.id,
      account,
    });
    return { prestataire, account, created: false };
  }

  const idempotencyKey = prestataire.stripe_connect_idempotency_key;
  if (!operationKey || !idempotencyKey) {
    throw terminalConnectError("connect_provisioning_state_invalid");
  }

  let account: Stripe.Account;
  let created = false;
  try {
    const matches = await findProvisionedAccounts({ stripe, operationKey });
    if (matches.length > 1) {
      throw terminalConnectError("connect_reconciliation_multiple_accounts");
    }
    if (matches.length === 1) {
      account = validateProvisionedAccount({
        account: matches[0],
        prestataireId: prestataire.id,
        operationKey,
        sidianEnvironment,
      });
    } else {
      const createdAccount = await stripe.accounts.create(
        {
          type: "express",
          country: "FR",
          email: prestataire.email,
          capabilities: {
            card_payments: { requested: true },
            sepa_debit_payments: { requested: true },
            transfers: { requested: true },
          },
          business_profile: {
            product_description: "Prestations de services — encaissement Sidian",
          },
          metadata: {
            sidian_prestataire_id: prestataire.id,
            sidian_environment: sidianEnvironment,
            sidian_provisioning_operation_id: operationKey,
          },
        },
        { idempotencyKey },
      );
      account = validateProvisionedAccount({
        account: createdAccount,
        prestataireId: prestataire.id,
        operationKey,
        sidianEnvironment,
      });
      created = true;
    }
    await assertAccountNotAttachedElsewhere({
      supabase: params.supabaseAdmin,
      prestataireId: prestataire.id,
      stripeAccountId: account.id,
    });
  } catch (error) {
    await persistProvisioningFailure({
      supabase: params.supabaseAdmin,
      prestataireId: prestataire.id,
      operationKey,
      error,
    });
    throw toSafeStripeError(error);
  }

  const auditAction = created
    ? "stripe.connect.account_created"
    : "stripe.connect.account_reconciled";
  const { data: completed, error: completionError } = await params.supabaseAdmin.rpc(
    "complete_prestataire_connect_provisioning",
    {
      p_prestataire_id: prestataire.id,
      p_operation_key: operationKey,
      p_stripe_account_id: account.id,
      p_audit_action: auditAction,
    },
  );
  if (completionError || !completed) {
    throw new StripeDomainError(
      "connect_completion_persistence_failed",
      undefined,
      "retryable",
    );
  }

  await flushConnectAudit({
    supabase: params.supabaseAdmin,
    prestataireId: prestataire.id,
    operationKey,
  });
  await syncConnectedAccountProjection({
    supabase: params.supabaseAdmin,
    prestataireId: prestataire.id,
    account,
  });

  return { prestataire: completed as PrestataireRow, account, created };
}
