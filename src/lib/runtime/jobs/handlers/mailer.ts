/**
 * Adaptateur entre les handlers de relance et le canal email existant.
 *
 * Le port `RelanceMailer` ne connaît ni Resend ni Supabase : il expose un état
 * de disponibilité et un enfilement idempotent. Cet adaptateur le branche sur
 * `createEmailChannel`, qui rend le gabarit et persiste l'intention.
 */

import { createEmailChannel } from "../../../email/channel";
import type { EmailEnv } from "../../../email/env";
import type { EmailOutboxRepository } from "../../../email/outbox/repository";
import type { RelanceMailer, RelanceMailerStatus } from "../types";

/** Codes d'indisponibilité du canal — repris tels quels dans `last_error_code`. */
export const RELANCE_MAILER_ERROR_CODES = {
  providerDisabled: "email_provider_disabled",
  configInvalid: "email_config_invalid",
} as const;

/**
 * Un fournisseur désactivé n'est pas un fournisseur silencieux.
 *
 * On n'enfile rien dans l'outbox dans ce cas : le drain email construit en mode
 * `disabled` refuse d'insérer, et les lignes qui y échapperaient resteraient
 * `queued` indéfiniment — une file jamais drainée que rien ne distingue d'un
 * envoi en cours. Le job échoue donc visiblement plutôt que d'être acquitté.
 */
export function resolveRelanceMailerStatus(env: EmailEnv): RelanceMailerStatus {
  if (!env.enabled || env.mode === "disabled") {
    return {
      available: false,
      errorCode: RELANCE_MAILER_ERROR_CODES.providerDisabled,
    };
  }
  return { available: true };
}

export function createRelanceMailer(deps: {
  env: EmailEnv;
  outbox: EmailOutboxRepository;
}): RelanceMailer {
  const status = resolveRelanceMailerStatus(deps.env);
  const channel = createEmailChannel({ outbox: deps.outbox, env: deps.env });

  return {
    status: () => status,
    async enqueue(request) {
      if (!status.available) {
        throw new Error(`relance_mailer_unavailable:${status.errorCode}`);
      }
      const record = await channel.enqueue({
        tenantId: request.tenantId,
        templateKey: request.templateKey,
        locale: "fr",
        recipient: request.recipient,
        variables: request.variables,
        relatedEntityType: "creance",
        relatedEntityId: request.relatedEntityId,
        idempotencyKey: request.idempotencyKey,
      });
      return { outboxId: record.id };
    },
  };
}

/** Canal indisponible — refuse tout envoi et le dit. */
export function createUnavailableRelanceMailer(
  errorCode: string,
): RelanceMailer {
  return {
    status: () => ({ available: false, errorCode }),
    async enqueue() {
      throw new Error(`relance_mailer_unavailable:${errorCode}`);
    },
  };
}
