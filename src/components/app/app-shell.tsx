import { AppNavigation } from "@/components/app/app-navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";

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
    <div className="min-h-dvh bg-gris-50 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <a
        href="#contenu-principal"
        className="sr-only z-50 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-nuit focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:outline focus:outline-2 focus:outline-sidian-blue"
      >
        Aller au contenu principal
      </a>

      <aside className="hidden min-h-dvh border-r border-gris-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <div className="px-5 py-6">
          <p className="text-lg font-semibold tracking-tight text-nuit">Sidian</p>
          <p className="mt-1 text-xs text-gris-500">Suivi des règlements</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3">
          <AppNavigation />
        </div>
        <div className="border-t border-gris-100 p-4">
          <SignOutButton />
        </div>
      </aside>

      <div className="min-w-0">
        <header className="border-b border-gris-200 bg-white lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <p className="font-semibold tracking-tight text-nuit">Sidian</p>
            <div className="w-36">
              <SignOutButton />
            </div>
          </div>
          <div className="overflow-x-auto px-3 pb-3">
            <AppNavigation compact />
          </div>
        </header>

        <main
          id="contenu-principal"
          className="mx-auto w-full max-w-[90rem] px-4 py-8 sm:px-6 lg:px-8 lg:py-10"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-balance text-3xl font-semibold tracking-[-0.03em] text-nuit">
                {title}
              </h1>
              {description ? (
                <p className="mt-2 max-w-[70ch] text-pretty text-sm leading-relaxed text-gris-500">
                  {description}
                </p>
              ) : null}
            </div>
            {actions ? <div className="shrink-0">{actions}</div> : null}
          </div>
          <div className="mt-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
