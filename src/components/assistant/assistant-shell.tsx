"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { AssistantSidebar } from "./assistant-sidebar";

type AssistantShellProps = {
  userDisplayName: string;
  children: ReactNode;
};

function subscribeLg(onStoreChange: () => void) {
  if (typeof window.matchMedia !== "function") {
    return () => {};
  }
  const media = window.matchMedia("(min-width: 1024px)");
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function getLgSnapshot() {
  if (typeof window.matchMedia !== "function") {
    return true;
  }
  return window.matchMedia("(min-width: 1024px)").matches;
}

function getLgServerSnapshot() {
  return true;
}

export function AssistantShell({
  userDisplayName,
  children,
}: AssistantShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navButtonRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const wasMobileNavOpen = useRef(false);
  const isLg = useSyncExternalStore(
    subscribeLg,
    getLgSnapshot,
    getLgServerSnapshot,
  );

  const closeMobileNav = useCallback(() => {
    setMobileNavOpen(false);
  }, []);

  const openMobileNav = useCallback(() => {
    if (!isLg) {
      setMobileNavOpen(true);
    }
  }, [isLg]);

  // Dérivé : pas de setState dans un effect au resize desktop.
  const isMobileDrawerOpen = !isLg && mobileNavOpen;

  useEffect(() => {
    if (wasMobileNavOpen.current && !isMobileDrawerOpen) {
      navButtonRef.current?.focus();
    }
    wasMobileNavOpen.current = isMobileDrawerOpen;
  }, [isMobileDrawerOpen]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    if (isMobileDrawerOpen) {
      main.setAttribute("inert", "");
    } else {
      main.removeAttribute("inert");
    }
  }, [isMobileDrawerOpen]);

  useEffect(() => {
    if (!isMobileDrawerOpen) return;

    const { body, documentElement } = document;
    const previousBodyOverflow = body.style.overflow;
    const previousHtmlOverflow = documentElement.style.overflow;
    const previousBodyTouchAction = body.style.touchAction;

    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";
    body.style.touchAction = "none";

    return () => {
      body.style.overflow = previousBodyOverflow;
      documentElement.style.overflow = previousHtmlOverflow;
      body.style.touchAction = previousBodyTouchAction;
    };
  }, [isMobileDrawerOpen]);

  return (
    <div
      data-testid="assistant-shell"
      data-mobile-nav={isMobileDrawerOpen ? "open" : "closed"}
      className="flex h-dvh max-h-dvh overflow-hidden bg-assistant-bg text-assistant-text"
    >
      <AssistantSidebar
        userDisplayName={userDisplayName}
        mobileOpen={isMobileDrawerOpen}
        onCloseMobile={closeMobileNav}
      />

      <div
        ref={mainRef}
        data-testid="assistant-main"
        className={`relative flex min-w-0 flex-1 flex-col bg-assistant-bg ${
          isMobileDrawerOpen ? "pointer-events-none" : ""
        }`}
        aria-hidden={isMobileDrawerOpen ? true : undefined}
      >
        <a
          href="#assistant-discussion"
          className="sr-only z-50 rounded-lg bg-assistant-composer px-4 py-2 text-sm font-semibold text-assistant-text focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:outline focus:outline-2 focus:outline-sidian-blue"
        >
          Aller à la discussion
        </a>

        <button
          ref={navButtonRef}
          type="button"
          data-testid="assistant-mobile-nav"
          aria-label="Ouvrir la navigation"
          aria-expanded={isMobileDrawerOpen}
          aria-controls="assistant-sidebar"
          aria-hidden={isMobileDrawerOpen ? true : undefined}
          tabIndex={isMobileDrawerOpen ? -1 : undefined}
          onClick={openMobileNav}
          className={`group absolute z-10 inline-flex h-11 w-11 items-center justify-center rounded-full text-assistant-muted transition-[color,opacity,transform] duration-150 ease-out hover:text-assistant-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue motion-safe:duration-[140ms] motion-reduce:transition-none lg:hidden ${
            isMobileDrawerOpen
              ? "pointer-events-none scale-[0.96] opacity-0"
              : "pointer-events-auto scale-100 opacity-100"
          }`}
          style={{
            top: "max(1rem, env(safe-area-inset-top, 0px))",
            left: "max(1rem, env(safe-area-inset-left, 0px))",
          }}
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
