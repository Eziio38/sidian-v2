/**
 * G1-N — détection d’injections / instructions de contournement.
 * Signalisation domaine uniquement — ne crée jamais de confirmation.
 */

const BYPASS_CONFIRM_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(the\s+)?system\s+prompt/i,
  /oublie\s+(tes|les)\s+instructions/i,
  /sans\s+confirmation/i,
  /skip\s+confirmation/i,
  /confirm\s+automatically/i,
  /confirme\s+(automatiquement|sans\s+demander)/i,
  /explicit_confirmation\s*[:=]\s*true/i,
  /call\s+confirm[_-]agent[_-]protection[_-]draft/i,
  /bypass\s+(approval|confirmation|recap)/i,
];

const IDENTITY_INJECTION_PATTERNS = [
  /\btenant_id\s*[:=]/i,
  /\bactor_id\s*[:=]/i,
  /\bprestataire_id\s*[:=]/i,
  /\buser_id\s*[:=]/i,
  /"tenant_id"\s*:/i,
  /"actor_id"\s*:/i,
];

export type InjectionScanResult = {
  /** Instructions visant à contourner la confirmation explicite. */
  bypass_confirmation: boolean;
  /** Tentative d’imposer tenant/actor via le message. */
  identity_injection: boolean;
  /** Le message reste traitable (on ignore les instructions hostiles). */
  proceed: true;
};

/**
 * Scanne le message utilisateur. Ne bloque pas l’extraction métier :
 * les instructions hostiles sont ignorées ; tenant/actor restent hors modèle.
 */
export function scanUserMessageForInjection(text: string): InjectionScanResult {
  return {
    bypass_confirmation: BYPASS_CONFIRM_PATTERNS.some((re) => re.test(text)),
    identity_injection: IDENTITY_INJECTION_PATTERNS.some((re) => re.test(text)),
    proceed: true,
  };
}

/**
 * Nettoie les fragments d’injection évidents avant envoi au provider
 * (réduit la surface ; la validation post-LLM reste obligatoire).
 */
export function sanitizeMessageForProvider(text: string): string {
  let out = text;
  for (const re of IDENTITY_INJECTION_PATTERNS) {
    out = out.replace(re, "[redacted_identity_key]=");
  }
  return out.slice(0, 8_000);
}
