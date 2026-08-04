/**
 * Préférence d'apparence — logique pure, partagée serveur et client.
 *
 * Trois préférences : `light`, `dark`, `system`.
 * Deux thèmes effectivement rendus : `light`, `dark`.
 *
 * `light` est le thème de référence et le défaut d'un nouveau compte.
 * `system` suit `prefers-color-scheme` et n'est jamais un défaut.
 *
 * Ce module ne doit dépendre ni de React, ni de `next/*`, ni de `server-only` :
 * il est importé par le script anti-flash, par le provider client, par les
 * server actions et par les tests.
 */

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** Thème réellement appliqué au document. `system` est toujours résolu avant rendu. */
export type ResolvedTheme = "light" | "dark";

/** Défaut produit : le thème clair est la référence. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "light";

/**
 * Cookie de repli lu avant l'authentification et par le script anti-flash.
 * Non sensible : il ne contient qu'une préférence d'affichage.
 * `SameSite=Lax` et non `HttpOnly` — le script inline doit pouvoir le lire
 * avant la première peinture, sans attendre React.
 */
export const THEME_COOKIE_NAME = "sidian-theme";

export const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Attribut porté par `<html>`. Toujours ciblé via `:root[data-theme=…]`. */
export const THEME_ATTRIBUTE = "data-theme";

/** Attribut de diagnostic : la préférence brute, avant résolution de `system`. */
export const THEME_PREFERENCE_ATTRIBUTE = "data-theme-preference";

export const PREFERS_DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Écrans publics d'authentification.
 *
 * Un visiteur qui n'a jamais exprimé de préférence n'a pas encore de compte :
 * sur ces écrans on suit son réglage système plutôt que d'imposer le clair.
 * Dès qu'une préférence existe (cookie ou compte), elle prime.
 *
 * Les pages `/p/*` ne figurent pas ici : elles sont épinglées en clair par
 * leur layout, quel que soit le contexte.
 */
export const OS_FOLLOWING_PUBLIC_PATHS = [
  "/connexion",
  "/inscription",
  "/mot-de-passe-oublie",
  "/reinitialiser-mot-de-passe",
] as const;

export function shouldFollowSystemWithoutPreference(pathname: string): boolean {
  return OS_FOLLOWING_PUBLIC_PATHS.some(
    (base) => pathname === base || pathname.startsWith(`${base}/`),
  );
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === "string" &&
    (THEME_PREFERENCES as readonly string[]).includes(value)
  );
}

/** Normalise une valeur d'origine externe (cookie, base, formulaire). */
export function parseThemePreference(
  value: unknown,
  fallback: ThemePreference = DEFAULT_THEME_PREFERENCE,
): ThemePreference {
  return isThemePreference(value) ? value : fallback;
}

/** Résout la préférence en thème concret. `system` dépend du réglage OS. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export const THEME_PREFERENCE_LABELS: Record<ThemePreference, string> = {
  light: "Clair",
  dark: "Sombre",
  system: "Automatique",
};

export const THEME_PREFERENCE_DESCRIPTIONS: Record<ThemePreference, string> = {
  light: "L’apparence de référence de Sidian.",
  dark: "Confortable en faible luminosité.",
  system: "Suit le réglage de ton appareil.",
};
