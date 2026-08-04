import type { ReactNode } from "react";

import { BrandLockup } from "@/components/brand/brand-lockup";

type AuthShellProps = {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthShell({ title, description, children, footer }: AuthShellProps) {
  return (
    <div className="relative flex min-h-full flex-col bg-gris-50">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-10%,color-mix(in_srgb,var(--sidian-brume)_70%,transparent),transparent_55%)]"
      />
      <main className="relative flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-md">
          <div className="mb-8 flex justify-center">
            <BrandLockup href="/" size="lg" priority />
          </div>

          {/*
            `bg-surface` et non `bg-white` : en sombre, une carte blanche
            conserverait un fond clair alors que le texte, lui, suit les tokens
            — le titre devenait illisible.
          */}
          <div className="rounded-2xl border border-gris-200 bg-surface p-6 shadow-card sm:p-8">
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
            <div
              data-testid="auth-footer"
              className="mt-6 text-center text-sm text-gris-500"
            >
              {footer}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
