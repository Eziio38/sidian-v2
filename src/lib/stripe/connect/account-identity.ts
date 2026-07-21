import "server-only";

import type Stripe from "stripe";

import type { SidianEnvironment } from "@/config/env-server";
import { StripeDomainError } from "@/lib/stripe/shared/errors";

/**
 * Vérifie l'identité complète d'un compte Connect avant de l'exposer à un
 * parcours produit. L'identifiant attendu vient toujours de la base, jamais du
 * navigateur.
 */
export function assertConnectedAccountIdentity(params: {
  account: Stripe.Account | Stripe.DeletedAccount;
  expectedAccountId: string;
  prestataireId: string;
  operationKey?: string | null;
  sidianEnvironment: SidianEnvironment;
}): Stripe.Account {
  const account = params.account;

  if (
    ("deleted" in account && account.deleted) ||
    account.object !== "account" ||
    account.id !== params.expectedAccountId ||
    account.type !== "express" ||
    account.country !== "FR" ||
    account.controller?.type !== "application" ||
    account.controller.requirement_collection !== "stripe" ||
    account.controller.stripe_dashboard?.type !== "express" ||
    account.metadata?.sidian_prestataire_id !== params.prestataireId ||
    account.metadata?.sidian_environment !== params.sidianEnvironment ||
    (params.operationKey &&
      account.metadata?.sidian_provisioning_operation_id !==
        params.operationKey)
  ) {
    throw new StripeDomainError(
      "stripe_account_scope_mismatch",
      undefined,
      "terminal",
    );
  }

  return account;
}
