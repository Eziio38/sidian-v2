/**
 * G1-M — fixtures / constantes.
 */

export const TENANT_A = "11111111-1111-4111-8111-111111111111";
export const TENANT_B = "22222222-2222-4222-8222-222222222222";
export const ACTOR_A = "user_actor_a";
export const ACTOR_B = "user_actor_b";

export const NOW = "2026-07-25T12:00:00.000Z";
/** Dans la fenêtre TTL (24h) — pas à la borne exacte. */
export const LATER = "2026-07-25T18:00:00.000Z";
/** Strictement après expires_at (= NOW + 24h). */
export const EXPIRED = "2026-07-26T12:00:01.000Z";

export const EXAMPLE_MESSAGE =
  "Je dois recevoir 2 400 € de Dupont Conseil le 12 septembre 2026. Le contact est jean@dupont.fr.";

export { createMemoryProtectionDraftRepository } from "./memory-repository";
