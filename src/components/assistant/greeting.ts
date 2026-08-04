/**
 * Prénom d’accueil assistant — jamais username ni local-part d’email.
 * Ordre : first_name → full_name / display_name → null (« Bonjour » seul).
 */

export type GreetingNameInput = {
  firstName?: string | null;
  fullName?: string | null;
  displayName?: string | null;
};

function looksLikeEmailOrLocalPart(value: string): boolean {
  if (value.includes("@")) return true;
  // Local-part typique collé sans espace (ex. jcurtato) — rejeté s’il est
  // fourni seul via un champ qui n’est pas un vrai prénom/nom.
  return false;
}

function firstToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (looksLikeEmailOrLocalPart(trimmed)) return null;
  const token = trimmed.split(/\s+/)[0]?.trim() ?? "";
  if (!token || token.includes("@")) return null;
  return token;
}

/**
 * Retourne le prénom à afficher, ou `null` pour un « Bonjour » sans nom.
 * N’accepte jamais un email ni sa local-part.
 */
export function resolveGreetingFirstName(
  input: GreetingNameInput,
): string | null {
  return (
    firstToken(input.firstName) ??
    firstToken(input.fullName) ??
    firstToken(input.displayName) ??
    null
  );
}

/** Libellé d’accueil complet. */
export function formatGreeting(firstName: string | null | undefined): string {
  const name = firstName?.trim();
  if (!name || name.includes("@")) return "Bonjour";
  return `Bonjour ${name}`;
}

/**
 * Nom affiché sidebar / profil — jamais email ni local-part.
 */
export function resolveDisplayName(input: {
  displayName?: string | null;
  fullName?: string | null;
  firstName?: string | null;
  fallback?: string;
}): string {
  const candidates = [
    input.displayName,
    input.fullName,
    input.firstName,
  ];
  for (const value of candidates) {
    if (!value) continue;
    const trimmed = value.trim();
    if (!trimmed || trimmed.includes("@")) continue;
    return trimmed;
  }
  return input.fallback?.trim() || "Profil";
}
