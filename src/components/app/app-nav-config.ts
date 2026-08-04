/**
 * Navigation produit unique — Premium AI Workspace.
 * Une seule source pour AppShell / sidebar / drawer.
 */

export type AppNavItem = {
  id: string;
  href: string;
  label: string;
  /** Match path for aria-current (defaults to href). */
  match?: (pathname: string) => boolean;
};

export const APP_NAV: readonly AppNavItem[] = [
  {
    id: "aujourdhui",
    href: "/app/assistant",
    label: "Accueil",
    match: (pathname) =>
      pathname === "/app/assistant" ||
      pathname.startsWith("/app/assistant/") ||
      pathname.startsWith("/dev/assistant"),
  },
  {
    id: "protections",
    href: "/app/paiements-a-recevoir",
    label: "Dossiers",
    match: (pathname) =>
      pathname === "/app/paiements-a-recevoir" ||
      pathname.startsWith("/app/paiements-a-recevoir/"),
  },
  {
    id: "paiements",
    href: "/app/paiements",
    label: "Paiements",
    match: (pathname) =>
      pathname === "/app/paiements" || pathname.startsWith("/app/paiements/"),
  },
  {
    id: "clients",
    href: "/app/clients",
    label: "Clients",
  },
  {
    id: "activite",
    href: "/app/activite",
    label: "Activité",
    match: (pathname) =>
      pathname === "/app/activite" || pathname.startsWith("/app/activite/"),
  },
] as const;

/** Libellés / destinations héritées — ne doivent plus apparaître dans la nav. */
export const LEGACY_NAV_LABELS = [
  "Dashboard",
  "Tableau de bord",
  "Bien démarrer",
  "Assistant",
  "Agent Sidian",
  "Paiements à recevoir",
  "Connexion Stripe",
  "Approbations",
  "Historique",
  "Aujourd’hui",
  "Protections",
  "Paramètres",
] as const;

export function isAppNavCurrent(
  pathname: string,
  item: AppNavItem,
): boolean {
  if (item.match) return item.match(pathname);
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
