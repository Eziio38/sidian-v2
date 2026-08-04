const STOP_WORDS = new Set([
  "un",
  "une",
  "le",
  "la",
  "les",
  "des",
  "de",
  "du",
  "et",
  "ou",
  "à",
  "au",
  "aux",
  "en",
  "pour",
  "avec",
  "sur",
  "dans",
  "qui",
  "que",
  "se",
  "je",
  "j",
  "ai",
  "a",
  "est",
  "suis",
  "mon",
  "ma",
  "mes",
  "ton",
  "ta",
  "nouveau",
  "nouvelle",
  "nomme",
  "nommé",
  "facture",
  "date",
  "montant",
  "client",
  "protection",
  "créer",
  "creer",
  "veux",
  "voudrais",
]);

/** Aligné sur la contrainte serveur `assistant_conversation.title_custom`. */
export const CONVERSATION_TITLE_MAX_LENGTH = 80;

export function isMeaningfulLabel(value: string | undefined | null): boolean {
  if (!value) return false;
  const t = value.trim();
  return t.length > 0 && t !== "—" && t !== "À préciser";
}

/** Titre sidebar : nom client si connu, sinon mots-clés du premier message utile. */
export function deriveConversationTitle(params: {
  clientName?: string | null;
  messages: Array<{ role: string; content: string }>;
}): string {
  if (isMeaningfulLabel(params.clientName)) {
    return params.clientName!.trim();
  }

  const firstUser = params.messages.find(
    (message) =>
      message.role === "user" && message.content.trim().length > 0,
  );
  if (!firstUser) return "Nouvelle discussion";

  const keywords = firstUser.content
    .replace(/[^\p{L}\p{N}\s€-]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(
      (word) =>
        word.length > 2 &&
        !STOP_WORDS.has(word.toLocaleLowerCase("fr")) &&
        !/^\d+[.,]?\d*€?$/.test(word),
    );

  if (keywords.length > 0) {
    const title = keywords.slice(0, 4).join(" ");
    return title.charAt(0).toUpperCase() + title.slice(1);
  }

  const fallback = firstUser.content.trim().replace(/\s+/g, " ");
  return fallback.length > 42 ? `${fallback.slice(0, 42)}…` : fallback;
}

export function deriveConversationPreview(
  messages: Array<{ role: string; content: string }>,
): string | null {
  const last = [...messages]
    .reverse()
    .find((message) => message.content.trim().length > 0);
  if (!last) return null;
  const preview = last.content.trim().replace(/\s+/g, " ");
  return preview.length > 72 ? `${preview.slice(0, 72)}…` : preview;
}
