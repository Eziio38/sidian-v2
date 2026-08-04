export const COMMUNICATION_TEMPLATE_KEYS = [
  "guide_payment_confirmation",
] as const;

export type CommunicationTemplateKey =
  (typeof COMMUNICATION_TEMPLATE_KEYS)[number];

export type TemplateLocale = "fr";

export type GuidePaymentConfirmationVariables = {
  amountLabel: string;
  clientName: string;
};

export type TemplateVariablesByKey = {
  guide_payment_confirmation: GuidePaymentConfirmationVariables;
};

export type ResolvedWhatsAppTemplate = {
  externalName: string;
  languageCode: string;
  bodyParameters: string[];
  /** Boutons quick-reply (titres). */
  buttonTitles: string[];
};

type TemplateDefinition<K extends CommunicationTemplateKey> = {
  key: K;
  locales: readonly TemplateLocale[];
  requiredVariables: readonly (keyof TemplateVariablesByKey[K])[];
  map: (
    locale: TemplateLocale,
    variables: TemplateVariablesByKey[K],
  ) => ResolvedWhatsAppTemplate;
};

function assertNonEmpty(label: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`template_variable_empty:${label}`);
  }
  return trimmed;
}

const GUIDE_PAYMENT_CONFIRMATION: TemplateDefinition<"guide_payment_confirmation"> =
  {
    key: "guide_payment_confirmation",
    locales: ["fr"],
    requiredVariables: ["amountLabel", "clientName"],
    map(locale, variables) {
      if (locale !== "fr") {
        throw new Error("template_locale_unsupported");
      }
      const amountLabel = assertNonEmpty(
        "amountLabel",
        variables.amountLabel,
      );
      const clientName = assertNonEmpty("clientName", variables.clientName);
      return {
        externalName: "guide_payment_confirmation",
        languageCode: "fr",
        bodyParameters: [amountLabel, clientName],
        buttonTitles: ["Oui", "Non", "Paiement partiel", "Je vérifie"],
      };
    },
  };

const REGISTRY = {
  guide_payment_confirmation: GUIDE_PAYMENT_CONFIRMATION,
} as const;

export function isCommunicationTemplateKey(
  value: string,
): value is CommunicationTemplateKey {
  return (COMMUNICATION_TEMPLATE_KEYS as readonly string[]).includes(value);
}

export function resolveCommunicationTemplate<
  K extends CommunicationTemplateKey,
>(params: {
  templateKey: K;
  locale: TemplateLocale;
  variables: TemplateVariablesByKey[K];
}): ResolvedWhatsAppTemplate {
  const definition = REGISTRY[params.templateKey];
  if (!definition) {
    throw new Error("template_unknown");
  }
  if (!definition.locales.includes(params.locale)) {
    throw new Error("template_locale_unsupported");
  }
  for (const key of definition.requiredVariables) {
    if (
      params.variables[key] === undefined ||
      params.variables[key] === null
    ) {
      throw new Error(`template_variable_missing:${String(key)}`);
    }
  }
  return definition.map(params.locale, params.variables);
}

/**
 * Construit le body Graph à partir d'un template résolu.
 * Liste interactive (4 choix) — les boutons Meta sont limités à 3.
 *
 * Ne jamais inclure `to` (wa_id / E.164) : injecté au send depuis la config
 * adaptateur, hors snapshot persisté lisible via RLS.
 */
export function buildGraphTemplateBody(params: {
  toTechnicalId: string;
  template: ResolvedWhatsAppTemplate;
}): Record<string, unknown> {
  void params.toTechnicalId;
  return {
    messaging_product: "whatsapp",
    type: "interactive",
    interactive: {
      type: "list",
      body: {
        text: `As-tu reçu le règlement de ${params.template.bodyParameters[0]} de ${params.template.bodyParameters[1]} ?`,
      },
      action: {
        button: "Répondre",
        sections: [
          {
            title: "Confirmation",
            rows: params.template.buttonTitles.map((title, index) => ({
              id: `gpc_${index}`,
              title: title.slice(0, 24),
            })),
          },
        ],
      },
    },
  };
}

/** Injecte le destinataire technique au moment de l'envoi uniquement. */
export function withGraphRecipient(
  graphBody: Record<string, unknown>,
  toTechnicalId: string,
): Record<string, unknown> {
  return { ...graphBody, to: toTechnicalId };
}
