import { EmailError } from "../errors";
import type { EmailLocale, EmailTemplateKey } from "../types";
import {
  assertSafeHttpsUrl,
  escapeHtml,
  sanitizePlainText,
} from "./escape";

export type ReminderBeforeDueVariables = {
  prestataireName: string;
  clientName: string;
  amountLabel: string;
  dueDateLabel: string;
  paymentLinkUrl?: string;
};

export type ReminderAfterDueVariables = {
  prestataireName: string;
  clientName: string;
  amountLabel: string;
  dueDateLabel: string;
  paymentLinkUrl: string;
};

export type PaymentReceivedVariables = {
  prestataireName: string;
  clientName: string;
  amountLabel: string;
  paidAtLabel: string;
};

export type PaymentFailedVariables = {
  prestataireName: string;
  clientName: string;
  amountLabel: string;
  updateMethodUrl?: string;
};

export type UpdatePaymentMethodVariables = {
  prestataireName: string;
  clientName: string;
  updateMethodUrl: string;
};

export type CancellationNoticeVariables = {
  prestataireName: string;
  clientName: string;
  amountLabel: string;
  cancelledAtLabel: string;
};

export type PartialPaymentNoticeVariables = {
  prestataireName: string;
  clientName: string;
  amountPaidLabel: string;
  amountRemainingLabel: string;
  dueDateLabel: string;
  paymentLinkUrl?: string;
};

export type GuideInternalNoticeVariables = {
  noticeTitle: string;
  noticeBody: string;
  relatedRefLabel?: string;
};

export type TemplateVariablesByKey = {
  reminder_before_due: ReminderBeforeDueVariables;
  reminder_after_due: ReminderAfterDueVariables;
  payment_received: PaymentReceivedVariables;
  payment_failed: PaymentFailedVariables;
  update_payment_method: UpdatePaymentMethodVariables;
  cancellation_notice: CancellationNoticeVariables;
  partial_payment_notice: PartialPaymentNoticeVariables;
  guide_internal_notice: GuideInternalNoticeVariables;
};

export type RenderedEmailTemplate = {
  subject: string;
  text: string;
  html: string;
};

type TemplateDefinition<K extends EmailTemplateKey> = {
  key: K;
  locales: readonly EmailLocale[];
  requiredVariables: readonly (keyof TemplateVariablesByKey[K])[];
  render: (
    locale: EmailLocale,
    variables: TemplateVariablesByKey[K],
  ) => RenderedEmailTemplate;
};

function requireText(label: string, value: string, max = 200): string {
  const cleaned = sanitizePlainText(value);
  if (!cleaned) {
    throw new EmailError("email_template_variable_invalid", label);
  }
  if (cleaned.length > max) {
    throw new EmailError("email_template_variable_invalid", `${label}_too_long`);
  }
  return cleaned;
}

function optionalUrl(label: string, value: string | undefined): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  try {
    return assertSafeHttpsUrl(label, value);
  } catch {
    throw new EmailError("email_url_rejected", label);
  }
}

function requireUrl(label: string, value: string): string {
  const url = optionalUrl(label, value);
  if (!url) {
    throw new EmailError("email_url_rejected", label);
  }
  return url;
}

function layoutHtml(params: {
  title: string;
  paragraphs: string[];
  ctaUrl?: string;
  ctaLabel?: string;
}): string {
  const paragraphs = params.paragraphs
    .map((p) => `<p style="margin:0 0 16px;line-height:1.5;color:#1a1a1a;">${escapeHtml(p)}</p>`)
    .join("");
  const cta =
    params.ctaUrl && params.ctaLabel
      ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(params.ctaUrl)}" style="color:#0f766e;text-decoration:underline;">${escapeHtml(params.ctaLabel)}</a></p>`
      : "";
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(params.title)}</title></head><body style="margin:0;padding:24px;font-family:Georgia,serif;background:#fafafa;"><div style="max-width:560px;margin:0 auto;padding:24px;background:#ffffff;">${paragraphs}${cta}</div></body></html>`;
}

function layoutText(params: {
  paragraphs: string[];
  ctaUrl?: string;
  ctaLabel?: string;
}): string {
  const lines = [...params.paragraphs];
  if (params.ctaUrl && params.ctaLabel) {
    lines.push(`${params.ctaLabel} : ${params.ctaUrl}`);
  }
  return lines.join("\n\n");
}

const REMINDER_BEFORE_DUE: TemplateDefinition<"reminder_before_due"> = {
  key: "reminder_before_due",
  locales: ["fr"],
  requiredVariables: [
    "prestataireName",
    "clientName",
    "amountLabel",
    "dueDateLabel",
  ],
  render(_locale, variables) {
    const prestataireName = requireText(
      "prestataireName",
      variables.prestataireName,
    );
    const clientName = requireText("clientName", variables.clientName);
    const amountLabel = requireText("amountLabel", variables.amountLabel, 64);
    const dueDateLabel = requireText("dueDateLabel", variables.dueDateLabel, 64);
    const paymentLinkUrl = optionalUrl(
      "paymentLinkUrl",
      variables.paymentLinkUrl,
    );

    const subject = `Rappel — paiement de ${amountLabel} avant le ${dueDateLabel}`;
    const paragraphs = [
      `Bonjour ${clientName},`,
      `Je m'occupe du suivi des paiements pour ${prestataireName}.`,
      `Ceci est un rappel informatif : un paiement de ${amountLabel} est prévu pour le ${dueDateLabel}.`,
      `Aucune action n'est demandée si tout est en ordre.`,
    ];

    return {
      subject,
      text: layoutText({
        paragraphs,
        ctaUrl: paymentLinkUrl,
        ctaLabel: paymentLinkUrl ? "Lien de paiement" : undefined,
      }),
      html: layoutHtml({
        title: subject,
        paragraphs,
        ctaUrl: paymentLinkUrl,
        ctaLabel: paymentLinkUrl ? "Accéder au lien de paiement" : undefined,
      }),
    };
  },
};

const REMINDER_AFTER_DUE: TemplateDefinition<"reminder_after_due"> = {
  key: "reminder_after_due",
  locales: ["fr"],
  requiredVariables: [
    "prestataireName",
    "clientName",
    "amountLabel",
    "dueDateLabel",
    "paymentLinkUrl",
  ],
  render(_locale, variables) {
    const prestataireName = requireText(
      "prestataireName",
      variables.prestataireName,
    );
    const clientName = requireText("clientName", variables.clientName);
    const amountLabel = requireText("amountLabel", variables.amountLabel, 64);
    const dueDateLabel = requireText("dueDateLabel", variables.dueDateLabel, 64);
    const paymentLinkUrl = requireUrl(
      "paymentLinkUrl",
      variables.paymentLinkUrl,
    );

    const subject = `Paiement de ${amountLabel} — échéance du ${dueDateLabel}`;
    const paragraphs = [
      `Bonjour ${clientName},`,
      `Je m'occupe du suivi des paiements pour ${prestataireName}.`,
      `L'échéance du ${dueDateLabel} pour un paiement de ${amountLabel} est passée. Voici le lien pour régulariser lorsque vous le pourrez.`,
    ];

    return {
      subject,
      text: layoutText({
        paragraphs,
        ctaUrl: paymentLinkUrl,
        ctaLabel: "Lien de paiement",
      }),
      html: layoutHtml({
        title: subject,
        paragraphs,
        ctaUrl: paymentLinkUrl,
        ctaLabel: "Régler le paiement",
      }),
    };
  },
};

const PAYMENT_RECEIVED: TemplateDefinition<"payment_received"> = {
  key: "payment_received",
  locales: ["fr"],
  requiredVariables: [
    "prestataireName",
    "clientName",
    "amountLabel",
    "paidAtLabel",
  ],
  render(_locale, variables) {
    const prestataireName = requireText(
      "prestataireName",
      variables.prestataireName,
    );
    const clientName = requireText("clientName", variables.clientName);
    const amountLabel = requireText("amountLabel", variables.amountLabel, 64);
    const paidAtLabel = requireText("paidAtLabel", variables.paidAtLabel, 64);

    const subject = `Confirmation — paiement de ${amountLabel} reçu`;
    const paragraphs = [
      `Bonjour ${clientName},`,
      `Le paiement de ${amountLabel} pour ${prestataireName} a bien été reçu le ${paidAtLabel}.`,
      `Merci.`,
    ];

    return {
      subject,
      text: layoutText({ paragraphs }),
      html: layoutHtml({ title: subject, paragraphs }),
    };
  },
};

const PAYMENT_FAILED: TemplateDefinition<"payment_failed"> = {
  key: "payment_failed",
  locales: ["fr"],
  requiredVariables: ["prestataireName", "clientName", "amountLabel"],
  render(_locale, variables) {
    const prestataireName = requireText(
      "prestataireName",
      variables.prestataireName,
    );
    const clientName = requireText("clientName", variables.clientName);
    const amountLabel = requireText("amountLabel", variables.amountLabel, 64);
    const updateMethodUrl = optionalUrl(
      "updateMethodUrl",
      variables.updateMethodUrl,
    );

    const subject = `Échec de paiement — ${amountLabel}`;
    const paragraphs = [
      `Bonjour ${clientName},`,
      `La tentative de paiement de ${amountLabel} pour ${prestataireName} n'a pas abouti.`,
      `Vous pouvez mettre à jour votre moyen de paiement si besoin.`,
    ];

    return {
      subject,
      text: layoutText({
        paragraphs,
        ctaUrl: updateMethodUrl,
        ctaLabel: updateMethodUrl
          ? "Mettre à jour le moyen de paiement"
          : undefined,
      }),
      html: layoutHtml({
        title: subject,
        paragraphs,
        ctaUrl: updateMethodUrl,
        ctaLabel: updateMethodUrl
          ? "Mettre à jour le moyen de paiement"
          : undefined,
      }),
    };
  },
};

const UPDATE_PAYMENT_METHOD: TemplateDefinition<"update_payment_method"> = {
  key: "update_payment_method",
  locales: ["fr"],
  requiredVariables: ["prestataireName", "clientName", "updateMethodUrl"],
  render(_locale, variables) {
    const prestataireName = requireText(
      "prestataireName",
      variables.prestataireName,
    );
    const clientName = requireText("clientName", variables.clientName);
    const updateMethodUrl = requireUrl(
      "updateMethodUrl",
      variables.updateMethodUrl,
    );

    const subject = `Mise à jour du moyen de paiement — ${prestataireName}`;
    const paragraphs = [
      `Bonjour ${clientName},`,
      `Pour continuer les règlements auprès de ${prestataireName}, merci de mettre à jour votre moyen de paiement via le lien sécurisé ci-dessous.`,
    ];

    return {
      subject,
      text: layoutText({
        paragraphs,
        ctaUrl: updateMethodUrl,
        ctaLabel: "Mettre à jour le moyen de paiement",
      }),
      html: layoutHtml({
        title: subject,
        paragraphs,
        ctaUrl: updateMethodUrl,
        ctaLabel: "Mettre à jour le moyen de paiement",
      }),
    };
  },
};

const CANCELLATION_NOTICE: TemplateDefinition<"cancellation_notice"> = {
  key: "cancellation_notice",
  locales: ["fr"],
  requiredVariables: [
    "prestataireName",
    "clientName",
    "amountLabel",
    "cancelledAtLabel",
  ],
  render(_locale, variables) {
    const prestataireName = requireText(
      "prestataireName",
      variables.prestataireName,
    );
    const clientName = requireText("clientName", variables.clientName);
    const amountLabel = requireText("amountLabel", variables.amountLabel, 64);
    const cancelledAtLabel = requireText(
      "cancelledAtLabel",
      variables.cancelledAtLabel,
      64,
    );

    const subject = `Annulation — paiement de ${amountLabel}`;
    const paragraphs = [
      `Bonjour ${clientName},`,
      `Le paiement de ${amountLabel} auprès de ${prestataireName} a été annulé le ${cancelledAtLabel}.`,
      `Aucune autre action n'est requise de votre part pour ce paiement.`,
    ];

    return {
      subject,
      text: layoutText({ paragraphs }),
      html: layoutHtml({ title: subject, paragraphs }),
    };
  },
};

const PARTIAL_PAYMENT_NOTICE: TemplateDefinition<"partial_payment_notice"> = {
  key: "partial_payment_notice",
  locales: ["fr"],
  requiredVariables: [
    "prestataireName",
    "clientName",
    "amountPaidLabel",
    "amountRemainingLabel",
    "dueDateLabel",
  ],
  render(_locale, variables) {
    const prestataireName = requireText(
      "prestataireName",
      variables.prestataireName,
    );
    const clientName = requireText("clientName", variables.clientName);
    const amountPaidLabel = requireText(
      "amountPaidLabel",
      variables.amountPaidLabel,
      64,
    );
    const amountRemainingLabel = requireText(
      "amountRemainingLabel",
      variables.amountRemainingLabel,
      64,
    );
    const dueDateLabel = requireText("dueDateLabel", variables.dueDateLabel, 64);
    const paymentLinkUrl = optionalUrl(
      "paymentLinkUrl",
      variables.paymentLinkUrl,
    );

    const subject = `Paiement partiel reçu — reste ${amountRemainingLabel}`;
    const paragraphs = [
      `Bonjour ${clientName},`,
      `Un règlement partiel de ${amountPaidLabel} a été enregistré pour ${prestataireName}.`,
      `Il reste ${amountRemainingLabel} à régler (échéance indiquée : ${dueDateLabel}).`,
    ];

    return {
      subject,
      text: layoutText({
        paragraphs,
        ctaUrl: paymentLinkUrl,
        ctaLabel: paymentLinkUrl ? "Lien de paiement" : undefined,
      }),
      html: layoutHtml({
        title: subject,
        paragraphs,
        ctaUrl: paymentLinkUrl,
        ctaLabel: paymentLinkUrl ? "Régler le solde" : undefined,
      }),
    };
  },
};

const GUIDE_INTERNAL_NOTICE: TemplateDefinition<"guide_internal_notice"> = {
  key: "guide_internal_notice",
  locales: ["fr"],
  requiredVariables: ["noticeTitle", "noticeBody"],
  render(_locale, variables) {
    const noticeTitle = requireText("noticeTitle", variables.noticeTitle, 120);
    const noticeBody = requireText("noticeBody", variables.noticeBody, 4000);
    const relatedRefLabel = variables.relatedRefLabel
      ? requireText("relatedRefLabel", variables.relatedRefLabel, 120)
      : undefined;

    const subject = `[Sidian] ${noticeTitle}`;
    const paragraphs = [
      noticeBody,
      ...(relatedRefLabel ? [`Référence : ${relatedRefLabel}`] : []),
    ];

    return {
      subject,
      text: layoutText({ paragraphs }),
      html: layoutHtml({ title: subject, paragraphs }),
    };
  },
};

const REGISTRY = {
  reminder_before_due: REMINDER_BEFORE_DUE,
  reminder_after_due: REMINDER_AFTER_DUE,
  payment_received: PAYMENT_RECEIVED,
  payment_failed: PAYMENT_FAILED,
  update_payment_method: UPDATE_PAYMENT_METHOD,
  cancellation_notice: CANCELLATION_NOTICE,
  partial_payment_notice: PARTIAL_PAYMENT_NOTICE,
  guide_internal_notice: GUIDE_INTERNAL_NOTICE,
} as const;

export function renderEmailTemplate<K extends EmailTemplateKey>(params: {
  templateKey: K;
  locale: EmailLocale;
  variables: TemplateVariablesByKey[K];
}): RenderedEmailTemplate {
  const definition = REGISTRY[params.templateKey] as unknown as TemplateDefinition<K>;
  if (!definition) {
    throw new EmailError("email_template_unknown", params.templateKey);
  }
  if (!definition.locales.includes(params.locale)) {
    throw new EmailError(
      "email_template_locale_unsupported",
      params.locale,
    );
  }
  for (const key of definition.requiredVariables) {
    const value = (params.variables as Record<string, unknown>)[
      key as string
    ];
    if (value === undefined || value === null) {
      throw new EmailError(
        "email_template_variable_missing",
        String(key),
      );
    }
  }
  return definition.render(params.locale, params.variables);
}
