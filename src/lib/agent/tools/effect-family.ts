/**
 * Familles d’effet contrôlées (une seule par définition d’outil).
 * Allowlist stricte — les familles de décision métier sont rejetées structurellement.
 */

export const EFFECT_FAMILIES = [
  "read_invoice",
  "create_payment_attempt",
  "generate_notification_draft",
] as const;

export type EffectFamily = (typeof EFFECT_FAMILIES)[number];

/** Familles explicitement interdites (décision / arbitrage métier). */
export const FORBIDDEN_EFFECT_FAMILIES = [
  "decide",
  "approve",
  "arbitrate",
  "grant_refund",
  "modify_permission",
  "modify_rule",
] as const;

export type ForbiddenEffectFamily = (typeof FORBIDDEN_EFFECT_FAMILIES)[number];

export function isAllowedEffectFamily(value: string): value is EffectFamily {
  return (EFFECT_FAMILIES as readonly string[]).includes(value);
}

export function isForbiddenEffectFamily(value: string): boolean {
  return (FORBIDDEN_EFFECT_FAMILIES as readonly string[]).includes(value);
}
