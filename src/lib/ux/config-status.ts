import "server-only";

import { isEmailProviderEnabled, loadEmailEnv } from "@/lib/email/env";
import {
  isWhatsAppProviderEnabled,
  loadWhatsAppEnv,
} from "@/lib/communication-channels/whatsapp/env";
import { AUTO_DEBIT_REGLE_CEILING_PRODUCT_READY } from "@/lib/runtime/payments/constants";
import {
  getPrestataireStripeReadiness,
  type PrestataireStripeReadiness,
} from "@/lib/stripe/connect/readiness";
import { UX_COPY, UX_STATUS_LABEL } from "@/lib/ux/microcopy";
import type {
  ConfigChannelStatus,
  WorkspaceConfigStatus,
} from "@/lib/ux/config-status-types";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.generated";

export type {
  ConfigChannelKind,
  ConfigChannelStatus,
  ConfigProbeState,
  WorkspaceConfigStatus,
} from "@/lib/ux/config-status-types";

type Db = Database;

function probeEmail(): ConfigChannelStatus {
  const copy = UX_COPY.missingConfigEmail;
  /** Pas d’admin email prestataire : CTA = prochaine étape réelle (démarrage). */
  const nextStep = {
    href: "/app/demarrage",
    actionLabel: copy.actionLabel ?? "Continuer le démarrage",
  } as const;

  try {
    const env = loadEmailEnv();
    if (!isEmailProviderEnabled(env)) {
      return {
        kind: "email",
        state: "missing",
        label: UX_STATUS_LABEL.missing,
        title: copy.title,
        description: copy.description,
        ...nextStep,
      };
    }
    if (env.mode === "stub") {
      return {
        kind: "email",
        state: "partial",
        label: UX_STATUS_LABEL.partial,
        title: "Emails en mode essai",
        description:
          "L’envoi email est simulé ici. En production, Sidian active l’envoi réel. Rien à configurer dans Paramètres pour l’instant.",
        ...nextStep,
      };
    }
    return {
      kind: "email",
      state: "ready",
      label: UX_STATUS_LABEL.ready,
      title: "Emails prêts",
      description: "L’envoi d’emails est actif.",
    };
  } catch {
    return {
      kind: "email",
      state: "unavailable",
      label: UX_STATUS_LABEL.unavailable,
      title: copy.title,
      description:
        "On n’a pas pu vérifier l’envoi d’emails pour le moment. Réessaie plus tard.",
      ...nextStep,
    };
  }
}

function probeWhatsApp(): ConfigChannelStatus {
  const copy = UX_COPY.missingConfigWhatsapp;
  /** Pas d’onboarding Meta prestataire : CTA = démarrage / Stripe, pas une fausse UI WhatsApp. */
  const nextStep = {
    href: "/app/demarrage",
    actionLabel: copy.actionLabel ?? "Continuer le démarrage",
  } as const;

  try {
    const env = loadWhatsAppEnv();
    if (!isWhatsAppProviderEnabled(env)) {
      return {
        kind: "whatsapp",
        state: "missing",
        label: UX_STATUS_LABEL.missing,
        title: copy.title,
        description: copy.description,
        ...nextStep,
      };
    }
    if (env.mode === "stub") {
      return {
        kind: "whatsapp",
        state: "partial",
        label: UX_STATUS_LABEL.partial,
        title: "WhatsApp en mode essai",
        description:
          "WhatsApp est simulé ici. En production, le canal Sidian est activé par l’équipe. Pas d’onboarding à faire dans Paramètres.",
        ...nextStep,
      };
    }
    return {
      kind: "whatsapp",
      state: "ready",
      label: UX_STATUS_LABEL.ready,
      title: "WhatsApp prêt",
      description: "Le canal WhatsApp est actif.",
    };
  } catch {
    return {
      kind: "whatsapp",
      state: "unavailable",
      label: UX_STATUS_LABEL.unavailable,
      title: copy.title,
      description:
        "On n’a pas pu vérifier WhatsApp pour le moment. Réessaie plus tard.",
      ...nextStep,
    };
  }
}

function probeStripe(readiness: PrestataireStripeReadiness): ConfigChannelStatus {
  const copy = UX_COPY.missingConfigStripe;
  const ready =
    readiness.configured &&
    readiness.chargesEnabled &&
    readiness.onboardingStatus === "paiements_actives" &&
    readiness.sepaDebitPaymentsStatus === "active";

  if (ready) {
    return {
      kind: "stripe",
      state: "ready",
      label: UX_STATUS_LABEL.ready,
      title: "Encaissement prêt",
      description: "Carte et prélèvement bancaire sont actifs pour tes paiements.",
      href: "/app/connexion-stripe",
      actionLabel: "Voir Stripe",
    };
  }

  if (readiness.configured) {
    return {
      kind: "stripe",
      state: "partial",
      label: UX_STATUS_LABEL.partial,
      title: "Stripe à finaliser",
      description:
        "La configuration a commencé. Continue sur Stripe pour rendre tes liens partageables.",
      href: "/app/connexion-stripe",
      actionLabel: copy.actionLabel,
    };
  }

  return {
    kind: "stripe",
    state: "missing",
    label: UX_STATUS_LABEL.missing,
    title: copy.title,
    description: copy.description,
    href: "/app/connexion-stripe",
    actionLabel: copy.actionLabel,
  };
}

function probeAutoDebitCeiling(): ConfigChannelStatus {
  const copy = UX_COPY.autoDebitCeilingNotValidated;
  if (AUTO_DEBIT_REGLE_CEILING_PRODUCT_READY) {
    return {
      kind: "auto_debit_ceiling",
      state: "ready",
      label: UX_STATUS_LABEL.ready,
      title: "Plafond de prélèvement auto validé",
      description: "Les prélèvements automatiques respectent ton plafond.",
    };
  }

  return {
    kind: "auto_debit_ceiling",
    state: "blocked",
    label: UX_STATUS_LABEL.blocked,
    title: copy.title,
    description: copy.description,
  };
}

/**
 * Projection UX des configs réelles — aucun secret, aucune invention.
 * Email / WhatsApp = env plateforme ; Stripe = readiness prestataire ;
 * plafond auto-débit = flag produit existant.
 */
export async function getWorkspaceConfigStatus(
  supabase: SupabaseClient<Db>,
  prestataireId: string,
): Promise<WorkspaceConfigStatus> {
  let stripe: PrestataireStripeReadiness;
  try {
    stripe = await getPrestataireStripeReadiness(supabase, prestataireId);
  } catch {
    stripe = {
      configured: false,
      chargesEnabled: false,
      onboardingStatus: null,
      sepaDebitPaymentsStatus: "inactive",
    };
  }

  const channels: ConfigChannelStatus[] = [
    probeEmail(),
    probeWhatsApp(),
    probeStripe(stripe),
    probeAutoDebitCeiling(),
  ];

  const hasBlockingGap = channels.some(
    (channel) =>
      channel.state === "missing" ||
      channel.state === "blocked" ||
      channel.state === "unavailable",
  );

  return { channels, hasBlockingGap };
}
