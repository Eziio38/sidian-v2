import { SUGGESTION_CREATE_CLIENT } from "./message-suggestions";

export type KnownClient = {
  id?: string;
  name: string;
  email?: string;
  phone?: string;
};

/** Suggestions « Qui doit te payer ? » : données réelles, puis création explicite. */
export function buildClientPaymentSuggestions(
  knownClients: KnownClient[],
  options?: { maxKnown?: number },
): string[] {
  const maxKnown = options?.maxKnown ?? 4;
  const seen = new Set<string>();
  const names: string[] = [];

  for (const client of knownClients) {
    const name = client.name.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase("fr");
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= maxKnown) break;
  }

  return [...names, SUGGESTION_CREATE_CLIENT];
}

export function upsertKnownClient(
  current: KnownClient[],
  next: KnownClient,
): KnownClient[] {
  const name = next.name.trim();
  if (!name) return current;
  const key = name.toLocaleLowerCase("fr");
  const previous = current.find(
    (client) => client.name.trim().toLocaleLowerCase("fr") === key,
  );
  const without = current.filter(
    (client) => client.name.trim().toLocaleLowerCase("fr") !== key,
  );
  return [{ ...previous, ...next, name }, ...without];
}
