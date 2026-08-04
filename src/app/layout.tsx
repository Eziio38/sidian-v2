import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

import { setThemePreferenceAction } from "@/app/actions/theme";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { resolveTheme } from "@/lib/theme/theme";
import { THEME_INIT_SCRIPT } from "@/lib/theme/theme-script";
import { readThemePreferenceCookie } from "@/lib/theme/theme-server";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  // 800 retirée : `--font-weight-extrabold` et `font-extrabold` ne sont
  // consommés nulle part. Une graisse déclarée est un fichier de police
  // téléchargé — autant ne pas payer pour ce qui ne sert pas.
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Sidian V2",
  description: "Suivi des règlements B2B et communication client assistée.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const preference = await readThemePreferenceCookie();

  // Le serveur ne peut pas connaître le réglage OS : `system` est rendu en
  // clair — le thème de référence — puis corrigé par THEME_INIT_SCRIPT avant
  // la première peinture. `suppressHydrationWarning` couvre exactement cet
  // écart volontaire entre l'attribut rendu et l'attribut corrigé.
  const serverResolved = resolveTheme(preference, false);

  return (
    <html
      lang="fr"
      data-theme={serverResolved}
      data-theme-preference={preference}
      className={`${outfit.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/*
         * Script anti-flash. Doit rester synchrone et en tête : il s'exécute
         * avant toute peinture.
         *
         * THEME_INIT_SCRIPT est une constante littérale du dépôt : aucune
         * donnée utilisateur, de requête ou de base n'y est interpolée. Il est
         * passé en enfant texte plutôt que via dangerouslySetInnerHTML, donc
         * aucune capacité d'injection n'est ouverte ici.
         */}
        <script>{THEME_INIT_SCRIPT}</script>
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <ThemeProvider
          initialPreference={preference}
          onPersist={setThemePreferenceAction}
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
