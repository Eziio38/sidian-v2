"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { AssistantSidebar } from "./assistant-sidebar";

type AssistantShellProps = {
  userDisplayName: string;
  children: ReactNode;
};

export function AssistantShell({
  userDisplayName,
  children,
}: AssistantShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navButtonRef = useRef<HTMLButtonElement>(null);
  const wasMobileNavOpen = useRef(false);

  const closeMobileNav = useCallback(() => {
    setMobileNavOpen(false);
  }, []);

  useEffect(() => {
    if (wasMobileNavOpen.current && !mobileNavOpen) {
      navButtonRef.current?.focus();
    }
    wasMobileNavOpen.current = mobileNavOpen;
  }, [mobileNavOpen]);

  return (
    <div
      data-testid="assistant-shell"
      className="flex h-dvh max-h-dvh overflow-hidden bg-assistant-bg text-assistant-text"
    >
      <AssistantSidebar
        userDisplayName={userDisplayName}
        mobileOpen={mobileNavOpen}
        onCloseMobile={closeMobileNav}
      />

      <div className="relative flex min-w-0 flex-1 flex-col bg-assistant-bg">
        <button
          ref={navButtonRef}
          type="button"
          data-testid="assistant-mobile-nav"
          aria-label="Ouvrir la navigation"
          aria-expanded="false"
          aria-controls="assistant-sidebar"
          aria-hidden={mobileNavOpen ? true : undefined}
          tabIndex={mobileNavOpen ? -1 : undefined}
          onClick={() => setMobileNavOpen(true)}
          className={`group absolute left-4 top-4 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full text-assistant-muted transition-[color,opacity,transform] duration-150 ease-out hover:text-assistant-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue motion-safe:duration-[140ms] lg:hidden ${
            mobileNavOpen
              ? "pointer-events-none scale-[0.96] opacity-0"
              : "pointer-events-auto scale-100 opacity-100"
          }`}
        >
          <span
            aria-hidden
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.05] transition-colors duration-150 ease-out group-hover:bg-white/[0.08] group-active:bg-white/[0.1]"
          >
            <MenuHamburgerIcon />
          </span>
          <span
            role="tooltip"
            className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-assistant-composer px-2 py-1 text-[11px] text-assistant-text opacity-0 shadow-[0_4px_12px_rgba(0,0,0,0.35)] transition-opacity duration-150 [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:group-focus-visible:opacity-100"
          >
            Ouvrir la navigation
          </span>
        </button>
        <div className="min-h-0 min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

/** Menu hamburger fin — ouvrir la navigation. */
function MenuHamburgerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 7h14M5 12h14M5 17h14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
