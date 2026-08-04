/**
 * Handlers de relance — la traduction des intentions des scanners en emails.
 *
 * Trois invariants gouvernent ce fichier :
 *
 * 1. **Aucun envoi simulé.** Si le canal email est désactivé ou mal configuré,
 *    le handler échoue avec un code explicite. Il n'enfile rien : une file que
 *    personne ne draine ressemble à un envoi en cours alors que rien ne
 *    partira jamais.
 *
 * 2. **Aucun message trompeur.** Si un gabarit ne peut pas dire la vérité —
 *    faute d'une variable obligatoire ou parce que sa copie ne correspond pas à
 *    l'intention du job — on préfère l'échec typé au message approximatif.
 *
 * 3. **Idempotence par construction.** La clé d'idempotence de l'email dérive
 *    de celle du `runtime_job`. Un rejeu (lease expiré, reprise après crash,
 *    backoff) retombe sur la même ligne d'outbox : jamais deux envois.
 *
 * La cadence n'est pas décidée ici : elle vient de `WORKFLOW_POLICY`
 * (prévention J-5, échéance J+0, silence après délai de grâce, retries « none »)
 * et les scanners l'ont déjà appliquée en amont.
 */

import { createHash } from "node:crypto";

import type { WorkflowJobKind } from "../../workflow-policy";
import type {
  RuntimeJobHandler,
  RuntimeJobHandlerContext,
  RuntimeJobHandlerResult,
} from "../dispatcher";
import type {
  ClaimedRuntimeJob,
  RelanceMailer,
  RuntimeJobContext,
} from "../types";
import { formatDateEcheanceLabel, formatMontantLabel } from "./format";

/** Codes d'échec des relances — stables, lisibles dans `runtime_job.last_error_code`. */
export const RELANCE_ERROR_CODES = {
  /** Le drain n'a fourni aucun canal email : câblage incomplet côté appelant. */
  mailerMissing: "email_channel_not_wired",
  /** La créance a disparu entre le scan et le traitement. */
  contextNotFound: "creance_context_not_found",
  /** Le job pointe une créance qui n'appartient pas à son prestataire. */
  tenantMismatch: "tenant_scope_mismatch",
  /** Client sans adresse exploitable : rien à relancer. */
  recipientMissing: "client_email_missing",
  /** Aucune URL de lien de paiement n'existe côté serveur (jeton non stocké). */
  paymentLinkUrlUnavailable: "payment_link_url_unavailable",
  /** Aucun gabarit ne sait exprimer une escalade sans travestir le message. */
  escalationTemplateUnavailable: "escalation_template_unavailable",
  /**
   * Le prestataire a désactivé cette notification dans Paramètres.
   * Ce n'est pas une panne : c'est le réglage qui s'applique.
   */
  notificationDisabled: "notification_disabled_by_preference",
} as const;

/**
 * Clé d'idempotence email dérivée du job.
 *
 * `runtime_job.idempotency_key` fait déjà 8 à 256 caractères ; le préfixe peut
 * donc dépasser la borne de l'outbox email. On replie alors sur une empreinte
 * stable plutôt que de tronquer — une troncature ferait collisionner deux
 * occurrences métier distinctes, donc perdre un envoi légitime.
 */
export function buildRelanceEmailIdempotencyKey(jobKey: string): string {
  const composed = `runtime_job:${jobKey}`;
  if (composed.length <= 256) return composed;
  return `runtime_job:sha256:${createHash("sha256")
    .update(jobKey)
    .digest("hex")}`;
}

type RelancePreflight =
  | { ok: true; mailer: RelanceMailer; context: RuntimeJobContext }
  | { ok: false; result: RuntimeJobHandlerResult };

function fail(errorCode: string): RuntimeJobHandlerResult {
  // Aucun de ces échecs ne se résout en réessayant à l'identique : les
  // remettre en file ne ferait que consommer des tentatives pour rien.
  return { status: "failed", errorCode, retryable: false };
}

/**
 * Contrôles communs à toutes les relances, dans l'ordre du moins coûteux au
 * plus coûteux : la porte d'honnêteté d'abord, la lecture base ensuite.
 */
async function preflight(
  job: ClaimedRuntimeJob,
  context: RuntimeJobHandlerContext,
  /**
   * Préférence de notification qui gouverne cet envoi. Absente pour les
   * relances qui n'en dépendent pas (escalade, lien d'échéance).
   */
  preference?: (loaded: RuntimeJobContext) => boolean,
): Promise<RelancePreflight> {
  const mailer = context.mailer;
  if (!mailer) {
    return { ok: false, result: fail(RELANCE_ERROR_CODES.mailerMissing) };
  }

  const status = mailer.status();
  if (!status.available) {
    // Fournisseur désactivé ou configuration invalide : le job reste
    // visiblement non délivré plutôt que faussement acquitté.
    return { ok: false, result: fail(status.errorCode) };
  }

  const loaded = await context.repository.loadJobContext({
    creanceId: job.creanceId,
  });
  if (!loaded) {
    return { ok: false, result: fail(RELANCE_ERROR_CODES.contextNotFound) };
  }

  if (loaded.prestataireId !== job.prestataireId) {
    // Le périmètre du contexte vient de la créance ; celui du job vient du
    // scanner. Une divergence signifie que le job désigne la créance d'un
    // autre prestataire : on n'écrit jamais l'adresse d'un tiers dans un
    // email attribué à un autre tenant.
    return { ok: false, result: fail(RELANCE_ERROR_CODES.tenantMismatch) };
  }

  if (preference && !preference(loaded)) {
    // Refus volontaire : non rejouable, sinon le job reviendrait à chaque
    // passage du cron pour être refusé à l'identique.
    return {
      ok: false,
      result: fail(RELANCE_ERROR_CODES.notificationDisabled),
    };
  }

  if (!loaded.clientEmail.trim()) {
    return { ok: false, result: fail(RELANCE_ERROR_CODES.recipientMissing) };
  }

  return { ok: true, mailer, context: loaded };
}

function recipientOf(context: RuntimeJobContext) {
  return { email: context.clientEmail, name: context.clientNom };
}

/**
 * prevention_notice → `reminder_before_due`.
 *
 * Le gabarit déclare `prestataireName`, `clientName`, `amountLabel`,
 * `dueDateLabel` comme obligatoires ; `paymentLinkUrl` y est facultatif. La
 * relance préventive part donc sans lien — ce qui correspond à sa copie :
 * « Aucune action n'est demandée si tout est en ordre. »
 */
export const preventionNoticeHandler: RuntimeJobHandler = async (
  job,
  context,
) => {
  const pre = await preflight(job, context, (c) => c.notifyReminderBeforeDue);
  if (!pre.ok) return pre.result;

  await pre.mailer.enqueue({
    tenantId: job.prestataireId,
    templateKey: "reminder_before_due",
    recipient: recipientOf(pre.context),
    variables: {
      prestataireName: pre.context.prestataireNom,
      clientName: pre.context.clientNom,
      amountLabel: formatMontantLabel(
        pre.context.montantCents,
        pre.context.devise,
      ),
      dueDateLabel: formatDateEcheanceLabel(pre.context.dateEcheance),
    },
    relatedEntityId: pre.context.creanceId,
    idempotencyKey: buildRelanceEmailIdempotencyKey(job.idempotencyKey),
  });

  return { status: "completed", detail: "reminder_before_due" };
};

/**
 * due_send_link → `reminder_after_due`.
 *
 * [BLOCAGE RÉEL, DOCUMENTÉ]
 * Ce gabarit exige `paymentLinkUrl`, et l'exige en https valide. Or l'URL d'un
 * lien de paiement déjà émis n'existe nulle part côté serveur :
 * `payment_link` ne conserve que `token_hash`, et le jeton brut n'est restitué
 * qu'une seule fois à la création (`open_payment_receivable`, action humaine).
 *
 * Deux issues étaient possibles : envoyer un message sans lien — ce que la
 * copie du gabarit interdit, puisqu'elle annonce « voici le lien pour
 * régulariser » — ou échouer explicitement. On échoue. Le scanner l'avait déjà
 * anticipé : « le worker aval refusera l'envoi » (eligibility.ts, 03 §7).
 *
 * Le déblocage n'est pas un câblage : il suppose une primitive serveur capable
 * d'émettre un lien partageable pour un worker `service_role`, décision produit
 * et sécurité qui n'appartient pas à ce handler.
 */
export const dueSendLinkHandler: RuntimeJobHandler = async (job, context) => {
  const pre = await preflight(job, context);
  if (!pre.ok) return pre.result;

  if (!pre.context.paymentLinkUrl) {
    return fail(RELANCE_ERROR_CODES.paymentLinkUrlUnavailable);
  }

  await pre.mailer.enqueue({
    tenantId: job.prestataireId,
    templateKey: "reminder_after_due",
    recipient: recipientOf(pre.context),
    variables: {
      prestataireName: pre.context.prestataireNom,
      clientName: pre.context.clientNom,
      amountLabel: formatMontantLabel(
        pre.context.montantCents,
        pre.context.devise,
      ),
      dueDateLabel: formatDateEcheanceLabel(pre.context.dateEcheance),
      paymentLinkUrl: pre.context.paymentLinkUrl,
    },
    relatedEntityId: pre.context.creanceId,
    idempotencyKey: buildRelanceEmailIdempotencyKey(job.idempotencyKey),
  });

  return { status: "completed", detail: "reminder_after_due" };
};

/**
 * silence_escalate → aucun envoi.
 *
 * [ARBITRAGE ASSUMÉ]
 * Le job porte `target_dossier_etat: ESCALADE_HUMAINE` : il signale que le
 * silence s'est prolongé au-delà du délai de grâce et qu'un humain doit
 * reprendre la main. Aucun des huit gabarits ne dit cela.
 *
 * `reminder_after_due` a été envisagé : sa copie est strictement celle de la
 * relance d'échéance (« l'échéance est passée, voici le lien »). L'envoyer ici
 * ferait passer une escalade pour une énième relance douce, et enverrait au
 * client un second message identique à celui du jour J. C'est exactement le
 * message trompeur que l'invariant 2 interdit. Il exigerait en outre la même
 * URL de lien introuvable que `due_send_link`.
 *
 * On échoue donc explicitement : l'escalade reste visible dans le backlog et
 * dans `last_error_code`, au lieu d'être maquillée en envoi réussi.
 */
export const silenceEscalateHandler: RuntimeJobHandler = async (
  job,
  context,
) => {
  const pre = await preflight(job, context);
  if (!pre.ok) return pre.result;
  return fail(RELANCE_ERROR_CODES.escalationTemplateUnavailable);
};

/**
 * retry_failed_notify → `payment_failed`.
 *
 * `retry_policy = none` : une tentative ÉCHOUÉE donne une notification, jamais
 * un rejeu Stripe. Le gabarit n'exige que `prestataireName`, `clientName` et
 * `amountLabel` ; `updateMethodUrl` est facultatif et reste omis, faute d'URL
 * de mise à jour restituable côté serveur.
 *
 * Le destinataire est le client payeur : la copie du gabarit lui est adressée
 * (« Bonjour {clientName}, la tentative de paiement … n'a pas abouti »).
 * L'avertissement côté prestataire évoqué par le payload du scanner
 * (`notify_prestataire_manual_link_fallback`) n'a pas de gabarit email dédié —
 * il relève de l'interface, pas de ce canal.
 */
export const retryFailedNotifyHandler: RuntimeJobHandler = async (
  job,
  context,
) => {
  const pre = await preflight(job, context, (c) => c.notifyPaymentFailed);
  if (!pre.ok) return pre.result;

  await pre.mailer.enqueue({
    tenantId: job.prestataireId,
    templateKey: "payment_failed",
    recipient: recipientOf(pre.context),
    variables: {
      prestataireName: pre.context.prestataireNom,
      clientName: pre.context.clientNom,
      amountLabel: formatMontantLabel(
        pre.context.montantCents,
        pre.context.devise,
      ),
    },
    relatedEntityId: pre.context.creanceId,
    idempotencyKey: buildRelanceEmailIdempotencyKey(job.idempotencyKey),
  });

  return { status: "completed", detail: "payment_failed" };
};

export const RELANCE_JOB_HANDLERS: Partial<
  Record<WorkflowJobKind, RuntimeJobHandler>
> = {
  prevention_notice: preventionNoticeHandler,
  due_send_link: dueSendLinkHandler,
  silence_escalate: silenceEscalateHandler,
  retry_failed_notify: retryFailedNotifyHandler,
};
