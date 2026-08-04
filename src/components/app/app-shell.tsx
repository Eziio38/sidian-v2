"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Menu } from "lucide-react";

import {
  AppSidebar,
  type ProjectDrawerAnchor,
  type SidebarOnboardingFacts,
} from "@/components/app/app-sidebar";
import { useIsLgBreakpoint } from "@/components/assistant/use-is-lg-breakpoint";
import { IconButton } from "@/design-system";
import { cx } from "@/design-system/utils";
import type {
  ConversationHistoryItem,
  ConversationProject,
} from "@/components/assistant/types";

import styles from "./app-shell.module.css";

type AppShellProps = {
  children: ReactNode;
  userDisplayName?: string;
  userEmail?: string;
  /** Libellé commercial réel uniquement ; absent si la donnée n’est pas disponible. */
  userPlan?: string;
  /** Page métier avec header titre ; workspace = conversation plein hauteur. */
  variant?: "page" | "workspace";
  /** Apparence sombre réservée au point d’entrée Agent IA. */
  appearance?: "default" | "agent-dark";
  title?: string;
  description?: string;
  actions?: ReactNode;
  /** Preview / QA : ouvre le drawer mobile au mount. */
  defaultMobileNavOpen?: boolean;
  /** Alias testid — workspace conserve assistant-shell pour compat. */
  shellTestId?: string;
  /** Preview visuelle uniquement : force l’item actif sans changer le routage. */
  previewActiveNavId?: string;
  conversationHistory?: ConversationHistoryItem[];
  conversationProjects?: ConversationProject[];
  activeConversationId?: string | null;
  conversationHistoryBusy?: boolean;
  onNewConversation?: () => void;
  onSelectConversation?: (conversationId: string) => void;
  onDeleteConversation?: (conversationId: string) => void;
  onCreateProject?: (anchor?: ProjectDrawerAnchor) => void;
  onEditProject?: (
    project: ConversationProject,
    anchor?: ProjectDrawerAnchor,
  ) => void;
  onDuplicateProject?: (project: ConversationProject) => void;
  onDeleteProject?: (project: ConversationProject) => void;
  sidebarOnboardingFacts?: SidebarOnboardingFacts;
  onImportInvoice?: () => void;
  onCreateProtection?: () => void;
};

/**
 * Shell authentifié unique — Premium AI Workspace light.
 * Sidebar claire 224px, drawer mobile, profil en bas.
 */
export function AppShell({
  children,
  userDisplayName = "Profil",
  userEmail,
  userPlan,
  variant = "page",
  appearance = "default",
  title,
  description,
  actions,
  defaultMobileNavOpen = false,
  shellTestId,
  previewActiveNavId,
  conversationHistory,
  conversationProjects,
  activeConversationId,
  conversationHistoryBusy = false,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation,
  onCreateProject,
  onEditProject,
  onDuplicateProject,
  onDeleteProject,
  sidebarOnboardingFacts,
  onImportInvoice,
  onCreateProtection,
}: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(defaultMobileNavOpen);
  const navButtonRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const wasMobileNavOpen = useRef(false);
  const isLg = useIsLgBreakpoint();

  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const openMobileNav = useCallback(() => setMobileNavOpen(true), []);

  const isMobileDrawerOpen = !isLg && mobileNavOpen;
  const resolvedTestId =
    shellTestId ?? (variant === "workspace" ? "assistant-shell" : "app-shell");

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const media = window.matchMedia("(min-width: 1024px)");
    const closeDrawerOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) closeMobileNav();
    };
    media.addEventListener("change", closeDrawerOnDesktop);
    return () => media.removeEventListener("change", closeDrawerOnDesktop);
  }, [closeMobileNav]);

  useEffect(() => {
    if (wasMobileNavOpen.current && !isMobileDrawerOpen) {
      navButtonRef.current?.focus();
    }
    wasMobileNavOpen.current = isMobileDrawerOpen;
  }, [isMobileDrawerOpen]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    if (isMobileDrawerOpen) main.setAttribute("inert", "");
    else main.removeAttribute("inert");
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

  const isWorkspace = variant === "workspace";
  const isAgentDark = appearance === "agent-dark";

  return (
    <div
      data-testid={resolvedTestId}
      data-shell="app"
      data-variant={variant}
      // Marqueur descriptif de l'apparence du shell. Volontairement PAS
      // `data-theme` : cet attribut est réservé au thème Clair/Sombre porté
      // par <html> et par les sous-arbres épinglés (voir globals.css).
      data-appearance={isAgentDark ? "agent-dark" : isWorkspace ? "assistant-light" : "light"}
      data-lg={isLg ? "true" : "false"}
      data-mobile-nav={isMobileDrawerOpen ? "open" : "closed"}
      className={cx(
        styles.shell,
        isWorkspace && styles.workspace,
        isAgentDark && styles.agentDark,
      )}
    >
      <AppSidebar
        userDisplayName={userDisplayName}
        userEmail={userEmail}
        userPlan={userPlan}
        mobileOpen={isMobileDrawerOpen}
        onCloseMobile={closeMobileNav}
        previewActiveNavId={previewActiveNavId}
        appearance={appearance}
        conversationHistory={conversationHistory}
        activeConversationId={activeConversationId}
        conversationHistoryBusy={conversationHistoryBusy}
        conversationProjects={conversationProjects}
        onNewConversation={onNewConversation}
        onSelectConversation={(conversationId) => {
          onSelectConversation?.(conversationId);
          closeMobileNav();
        }}
        onDeleteConversation={onDeleteConversation}
        onCreateProject={onCreateProject}
        onEditProject={onEditProject}
        onDuplicateProject={onDuplicateProject}
        onDeleteProject={onDeleteProject}
        sidebarOnboardingFacts={sidebarOnboardingFacts}
        onImportInvoice={onImportInvoice}
        onCreateProtection={onCreateProtection}
      />

      <div
        ref={mainRef}
        data-testid={isWorkspace ? "assistant-main" : "app-main"}
        className={cx(styles.main, isMobileDrawerOpen && styles.mainBlocked)}
        aria-hidden={isMobileDrawerOpen ? true : undefined}
      >
        <a href="#contenu-principal" className={styles.skipLink}>
          {isWorkspace
            ? "Aller à l’espace de travail"
            : "Aller au contenu principal"}
        </a>

        {!isLg ? (
          <IconButton
            ref={navButtonRef}
            icon={Menu}
            label="Ouvrir la navigation"
            data-testid="assistant-mobile-nav"
            aria-expanded={isMobileDrawerOpen}
            aria-controls="app-sidebar"
            aria-hidden={isMobileDrawerOpen ? true : undefined}
            tabIndex={isMobileDrawerOpen ? -1 : undefined}
            onClick={openMobileNav}
            className={styles.mobileNavButton}
          />
        ) : null}

        {isWorkspace ? (
          // Le workspace est la page d'accueil produit : sans <main> ici, /app/assistant
          // n'exposait aucun landmark principal et le lien d'évitement pointait sur
          // une simple <section>.
          <main id="contenu-principal" className={styles.workspaceContent}>
            {children}
          </main>
        ) : (
          <main id="contenu-principal" className={styles.page}>
            {(title || actions) && (
              <header className={styles.pageHeader}>
                <div className={styles.pageHeaderCopy}>
                  {title ? (
                    <h1 className={styles.title}>{title}</h1>
                  ) : null}
                  {description ? (
                    <p className={styles.description}>{description}</p>
                  ) : null}
                </div>
                {actions ? <div className={styles.actions}>{actions}</div> : null}
              </header>
            )}
            <div
              className={title || actions ? styles.content : styles.contentFlush}
            >
              {children}
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
