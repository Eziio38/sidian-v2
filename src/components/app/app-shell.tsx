import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";

const NAV = [
  { href: "/app", label: "Accueil" },
  { href: "/app/clients", label: "Clients" },
  { href: "/app/paiements-a-recevoir", label: "Paiements à recevoir" },
] as const;

type AppShellProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
};

export function AppShell({
  title,
  description,
  children,
  actions,
}: AppShellProps) {
  return (
    <div className="min-h-full bg-gris-50">
      <header className="border-b border-gris-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="text-sm font-semibold tracking-tight text-sidian-blue">
              Sidian
            </p>
            <nav className="mt-2 flex flex-wrap gap-3 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-gris-500 transition-colors hover:text-nuit"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="max-w-xs">
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-nuit">
              {title}
            </h1>
            {description ? (
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gris-500">
                {description}
              </p>
            ) : null}
          </div>
          {actions}
        </div>
        <div className="mt-8">{children}</div>
      </main>
    </div>
  );
}
