/**
 * Frontières de sécurité LLM (P0) — contraintes système, pas des prompts.
 *
 * Autorisé : conversation assistant, extraction/reformulation non financière,
 * texte d’assistance, génération sans effet financier irréversible automatique.
 *
 * Interdit : décider paiement reçu, choisir montant de débit, déclencher débit,
 * muter échéance / statut financier sans commande déterministe, contourner permissions.
 */

export const LLM_ALLOWED_PURPOSES = [
  /** Dialogue assistant (brouillon protection, guidance). */
  "assistant_conversation",
  /** Extraction structurée de champs brouillon — propositions uniquement. */
  "structured_extraction",
  /** Texte d’aide / reformulation non financière. */
  "assistance_text",
  /** Génération de texte sans effet automatique irréversible. */
  "text_generation",
] as const;

export type LlmAllowedPurpose = (typeof LLM_ALLOWED_PURPOSES)[number];

/**
 * Intentions explicitement interdites — refusées avant tout appel provider.
 * Ne jamais mapper une purpose autorisée vers ces banissements.
 */
export const LLM_FORBIDDEN_INTENTS = [
  "decide_payment_received",
  "choose_payment_amount",
  "trigger_debit",
  "mutate_due_date",
  "change_financial_status",
  "bypass_permissions",
  "call_financial_tool",
  "confirm_protection_draft",
  "send_client_communication",
] as const;

export type LlmForbiddenIntent = (typeof LLM_FORBIDDEN_INTENTS)[number];

/**
 * Noms d’outils / fonctions que le runtime refuse d’exposer au modèle.
 * Le provider live n’envoie jamais de `tools` ; cette liste sert de garde
 * défensive si un adaptateur tente d’en injecter.
 */
export const LLM_FORBIDDEN_TOOL_NAME_PATTERNS: readonly RegExp[] = [
  /^payment(\.|_|$)/i,
  /^debit/i,
  /^charge/i,
  /^stripe/i,
  /^prelevement/i,
  /^confirm[_-]?payment/i,
  /^mark[_-]?paid/i,
  /^settle/i,
  /^create[_-]?attempt/i,
  /^authorization\./i,
  /^creance\.(close|cancel|mark)/i,
  /^dossier\./i,
  /^protect(ion)?\.draft\.confirm/i,
  /^whatsapp\./i,
  /^sms\./i,
  /^email\.send/i,
];

export function isAllowedPurpose(value: string): value is LlmAllowedPurpose {
  return (LLM_ALLOWED_PURPOSES as readonly string[]).includes(value);
}

export function isForbiddenIntent(value: string): value is LlmForbiddenIntent {
  return (LLM_FORBIDDEN_INTENTS as readonly string[]).includes(value);
}

export function isForbiddenToolName(name: string): boolean {
  return LLM_FORBIDDEN_TOOL_NAME_PATTERNS.some((re) => re.test(name));
}

/**
 * Vérifie qu’aucun outil financier n’est exposé.
 * Retourne les noms refusés (liste vide = OK).
 */
export function findForbiddenToolNames(toolNames: readonly string[]): string[] {
  return toolNames.filter((name) => isForbiddenToolName(name));
}

/** Libellés stables pour documentation / traces (sans détail opérationnel). */
export const LLM_SAFETY_BOUNDARIES = {
  allowed: [
    "assistant_conversation",
    "structured_extraction (propositions brouillon uniquement)",
    "assistance_text",
    "text_generation without irreversible financial side-effect",
  ],
  banned: [
    "LLM decides payment received",
    "LLM chooses debit amount",
    "LLM triggers debit / Stripe charge",
    "LLM mutates due date or financial status without deterministic command",
    "LLM bypasses permissions / confirm / RPC",
    "LLM exposed financial tools",
  ],
  post_conditions: [
    "Domain schema validation required after structured output",
    "Tenant/actor never from model output",
    "Confirm / payment / communication only via deterministic tools",
  ],
} as const;
