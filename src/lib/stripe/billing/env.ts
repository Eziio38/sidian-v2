import "server-only";

import { z } from "zod";

import { getApplicationEnvironment, type SidianEnvironment } from "@/config/env-server";

/**
 * Configuration de l'abonnement Sidian — VOLONTAIREMENT séparée de Connect.
 *
 * Pourquoi une configuration distincte plutôt que la réutilisation de
 * `STRIPE_SECRET_KEY` / `STRIPE_CONNECT_WEBHOOK_SECRET` :
 *
 * 1. Ce sont deux flux d'argent opposés. Connect encaisse le client final POUR
 *    le prestataire (compte connecté). L'abonnement encaisse le prestataire
 *    POUR Sidian (compte plateforme). Partager un secret d'endpoint reviendrait
 *    à laisser un événement d'un flux écrire dans l'état de l'autre.
 * 2. Stripe signe chaque endpoint webhook avec son propre secret. Deux endpoints
 *    = deux secrets ; c'est la seule façon d'affirmer « cet événement vient bien
 *    de l'endpoint facturation ».
 * 3. Les deux modules doivent pouvoir être activés indépendamment : on peut
 *    vouloir facturer l'abonnement sans avoir encore ouvert Connect, et
 *    inversement. Aucune des deux lectures d'environnement ne dépend de l'autre.
 *
 * Absence de configuration ⇒ module désactivé, jamais d'échec de démarrage et
 * jamais d'abonnement simulé.
 */

const billingEnvSchema = z.object({
  STRIPE_BILLING_SECRET_KEY: z
    .string()
    .regex(/^sk_(test|live)_\S+$/, "clé secrète de facturation invalide"),
  STRIPE_BILLING_PRICE_ID: z
    .string()
    .regex(/^price_\S+$/, "identifiant de prix Stripe invalide"),
  STRIPE_BILLING_WEBHOOK_SECRET: z
    .string()
    .regex(/^whsec_\S+$/, "secret de webhook de facturation invalide"),
  /**
   * Durée du verrouillage tarifaire Early Access, en mois.
   *
   * [DÉCISION EN ATTENTE] `docs/SIDIAN_02_PRD_V2.md` §6 : « prix maintenu
   * 12 mois » pour les 20 premiers comptes. `docs/SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md`
   * §1 : « verrouillage à vie pour les 30 premiers comptes, pas une fenêtre de
   * 12 mois ». Les deux se contredisent, et l'audit interne
   * (docs/FINAL_TECHNICAL_AUDIT.md) a déjà relevé la contradiction sans qu'elle
   * soit tranchée. Le mécanisme est implémenté ; la valeur reste une décision
   * commerciale explicite. Non renseignée ⇒ aucune promesse enregistrée.
   */
  STRIPE_BILLING_EARLY_ACCESS_LOCK_MONTHS: z
    .string()
    .regex(/^\d{1,3}$/)
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => value >= 1 && value <= 600)
    .optional(),
});

export type SidianBillingDisabledReason =
  /** Aucune variable STRIPE_BILLING_* renseignée : module simplement absent. */
  | "not_configured"
  /** Variables présentes mais invalides / incohérentes : on refuse d'agir. */
  | "invalid_configuration"
  /** Mode de clé incohérent avec l'environnement de déploiement. */
  | "environment_mismatch"
  /** Le secret de facturation est identique à celui de Connect. */
  | "shared_with_connect";

export type SidianBillingReadiness =
  | { enabled: false; reason: SidianBillingDisabledReason }
  | {
      enabled: true;
      secretKey: string;
      priceId: string;
      webhookSecret: string;
      mode: "test" | "live";
      environment: SidianEnvironment;
      /** null = aucune durée de verrouillage décidée (cf. contradiction docs). */
      earlyAccessLockMonths: number | null;
    };

function readBillingEnvInput() {
  return {
    STRIPE_BILLING_SECRET_KEY: process.env.STRIPE_BILLING_SECRET_KEY,
    STRIPE_BILLING_PRICE_ID: process.env.STRIPE_BILLING_PRICE_ID,
    STRIPE_BILLING_WEBHOOK_SECRET: process.env.STRIPE_BILLING_WEBHOOK_SECRET,
    STRIPE_BILLING_EARLY_ACCESS_LOCK_MONTHS:
      process.env.STRIPE_BILLING_EARLY_ACCESS_LOCK_MONTHS || undefined,
  };
}

/**
 * Évalue la configuration facturation. Ne lève jamais : un déploiement sans
 * abonnement doit démarrer normalement et le dire honnêtement à l'utilisateur.
 */
export function resolveSidianBillingReadiness(
  input: Record<string, string | undefined> = readBillingEnvInput(),
  appEnvironment: SidianEnvironment = getApplicationEnvironment(),
  connectWebhookSecret: string | undefined = process.env
    .STRIPE_CONNECT_WEBHOOK_SECRET,
): SidianBillingReadiness {
  const present = [
    input.STRIPE_BILLING_SECRET_KEY,
    input.STRIPE_BILLING_PRICE_ID,
    input.STRIPE_BILLING_WEBHOOK_SECRET,
  ].filter((value) => typeof value === "string" && value.trim() !== "");

  if (present.length === 0) {
    return { enabled: false, reason: "not_configured" };
  }

  const parsed = billingEnvSchema.safeParse(input);
  if (!parsed.success) {
    return { enabled: false, reason: "invalid_configuration" };
  }

  // Garde-fou de séparation : un même secret pour les deux endpoints signifie
  // que les événements Connect et facturation transitent par la même signature.
  if (
    connectWebhookSecret &&
    connectWebhookSecret === parsed.data.STRIPE_BILLING_WEBHOOK_SECRET
  ) {
    return { enabled: false, reason: "shared_with_connect" };
  }

  const mode = parsed.data.STRIPE_BILLING_SECRET_KEY.startsWith("sk_live_")
    ? "live"
    : "test";

  // Même règle que Connect : jamais de clé live hors production, jamais de clé
  // test en production.
  if (
    (appEnvironment === "production" && mode !== "live") ||
    (appEnvironment !== "production" && mode !== "test")
  ) {
    return { enabled: false, reason: "environment_mismatch" };
  }

  return {
    enabled: true,
    secretKey: parsed.data.STRIPE_BILLING_SECRET_KEY,
    priceId: parsed.data.STRIPE_BILLING_PRICE_ID,
    webhookSecret: parsed.data.STRIPE_BILLING_WEBHOOK_SECRET,
    mode,
    environment: appEnvironment,
    earlyAccessLockMonths:
      parsed.data.STRIPE_BILLING_EARLY_ACCESS_LOCK_MONTHS ?? null,
  };
}

export function getSidianBillingReadiness(): SidianBillingReadiness {
  return resolveSidianBillingReadiness();
}

export function isSidianBillingEnabled(): boolean {
  return getSidianBillingReadiness().enabled;
}
