import type { ReactNode } from "react";
import Link from "next/link";

type AuthShellProps = {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthShell({ title, description, children, footer }: AuthShellProps) {
  return (
    <div className="flex min-h-full flex-col bg-gris-50">
      <main className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight text-nuit focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
            >
              <span
                aria-hidden
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-sidian-blue text-sm font-bold text-white"
              >
                S
              </span>
              Sidian
            </Link>
          </div>

          <div className="rounded-2xl border border-gris-200 bg-white p-6 shadow-sm sm:p-8">
            <header className="mb-6 space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-nuit">
                {title}
              </h1>
              {description ? (
                <p className="text-sm leading-relaxed text-gris-500">
                  {description}
                </p>
              ) : null}
            </header>

            {children}
          </div>

          {footer ? (
            <div className="mt-6 text-center text-sm text-gris-500">{footer}</div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
