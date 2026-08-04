"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  DEFAULT_THEME_PREFERENCE,
  PREFERS_DARK_QUERY,
  resolveTheme,
  THEME_ATTRIBUTE,
  THEME_COOKIE_MAX_AGE_SECONDS,
  THEME_COOKIE_NAME,
  THEME_PREFERENCE_ATTRIBUTE,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme/theme";

type ThemeContextValue = {
  /** Préférence choisie par l'utilisateur (`system` inclus). */
  preference: ThemePreference;
  /** Thème réellement appliqué (`system` déjà résolu). */
  resolved: ResolvedTheme;
  /** Applique immédiatement, puis persiste (cookie + compte). */
  setPreference: (next: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function hasMatchMedia(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

/*
 * Le réglage OS est un état externe à React : `useSyncExternalStore` est le
 * primitif prévu pour ça. Il évite un `setState` dans un effet, et son
 * instantané serveur (`false` = clair) correspond exactement à ce que rend le
 * layout racine — donc aucune divergence d'hydratation.
 */
function subscribeToSystemTheme(onChange: () => void): () => void {
  if (!hasMatchMedia()) return () => {};
  const media = window.matchMedia(PREFERS_DARK_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getSystemPrefersDark(): boolean {
  if (!hasMatchMedia()) return false;
  return window.matchMedia(PREFERS_DARK_QUERY).matches;
}

function getServerSystemPrefersDark(): boolean {
  return false;
}

function applyToDocument(
  preference: ThemePreference,
  resolved: ResolvedTheme,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute(THEME_ATTRIBUTE, resolved);
  root.setAttribute(THEME_PREFERENCE_ATTRIBUTE, preference);
}

function writeCookie(preference: ThemePreference): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${THEME_COOKIE_NAME}=${encodeURIComponent(preference)}` +
    `; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export type ThemeProviderProps = {
  children: ReactNode;
  /**
   * Préférence connue du serveur au moment du rendu.
   * Pour un utilisateur authentifié, c'est la valeur enregistrée sur le compte.
   */
  initialPreference?: ThemePreference;
  /**
   * Persistance durable de la préférence sur le compte.
   * Sans session, seul le cookie local est écrit.
   */
  onPersist?: (preference: ThemePreference) => void | Promise<unknown>;
};

/**
 * Source de vérité client du thème.
 *
 * Le script anti-flash a déjà posé `data-theme` avant la première peinture ;
 * ce provider reprend la main pour les changements ultérieurs et pour le suivi
 * en direct du thème système lorsque la préférence est `system`.
 */
export function ThemeProvider({
  children,
  initialPreference = DEFAULT_THEME_PREFERENCE,
  onPersist,
}: ThemeProviderProps) {
  const [preference, setPreferenceState] =
    useState<ThemePreference>(initialPreference);

  // La préférence du compte change après une reconnexion : le serveur renvoie
  // alors une autre valeur initiale, qui doit gagner. Ajustement pendant le
  // rendu — le motif recommandé par React pour resynchroniser un état sur une
  // prop, sans effet ni rendu en cascade.
  const [lastInitialPreference, setLastInitialPreference] =
    useState<ThemePreference>(initialPreference);
  if (initialPreference !== lastInitialPreference) {
    setLastInitialPreference(initialPreference);
    setPreferenceState(initialPreference);
  }

  const prefersDark = useSyncExternalStore(
    subscribeToSystemTheme,
    getSystemPrefersDark,
    getServerSystemPrefersDark,
  );

  const resolved = useMemo(
    () => resolveTheme(preference, prefersDark),
    [preference, prefersDark],
  );

  // Synchronisation vers le DOM : c'est bien un système externe.
  useEffect(() => {
    applyToDocument(preference, resolved);
  }, [preference, resolved]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      // 1. Application immédiate : aucun aller-retour réseau perçu.
      setPreferenceState(next);
      applyToDocument(next, resolveTheme(next, getSystemPrefersDark()));
      // 2. Repli local, relu par le script anti-flash au prochain chargement.
      writeCookie(next);
      // 3. Persistance durable sur le compte, si une session existe.
      void onPersist?.(next);
    },
    [onPersist],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme doit être utilisé dans un ThemeProvider.");
  }
  return context;
}
