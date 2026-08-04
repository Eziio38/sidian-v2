import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  OS_FOLLOWING_PUBLIC_PATHS,
  parseThemePreference,
  resolveTheme,
  shouldFollowSystemWithoutPreference,
  THEME_PREFERENCES,
} from "./theme";
import { THEME_INIT_SCRIPT } from "./theme-script";

describe("préférence d’apparence", () => {
  it("le défaut produit est le thème clair", () => {
    // Exigence explicite : un nouveau compte démarre en clair, jamais en auto.
    expect(DEFAULT_THEME_PREFERENCE).toBe("light");
  });

  it("expose exactement trois préférences", () => {
    expect(THEME_PREFERENCES).toEqual(["light", "dark", "system"]);
  });

  it("reconnaît les préférences valides et rejette le reste", () => {
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("auto")).toBe(false);
    expect(isThemePreference("")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
    expect(isThemePreference(0)).toBe(false);
    expect(isThemePreference({ toString: () => "dark" })).toBe(false);
  });

  it("retombe sur le clair pour une valeur de cookie corrompue", () => {
    expect(parseThemePreference("<script>")).toBe("light");
    expect(parseThemePreference("DARK")).toBe("light");
    expect(parseThemePreference(undefined)).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
  });

  it("résout system selon le réglage OS et ignore l’OS sinon", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    // Un choix explicite n'est jamais écrasé par le système.
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("écrans publics suivant l’OS", () => {
  it("couvre les quatre parcours d’authentification", () => {
    for (const path of OS_FOLLOWING_PUBLIC_PATHS) {
      expect(shouldFollowSystemWithoutPreference(path)).toBe(true);
    }
    expect(shouldFollowSystemWithoutPreference("/connexion/etape-2")).toBe(true);
  });

  it("n’englobe ni les pages de paiement public ni l’application", () => {
    // /p/* est épinglé en clair par son layout : il ne doit jamais suivre l'OS.
    expect(shouldFollowSystemWithoutPreference("/p/abc123")).toBe(false);
    expect(shouldFollowSystemWithoutPreference("/app/parametres")).toBe(false);
    expect(shouldFollowSystemWithoutPreference("/")).toBe(false);
    // Pas de correspondance par simple préfixe de chaîne.
    expect(shouldFollowSystemWithoutPreference("/connexion-stripe")).toBe(false);
  });
});

/**
 * Le script anti-flash est une chaîne littérale du dépôt, exécutée telle
 * quelle par le navigateur avant la première peinture. On l'évalue ici dans un
 * contexte isolé (`node:vm`) avec des doublures de `document` et `window` :
 * c'est le seul moyen de vérifier son comportement réel plutôt que sa forme.
 * L'entrée est une constante de compilation — aucune donnée externe n'est
 * évaluée.
 */
function runInitScript(
  cookie: string,
  pathname: string,
  prefersDark: boolean,
): Record<string, string> {
  const attributes: Record<string, string> = {};
  const sandbox = {
    document: {
      documentElement: {
        setAttribute(name: string, value: string) {
          attributes[name] = value;
        },
      },
      cookie,
    },
    window: {
      matchMedia: () => ({ matches: prefersDark }),
    },
    location: { pathname },
  };
  runInNewContext(THEME_INIT_SCRIPT, sandbox);
  return attributes;
}

describe("script anti-flash", () => {
  it("ne contient aucune séquence capable de fermer la balise script", () => {
    expect(THEME_INIT_SCRIPT).not.toMatch(/<\/script/i);
    expect(THEME_INIT_SCRIPT).not.toContain("<!--");
  });

  it("applique la préférence enregistrée", () => {
    expect(runInitScript("sidian-theme=dark", "/app/clients", false)).toEqual({
      "data-theme": "dark",
      "data-theme-preference": "dark",
    });
    // Un choix explicite n'est pas écrasé par un OS en sombre.
    expect(
      runInitScript("sidian-theme=light", "/app/clients", true)["data-theme"],
    ).toBe("light");
  });

  it("résout « Automatique » selon le réglage OS", () => {
    expect(
      runInitScript("sidian-theme=system", "/app/clients", true)["data-theme"],
    ).toBe("dark");
    expect(
      runInitScript("sidian-theme=system", "/app/clients", false)["data-theme"],
    ).toBe("light");
    // La préférence brute reste distincte du thème résolu.
    expect(
      runInitScript("sidian-theme=system", "/app", true)[
        "data-theme-preference"
      ],
    ).toBe("system");
  });

  it("sans cookie : clair dans l’application, OS sur les écrans d’authentification", () => {
    expect(runInitScript("", "/app/clients", true)["data-theme"]).toBe("light");
    expect(runInitScript("", "/connexion", true)["data-theme"]).toBe("dark");
    expect(runInitScript("", "/connexion", false)["data-theme"]).toBe("light");
    expect(runInitScript("", "/inscription", true)["data-theme"]).toBe("dark");
  });

  it("isole le cookie de thème des autres cookies", () => {
    expect(
      runInitScript("sb-access-token=xyz; sidian-theme=dark; autre=1", "/app", false)[
        "data-theme"
      ],
    ).toBe("dark");
    // Un cookie dont le nom se termine par le nôtre ne doit pas être capté.
    expect(
      runInitScript("faux-sidian-theme=dark", "/app/clients", false)[
        "data-theme"
      ],
    ).toBe("light");
  });

  it("retombe sur le clair sans jamais lever, même sur une valeur invalide", () => {
    expect(
      runInitScript("sidian-theme=neon", "/app/clients", true)["data-theme"],
    ).toBe("light");
    // `decodeURIComponent` lève sur un pourcentage tronqué : le catch couvre.
    expect(() => runInitScript("sidian-theme=%E0%A4%A", "/app", true)).not.toThrow();
    expect(runInitScript("sidian-theme=%E0%A4%A", "/app", true)["data-theme"]).toBe(
      "light",
    );
  });
});
