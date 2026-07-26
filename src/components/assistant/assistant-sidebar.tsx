"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { BrandLockup } from "@/components/brand/brand-lockup";

/** Largeur fixe sidebar desktop / drawer mobile (14rem). */
export const ASSISTANT_SIDEBAR_WIDTH_CLASS = "w-56";

/** Nav produit assistant — pas d’entrée « Historique » vers démarrage. */
const ASSISTANT_NAV = [
  {
    href: "/app/assistant",
    label: "Assistant",
    primary: true,
    icon: <SparkIcon />,
  },
  {
    href: "/app/paiements-a-recevoir",
    label: "Paiements à recevoir",
    icon: <ShieldIcon />,
  },
  { href: "/app/clients", label: "Clients", icon: <PeopleIcon /> },
  { href: "/app", label: "Activité", icon: <ClockIcon /> },
  { href: "/app/parametres", label: "Paramètres", icon: <GearIcon /> },
] as const;

type AssistantSidebarProps = {
  userDisplayName: string;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
};

function isCurrentPath(pathname: string, href: string): boolean {
  if (href === "/app/assistant") {
    return (
      pathname === href ||
      pathname.startsWith(`${href}/`) ||
      pathname.startsWith("/dev/assistant")
    );
  }
  // Dashboard / activité : match exact uniquement (évite de marquer toute /app/*).
  if (href === "/app") {
    return pathname === "/app";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

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

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => {
    if (element.getAttribute("aria-hidden") === "true") return false;
    if (element.hasAttribute("disabled")) return false;
    return element.tabIndex !== -1 || element.tagName === "A";
  });
}

export function AssistantSidebar({
  userDisplayName,
  mobileOpen = false,
  onCloseMobile,
}: AssistantSidebarProps) {
  const pathname = usePathname();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const isLg = useSyncExternalStore(
    subscribeLg,
    getLgSnapshot,
    getLgServerSnapshot,
  );
  const mobileDrawerClosed = !isLg && !mobileOpen;
  const mobileDrawerOpen = !isLg && mobileOpen;

  useEffect(() => {
    const aside = asideRef.current;
    if (!aside) return;
    if (mobileDrawerClosed) {
      aside.setAttribute("inert", "");
    } else {
      aside.removeAttribute("inert");
    }
  }, [mobileDrawerClosed]);

  useEffect(() => {
    if (!mobileOpen || isLg) return;

    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseMobile?.();
        return;
      }

      if (event.key !== "Tab" || !wrapper) return;

      const items = getFocusableElements(wrapper);
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (active === first || !wrapper.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last || !wrapper.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, isLg, onCloseMobile]);

  return (
    <>
      {mobileDrawerOpen ? (
        <button
          type="button"
          data-testid="assistant-mobile-nav-overlay"
          aria-label="Fermer la navigation"
          className="fixed inset-0 z-20 cursor-default bg-black/50 lg:hidden"
          onClick={onCloseMobile}
        />
      ) : null}

      <div
        ref={wrapperRef}
        className={`fixed inset-y-0 left-0 z-30 ${ASSISTANT_SIDEBAR_WIDTH_CLASS} shrink-0 transition-transform duration-[200ms] ease-out motion-reduce:transition-none lg:static lg:z-auto lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <aside
          ref={asideRef}
          id="assistant-sidebar"
          data-testid="assistant-sidebar"
          aria-labelledby={mobileDrawerOpen ? titleId : undefined}
          aria-modal={mobileDrawerOpen ? true : undefined}
          role={mobileDrawerOpen ? "dialog" : undefined}
          aria-hidden={mobileDrawerClosed ? true : undefined}
          className="mobile-drawer relative flex h-dvh w-full flex-col overflow-visible border-r border-white/[0.06] bg-assistant-sidebar text-assistant-text"
        >
          <div className="hidden px-4 pb-0 pt-8 lg:block">
            <BrandLockup wordmarkClassName="text-[14px] font-extrabold tracking-[-0.02em] text-assistant-text" />
          </div>

          <div className="mobile-drawer-header relative flex h-[72px] shrink-0 items-center gap-2 border-b border-white/[0.035] pl-6 pr-[52px] lg:hidden">
            <div id={titleId}>
              <BrandLockup
                compact
                wordmarkClassName="text-[14px] font-semibold tracking-tight text-assistant-text"
              />
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              data-testid="assistant-mobile-nav-close"
              aria-label="Replier la navigation"
              aria-expanded={mobileOpen}
              aria-controls="assistant-sidebar"
              aria-hidden={mobileOpen ? undefined : true}
              tabIndex={mobileOpen ? undefined : -1}
              onClick={onCloseMobile}
              className={`mobile-drawer-collapse-button group absolute top-1/2 right-0 z-40 flex min-h-11 min-w-11 translate-x-[40%] translate-y-[calc(-50%+3px)] items-center justify-center rounded-full text-assistant-muted transition-colors duration-150 ease-out hover:text-assistant-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue ${
                mobileOpen
                  ? "pointer-events-auto opacity-100"
                  : "pointer-events-none opacity-0"
              }`}
            >
              <span
                aria-hidden
                className={`inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.055] bg-[#17181A] text-assistant-muted/70 shadow-[0_4px_14px_rgba(0,0,0,0.28)] transition-[color,opacity,transform] duration-150 ease-out motion-safe:duration-[140ms] group-hover:text-assistant-text group-active:bg-[#1b1c1f] ${
                  mobileOpen
                    ? "scale-100 opacity-100"
                    : "scale-[0.96] opacity-0"
                }`}
              >
                <ChevronLeftIcon />
              </span>
              <span
                role="tooltip"
                className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-assistant-composer px-2 py-1 text-[11px] text-assistant-text opacity-0 shadow-[0_4px_12px_rgba(0,0,0,0.35)] transition-opacity duration-150 [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:group-focus-visible:opacity-100"
              >
                Replier la navigation
              </span>
            </button>
          </div>

          <nav
            aria-label="Navigation principale"
            className="min-h-0 flex-1 overflow-y-auto px-4 pt-8"
          >
            <ul className="flex flex-col gap-1">
              {ASSISTANT_NAV.map((item) => {
                const current = isCurrentPath(pathname, item.href);
                const primary = "primary" in item && item.primary;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={current ? "page" : undefined}
                      onClick={onCloseMobile}
                      className={`group flex min-h-11 items-center gap-4 rounded-xl px-4 text-[12px] transition-[background-color,color] duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue ${
                        current
                          ? "bg-white/[0.07] font-medium text-assistant-text"
                          : primary
                            ? "font-medium text-assistant-text/85 hover:bg-white/[0.04] hover:text-assistant-text"
                            : "text-assistant-muted/75 hover:bg-white/[0.035] hover:text-assistant-text/90"
                      }`}
                    >
                      <span
                        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center transition-colors duration-150 ${
                          current
                            ? "text-assistant-text"
                            : "text-assistant-muted/70 group-hover:text-assistant-text/80"
                        }`}
                      >
                        {item.icon as ReactNode}
                      </span>
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="shrink-0 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
            <div
              data-testid="assistant-sidebar-profile"
              className="flex min-h-11 items-center gap-4 px-4"
            >
              <span
                aria-hidden
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] text-[12px] font-medium text-assistant-text"
              >
                {userDisplayName.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[12px] font-medium text-assistant-text">
                  {userDisplayName}
                </p>
                <p className="truncate text-[12px] text-assistant-muted/65">
                  Profil
                </p>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

function SparkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v3M12 18v3M3 12h3M18 12h3M6.2 6.2l2.1 2.1M15.7 15.7l2.1 2.1M17.8 6.2l-2.1 2.1M8.3 15.7l-2.1 2.1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3 5 6v6c0 5 3.5 8.5 7 9 3.5-.5 7-4 7-9V6l-7-3Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M16 19v-1.2A3.8 3.8 0 0 0 12.2 14H7.8A3.8 3.8 0 0 0 4 17.8V19"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="10" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M20 19v-.8A3 3 0 0 0 17.5 15.4M16.5 5.2a3 3 0 0 1 0 5.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M12 8v4.5L15 14"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Chevron gauche — replier le panneau vers la gauche. */
function ChevronLeftIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15 6l-6 6 6 6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
