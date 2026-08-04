/**
 * Catalogue des notifications réglables — module PUR (aucune I/O, testable).
 *
 * ## La règle de ce fichier
 *
 * Un événement n'entre ici QUE si un job du runtime l'émet réellement. Le
 * réglage d'un événement qui ne part jamais serait un interrupteur décoratif :
 * l'utilisateur croirait couper quelque chose qui, de toute façon, n'existe
 * pas.
 *
 * `EMAIL_TEMPLATE_KEYS` déclare huit gabarits. Deux seulement sont émis :
 *
 *  - `reminder_before_due` : job `prevention_notice`, fenêtre J-5 de
 *    `WORKFLOW_POLICY.prevention` (src/lib/runtime/jobs/handlers/relance.ts) ;
 *  - `payment_failed` : job `retry_failed_notify`, avec
 *    `WORKFLOW_POLICY.retries.policy = "none"` — on notifie l'échec, on ne
 *    rejoue jamais un prélèvement.
 *
 * Les six autres sont recensés dans `NON_EMITTED_EMAIL_TEMPLATES` avec la
 * raison exacte. Ce n'est pas de la documentation d'agrément : un test compare
 * l'union des deux listes à `EMAIL_TEMPLATE_KEYS`, si bien que l'ajout d'un
 * gabarit oblige à trancher explicitement « émis » ou « non émis ».
 *
 * Les deux emails partent au CLIENT PAYEUR, jamais au prestataire : aucun
 * gabarit n'est aujourd'hui adressé au prestataire lui-même. La copie
 * d'interface doit le dire, sans quoi l'utilisateur croira régler sa propre
 * boîte de réception.
 */

import { EMAIL_TEMPLATE_KEYS, type EmailTemplateKey } from "@/lib/email/types";
import type { WorkflowJobKind } from "@/lib/runtime/workflow-policy";

/** Champ applicatif ↔ colonne SQL, pour un événement réglable. */
export type NotificationPreferenceField =
  | "reminderBeforeDue"
  | "paymentFailed";

export type NotificationEvent = {
  readonly templateKey: EmailTemplateKey;
  readonly field: NotificationPreferenceField;
  /** Colonne de `public.notification_preference`. */
  readonly column: "email_reminder_before_due" | "email_payment_failed";
  /** Job runtime qui émet réellement ce gabarit. */
  readonly emittedBy: WorkflowJobKind;
  readonly label: string;
  readonly description: string;
};

export const NOTIFICATION_EVENTS: readonly NotificationEvent[] = [
  {
    templateKey: "reminder_before_due",
    field: "reminderBeforeDue",
    column: "email_reminder_before_due",
    emittedBy: "prevention_notice",
    label: "Rappel avant échéance",
    description:
      "Un email à ton client 5 jours avant la date d’échéance. Informatif : il n’y a rien à faire si tout est en ordre.",
  },
  {
    templateKey: "payment_failed",
    field: "paymentFailed",
    column: "email_payment_failed",
    emittedBy: "retry_failed_notify",
    label: "Avis d’échec de paiement",
    description:
      "Un email à ton client quand une tentative de paiement n’aboutit pas. Sidian ne relance jamais le prélèvement tout seul.",
  },
] as const;

/**
 * Gabarits déclarés mais jamais émis — avec la raison, en clair.
 * Aucun ne doit apparaître dans l'interface tant que la raison tient.
 */
export const NON_EMITTED_EMAIL_TEMPLATES: Readonly<
  Record<string, string>
> = {
  reminder_after_due:
    "Le gabarit exige une URL de lien de paiement ; runtime_load_job_context la renvoie toujours à null (payment_link ne conserve que l’empreinte du jeton). Le handler échoue avant tout envoi.",
  payment_received: "Aucun appelant dans le runtime.",
  update_payment_method: "Aucun appelant dans le runtime.",
  cancellation_notice: "Aucun appelant dans le runtime.",
  partial_payment_notice: "Aucun appelant dans le runtime.",
  guide_internal_notice:
    "Aucun appelant dans le runtime ; la confirmation Guide passe par WhatsApp, pas par l’email.",
} as const;

export type NotificationPreferences = Record<
  NotificationPreferenceField,
  boolean
>;

/**
 * Défauts = comportement actuel du runtime, donc tout est autorisé.
 * Un défaut « désactivé » couperait les relances des comptes existants sans
 * qu'aucune décision produit ne l'ait demandé.
 */
export const NOTIFICATION_PREFERENCE_DEFAULTS: NotificationPreferences = {
  reminderBeforeDue: true,
  paymentFailed: true,
};

/** Ligne telle que renvoyée par PostgREST / la RPC. */
export type NotificationPreferenceRow = {
  email_reminder_before_due: boolean;
  email_payment_failed: boolean;
};

/** Absence de ligne ⇒ défauts. Le compte n'a simplement jamais réglé. */
export function toNotificationPreferences(
  row: NotificationPreferenceRow | null | undefined,
): NotificationPreferences {
  if (!row) return { ...NOTIFICATION_PREFERENCE_DEFAULTS };
  return {
    reminderBeforeDue: row.email_reminder_before_due,
    paymentFailed: row.email_payment_failed,
  };
}

/** Lecture d'un `FormData` de cases à cocher : absent ⇒ décoché. */
export function readNotificationPreferencesFromFormData(
  formData: Pick<FormData, "get">,
): NotificationPreferences {
  const read = (field: NotificationPreferenceField) => {
    const event = NOTIFICATION_EVENTS.find((item) => item.field === field);
    return formData.get(event ? event.field : field) !== null;
  };

  return {
    reminderBeforeDue: read("reminderBeforeDue"),
    paymentFailed: read("paymentFailed"),
  };
}

/** Garde de cohérence : chaque gabarit déclaré est classé, une seule fois. */
export function auditEmailTemplateCoverage(): {
  missing: string[];
  duplicated: string[];
} {
  const emitted = NOTIFICATION_EVENTS.map((event) => event.templateKey);
  const nonEmitted = Object.keys(NON_EMITTED_EMAIL_TEMPLATES);
  const classified = [...emitted, ...nonEmitted];

  return {
    missing: EMAIL_TEMPLATE_KEYS.filter(
      (key) => !classified.includes(key),
    ) as string[],
    duplicated: classified.filter(
      (key, index) => classified.indexOf(key) !== index,
    ),
  };
}
