/**
 * G1-Q — clés d'action internes (source d'autorité).
 * Jamais de libellé Meta ni d'id Graph dans le domaine métier.
 */

export const COMMUNICATION_ACTION_KEYS = [
  "payment_received_yes",
  "payment_received_no",
  "payment_received_partial",
  "payment_received_checking",
] as const;

export type CommunicationActionKey =
  (typeof COMMUNICATION_ACTION_KEYS)[number];

export function isCommunicationActionKey(
  value: string,
): value is CommunicationActionKey {
  return (COMMUNICATION_ACTION_KEYS as readonly string[]).includes(value);
}

/** IDs externes Meta (list rows G1-P) → clés internes. Fail closed. */
export const META_LIST_ROW_TO_ACTION: Readonly<
  Record<string, CommunicationActionKey>
> = {
  gpc_0: "payment_received_yes",
  gpc_1: "payment_received_no",
  gpc_2: "payment_received_partial",
  gpc_3: "payment_received_checking",
};

export function mapProviderActionIdToKey(
  providerActionId: string,
): CommunicationActionKey | null {
  const key = META_LIST_ROW_TO_ACTION[providerActionId];
  return key ?? null;
}
