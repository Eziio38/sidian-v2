/**
 * Reconnaît un message libre qui reprend une action rapide de l’empty state
 * (ex. « Vérifier les paiements » ≈ « Faire le point sur mes paiements »).
 */

export type WelcomeQuickAction = {
  id: string;
  label: string;
  action: string;
  emphasis: "default" | "primary";
};

const ACTIONS: WelcomeQuickAction[] = [
  {
    id: "create-protection",
    label: "Protéger une facture",
    action: "create_protection",
    emphasis: "default",
  },
  {
    id: "add-invoice",
    label: "Analyser un document",
    action: "add_invoice",
    emphasis: "default",
  },
  {
    id: "create-client",
    label: "Ajouter un client",
    action: "create_client",
    emphasis: "default",
  },
  {
    id: "view-expected",
    label: "Faire le point sur mes paiements",
    action: "view_expected_payments",
    emphasis: "default",
  },
];

/** Alias normalisés (sans accents, minuscules) → action id. */
const ALIASES: Record<string, string> = {
  "proteger une facture": "create_protection",
  "creer une protection": "create_protection",
  "nouvelle protection": "create_protection",
  "faire le point sur mes paiements": "view_expected_payments",
  "consulter les paiements": "view_expected_payments",
  "voir les paiements": "view_expected_payments",
  "verifier les paiements": "view_expected_payments",
  "voir mes paiements": "view_expected_payments",
  "ajouter un client": "create_client",
  "creer un client": "create_client",
  "nouveau client": "create_client",
  "analyser un document": "add_invoice",
  "importer un document": "add_invoice",
  "importer une facture": "add_invoice",
  "ajouter une facture": "add_invoice",
  "import facture": "add_invoice",
};

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

function normalizeQuickActionText(text: string): string {
  let value = stripDiacritics(text).toLocaleLowerCase("fr").trim();
  value = value.replace(/[?!.,;:…]+/g, " ");
  value = value.replace(/\s+/g, " ").trim();
  value = value.replace(
    /^(je\s+veux|je\s+voudrais|peux-tu|pourrais-tu|svp)\s+/u,
    "",
  );
  value = value.replace(/\s+(s['']il\s+te\s+plait|stp|please)$/u, "");
  return value.trim();
}

/**
 * Match strict sur phrases courtes d’intention — ne capture pas
 * « Nouveau client X, facture de 350… » (trop long / trop de contenu).
 */
export function matchWelcomeQuickAction(
  text: string,
): WelcomeQuickAction | null {
  const source = text.trim();
  // « Faire le point sur mes paiements » = 34 caractères ; marge pour variantes.
  if (!source || source.length > 56) return null;

  const normalized = normalizeQuickActionText(source);
  if (!normalized) return null;

  const action = ALIASES[normalized];
  if (!action) return null;

  return ACTIONS.find((item) => item.action === action) ?? null;
}
