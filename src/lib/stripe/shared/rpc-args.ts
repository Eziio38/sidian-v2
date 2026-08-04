/**
 * Nullabilité des paramètres de RPC Supabase.
 *
 * PostgreSQL n'a pas de notion de paramètre `NOT NULL` : une fonction déclarée
 * `p_payment_intent_id text` accepte parfaitement NULL. Le générateur de types
 * Supabase ne peut donc pas déduire la nullabilité des arguments et les émet
 * tous comme non-nullables (`p_payment_intent_id: string`).
 *
 * Or plusieurs champs Stripe sont légitimement absents : une session de
 * checkout sans `payment_intent`, une tentative dont le moyen de paiement n'est
 * pas encore connu. Les passer en NULL est le comportement voulu, et le SQL les
 * traite explicitement (`coalesce`, `is null`).
 *
 * Ce type rétablit la nullabilité au seul endroit où l'imprécision se
 * manifeste — la frontière d'appel — sans altérer le comportement ni masquer
 * une vraie erreur : un argument absent reste absent, un argument mal typé
 * reste une erreur de compilation.
 */
export type NullableRpcArgs<Args> = {
  [Key in keyof Args]: Args[Key] | null;
};
