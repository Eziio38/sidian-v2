"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAVIGATION = [
  { href: "/app", label: "Dashboard" },
  { href: "/app/demarrage", label: "Bien démarrer" },
  { href: "/app/paiements-a-recevoir", label: "Paiements à recevoir" },
  { href: "/app/clients", label: "Clients" },
  { href: "/app/connexion-stripe", label: "Connexion Stripe" },
  { href: "/app/approbations", label: "Approbations" },
  { href: "/app/parametres", label: "Paramètres" },
] as const;

type AppNavigationProps = {
  compact?: boolean;
};

function isCurrentPath(pathname: string, href: string): boolean {
  if (href === "/app") {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNavigation({ compact = false }: AppNavigationProps) {
  const pathname = usePathname();

  return (
    <nav aria-label="Navigation principale">
      <ul
        className={compact ? "flex min-w-max items-center gap-1" : "flex flex-col gap-1"}
      >
        {NAVIGATION.map((item) => {
          const current = isCurrentPath(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-10 items-center rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue ${
                  current
                    ? "bg-blue-50 text-sidian-blue"
                    : "text-gris-500 hover:bg-gris-50 hover:text-nuit"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
