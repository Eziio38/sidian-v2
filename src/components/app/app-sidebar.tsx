"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CreditCard,
  Copy,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { AppNavigation } from "@/components/app/app-navigation";
import { useIsLgBreakpoint } from "@/components/assistant/use-is-lg-breakpoint";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Icon, IconButton } from "@/design-system";
import { cx } from "@/design-system/utils";
import type {
  ConversationHistoryItem,
  ConversationProject,
} from "@/components/assistant/types";
import {
  PROJECT_COLOR_BY_ID,
  PROJECT_ICON_BY_ID,
} from "@/components/assistant/project-personalization";

import styles from "./app-sidebar.module.css";

const collapsedProjectIdsCache = new Map<string, Set<string>>();
const dismissedOnboardingKeysCache = new Set<string>();
const SIDEBAR_ONBOARDING_STORAGE_EVENT = "sidian-sidebar-onboarding-change";

export type SidebarOnboardingFacts = {
  hasClient: boolean;
  hasImportedInvoice: boolean;
  hasDossier: boolean;
};

export type ProjectDrawerAnchor = {
  left: number;
  top: number;
};

type AppSidebarProps = {
  userDisplayName: string;
  userEmail?: string;
  userPlan?: string;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
  previewActiveNavId?: string;
  appearance?: "default" | "agent-dark";
  conversationHistory?: ConversationHistoryItem[];
  conversationProjects?: ConversationProject[];
  activeConversationId?: string | null;
  conversationHistoryBusy?: boolean;
  /** Ouvre un espace de conversation vierge. */
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
  /** Conservé pour compatibilité d’appel ; l’action n’est plus exposée ici. */
  onCreateProtection?: () => void;
};

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

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function AppSidebar({
  userDisplayName,
  userEmail,
  userPlan,
  mobileOpen = false,
  onCloseMobile,
  previewActiveNavId,
  appearance = "default",
  conversationHistory = [],
  conversationProjects = [],
  activeConversationId,
  conversationHistoryBusy = false,
  onSelectConversation,
  onDeleteConversation,
  onCreateProject,
  onEditProject,
  onDuplicateProject,
  onDeleteProject,
  onNewConversation,
  sidebarOnboardingFacts,
  onImportInvoice,
}: AppSidebarProps) {
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const profileTriggerRef = useRef<HTMLButtonElement>(null);
  const projectMenuTriggerRefs = useRef(
    new Map<string, HTMLButtonElement>(),
  );
  const privateStateScope =
    userEmail?.trim().toLocaleLowerCase("fr") || "anonymous";
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(
    null,
  );
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(
    () => new Set(collapsedProjectIdsCache.get(privateStateScope)),
  );
  const profileMenuId = useId();
  const projectDisclosureId = useId();
  const isLg = useIsLgBreakpoint();
  const mobileDrawerClosed = !isLg && !mobileOpen;
  const mobileDrawerOpen = !isLg && mobileOpen;
  const onboardingStorageKey = useMemo(() => {
    const identity = userEmail?.trim().toLocaleLowerCase("fr") || "anonymous";
    return `sidian:sidebar-onboarding-hidden:${encodeURIComponent(identity)}`;
  }, [userEmail]);
  const onboardingDismissed = useSyncExternalStore(
    useCallback(
      (onStoreChange) => {
        function handleStorage(event: StorageEvent) {
          if (event.key === onboardingStorageKey) onStoreChange();
        }
        window.addEventListener("storage", handleStorage);
        window.addEventListener(
          SIDEBAR_ONBOARDING_STORAGE_EVENT,
          onStoreChange,
        );
        return () => {
          window.removeEventListener("storage", handleStorage);
          window.removeEventListener(
            SIDEBAR_ONBOARDING_STORAGE_EVENT,
            onStoreChange,
          );
        };
      },
      [onboardingStorageKey],
    ),
    useCallback(() => {
      if (dismissedOnboardingKeysCache.has(onboardingStorageKey)) return true;
      try {
        return window.localStorage.getItem(onboardingStorageKey) === "true";
      } catch {
        return false;
      }
    }, [onboardingStorageKey]),
    () => false,
  );
  const onboardingSteps = useMemo(
    () =>
      sidebarOnboardingFacts
        ? [
            {
              id: "client" as const,
              label: "Ajouter un premier client",
              completed: sidebarOnboardingFacts.hasClient,
              href: "/app/clients",
            },
            {
              id: "invoice" as const,
              label: "Importer une première facture",
              completed: sidebarOnboardingFacts.hasImportedInvoice,
            },
            {
              id: "dossier" as const,
              label: "Créer un premier dossier",
              completed: sidebarOnboardingFacts.hasDossier,
              href: "/app/paiements-a-recevoir",
            },
          ]
        : [],
    [sidebarOnboardingFacts],
  );
  const onboardingCompletedCount = onboardingSteps.filter(
    (step) => step.completed,
  ).length;
  const onboardingComplete =
    onboardingSteps.length > 0 &&
    onboardingCompletedCount === onboardingSteps.length;

  const { generalHistory, projectHistory } = useMemo(() => {
    const projects = conversationProjects
      .filter((project) => project.name.trim())
      .map((project) => ({
        id: project.id,
        name: project.name.trim(),
        icon: project.icon,
        color: project.color,
        conversations: [] as ConversationHistoryItem[],
      }));
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    const projectsByName = new Map(
      projects.map((project) => [project.name.toLocaleLowerCase("fr"), project]),
    );
    const general: ConversationHistoryItem[] = [];

    for (const conversation of conversationHistory) {
      const projectName = conversation.projectName?.trim();
      let project = conversation.projectId
        ? projectsById.get(conversation.projectId)
        : undefined;
      if (!project && projectName) {
        project = projectsByName.get(projectName.toLocaleLowerCase("fr"));
      }
      if (!project && projectName) {
        project = {
          id: `name:${projectName.toLocaleLowerCase("fr")}`,
          name: projectName,
          icon: undefined,
          color: undefined,
          conversations: [],
        };
        projects.push(project);
        projectsByName.set(projectName.toLocaleLowerCase("fr"), project);
      }

      if (project) project.conversations.push(conversation);
      else general.push(conversation);
    }

    projects.sort((left, right) => {
      return left.name.localeCompare(right.name, "fr", { sensitivity: "base" });
    });

    general.sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt);
      const rightTime = Date.parse(right.updatedAt);
      return (
        (Number.isNaN(rightTime) ? 0 : rightTime) -
        (Number.isNaN(leftTime) ? 0 : leftTime)
      );
    });

    return { generalHistory: general, projectHistory: projects };
  }, [conversationHistory, conversationProjects]);

  function openEmptyConversation() {
    onNewConversation?.();
    onCloseMobile?.();
  }

  useEffect(() => {
    const aside = asideRef.current;
    if (!aside) return;
    if (mobileDrawerClosed) aside.setAttribute("inert", "");
    else aside.removeAttribute("inert");
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

      if (event.shiftKey && (active === first || !wrapper.contains(active))) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!event.shiftKey && (active === last || !wrapper.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, isLg, onCloseMobile]);

  useEffect(() => {
    if (!profileMenuOpen) return;

    function onPointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !profileRef.current?.contains(event.target)
      ) {
        setProfileMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!openProjectMenuId) return;
    const projectMenuId = openProjectMenuId;

    function closeProjectMenu(event: PointerEvent) {
      if (!(event.target instanceof Element)) return;
      const root = event.target.closest<HTMLElement>("[data-project-menu-root]");
      if (root?.dataset.projectMenuRoot === projectMenuId) return;
      setOpenProjectMenuId(null);
    }

    function closeProjectMenuWithKeyboard(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpenProjectMenuId(null);
      projectMenuTriggerRefs.current.get(projectMenuId)?.focus();
    }

    document.addEventListener("pointerdown", closeProjectMenu);
    document.addEventListener("keydown", closeProjectMenuWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeProjectMenu);
      document.removeEventListener("keydown", closeProjectMenuWithKeyboard);
    };
  }, [openProjectMenuId]);

  useEffect(() => {
    function onSettingsShortcut(event: KeyboardEvent) {
      if (
        !event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.key !== "," ||
        isTextEntryTarget(event.target)
      ) {
        return;
      }

      event.preventDefault();
      setProfileMenuOpen(false);
      onCloseMobile?.();
      router.push("/app/parametres");
    }

    document.addEventListener("keydown", onSettingsShortcut);
    return () => document.removeEventListener("keydown", onSettingsShortcut);
  }, [onCloseMobile, router]);

  function dismissOnboarding() {
    try {
      window.localStorage.setItem(onboardingStorageKey, "true");
    } catch {
      dismissedOnboardingKeysCache.add(onboardingStorageKey);
    }
    window.dispatchEvent(new Event(SIDEBAR_ONBOARDING_STORAGE_EVENT));
  }

  function toggleProject(projectId: string) {
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      collapsedProjectIdsCache.set(privateStateScope, next);
      return next;
    });
  }

  function renderConversationRows(conversations: ConversationHistoryItem[]) {
    return conversations.map((conversation) => (
      <div
        key={conversation.id}
        data-testid={`assistant-conversation-${conversation.id}`}
        data-active={
          activeConversationId === conversation.id ? "true" : "false"
        }
        className={styles.historyRow}
      >
        <button
          type="button"
          aria-current={
            activeConversationId === conversation.id ? "page" : undefined
          }
          className={styles.historyItem}
          onClick={() => onSelectConversation?.(conversation.id)}
        >
          <span className={styles.historyTitle}>{conversation.title}</span>
        </button>
        {onDeleteConversation ? (
          <button
            type="button"
            data-testid={`assistant-conversation-delete-${conversation.id}`}
            className={styles.historyDelete}
            aria-label={`Supprimer « ${conversation.title} »`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDeleteConversation(conversation.id);
            }}
          >
            <Trash2 aria-hidden size={13} strokeWidth={1.7} />
          </button>
        ) : null}
      </div>
    ));
  }

  return (
    <>
      {mobileDrawerOpen ? (
        <button
          type="button"
          data-testid="assistant-mobile-nav-overlay"
          aria-label="Fermer la navigation"
          className={styles.overlay}
          onClick={onCloseMobile}
        />
      ) : null}

      <div
        ref={wrapperRef}
        data-sidebar-width="compact"
        className={cx(styles.wrapper, mobileOpen && styles.wrapperOpen)}
      >
        <aside
          ref={asideRef}
          id="app-sidebar"
          data-testid="assistant-sidebar"
          data-sidebar={appearance === "agent-dark" ? "dark" : "light"}
          aria-modal={mobileDrawerOpen ? true : undefined}
          role={mobileDrawerOpen ? "dialog" : undefined}
          aria-label={mobileDrawerOpen ? "Navigation Sidian" : undefined}
          aria-hidden={mobileDrawerClosed ? true : undefined}
          className={styles.sidebar}
        >
          <div className={styles.mobileHeader}>
            <IconButton
              ref={closeButtonRef}
              icon={ChevronLeft}
              label="Replier la navigation"
              data-testid="assistant-mobile-nav-close"
              aria-expanded={mobileOpen}
              aria-controls="app-sidebar"
              aria-hidden={mobileOpen ? undefined : true}
              tabIndex={mobileOpen ? undefined : -1}
              onClick={onCloseMobile}
              className={styles.closeButton}
            />
          </div>

          <div className={styles.navigation}>
            <AppNavigation
              onNavigate={onCloseMobile}
              onHomeNavigate={
                onNewConversation ? openEmptyConversation : undefined
              }
              onNewConversation={
                onNewConversation ? openEmptyConversation : undefined
              }
              showNewConversation
              newConversationDisabled={conversationHistoryBusy}
              homeActive={
                appearance === "agent-dark"
                  ? activeConversationId == null
                  : undefined
              }
              previewActiveNavId={previewActiveNavId}
            />

            {appearance === "agent-dark" ? (
              <section className={styles.projects} aria-label="Projets">
                <div className={styles.historyHeader}>
                  <h2>Projets</h2>
                </div>

                {onCreateProject ? (
                  <button
                    type="button"
                    data-testid="assistant-create-project"
                    className={styles.newProjectAction}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      const sidebarRect =
                        asideRef.current?.getBoundingClientRect();
                      onCreateProject({
                        left: sidebarRect?.right ?? rect.right,
                        top: rect.top,
                      });
                    }}
                  >
                    <FolderPlus aria-hidden size={14} strokeWidth={1.7} />
                    <span>Nouveau projet</span>
                  </button>
                ) : null}

                <div className={styles.projectList}>
                  {projectHistory.map((project) => {
                    const expanded = !collapsedProjectIds.has(project.id);
                    const conversationListId = `${projectDisclosureId}-${encodeURIComponent(project.id)}`;
                    const ProjectIcon = project.icon
                      ? PROJECT_ICON_BY_ID[project.icon]
                      : Folder;
                    const projectAccent = project.color
                      ? PROJECT_COLOR_BY_ID[project.color]
                      : undefined;
                    const hasProjectActions = Boolean(
                      onEditProject ||
                        onDuplicateProject ||
                        onDeleteProject,
                    );

                    return (
                      <div
                        key={project.id}
                        className={styles.projectGroup}
                        data-project-menu-root={project.id}
                      >
                        <div className={styles.projectRootRow}>
                          <button
                            type="button"
                            data-testid={`assistant-project-toggle-${project.id}`}
                            className={styles.projectToggle}
                            aria-expanded={expanded}
                            aria-controls={conversationListId}
                            onClick={() => toggleProject(project.id)}
                          >
                            <span className={styles.projectIdentity}>
                              <span
                                className={styles.projectIcon}
                                style={
                                  projectAccent
                                    ? ({
                                        "--project-accent": projectAccent,
                                      } as CSSProperties)
                                    : undefined
                                }
                              >
                                <ProjectIcon
                                  aria-hidden
                                  size={13}
                                  strokeWidth={1.7}
                                />
                              </span>
                              <span className={styles.projectName}>
                                {project.name}
                              </span>
                            </span>
                          </button>

                          {hasProjectActions ? (
                            <button
                              ref={(node) => {
                                if (node) {
                                  projectMenuTriggerRefs.current.set(
                                    project.id,
                                    node,
                                  );
                                } else {
                                  projectMenuTriggerRefs.current.delete(
                                    project.id,
                                  );
                                }
                              }}
                              type="button"
                              aria-label={`Actions pour « ${project.name} »`}
                              aria-haspopup="menu"
                              aria-expanded={
                                openProjectMenuId === project.id
                              }
                              className={styles.projectMenuTrigger}
                              onClick={(event) => {
                                event.stopPropagation();
                                setOpenProjectMenuId((current) =>
                                  current === project.id ? null : project.id,
                                );
                              }}
                            >
                              <MoreHorizontal
                                aria-hidden
                                size={15}
                                strokeWidth={1.8}
                              />
                            </button>
                          ) : null}

                          <button
                            type="button"
                            data-testid={`assistant-project-chevron-${project.id}`}
                            aria-label={
                              expanded
                                ? `Replier « ${project.name} »`
                                : `Déplier « ${project.name} »`
                            }
                            aria-expanded={expanded}
                            aria-controls={conversationListId}
                            className={styles.projectChevronButton}
                            onClick={() => toggleProject(project.id)}
                          >
                            <ChevronRight
                              aria-hidden
                              size={14}
                              strokeWidth={1.8}
                              className={styles.projectChevron}
                            />
                          </button>

                          {hasProjectActions ? (
                              <div
                                role="menu"
                                aria-label={`Actions du projet « ${project.name} »`}
                                data-open={
                                  openProjectMenuId === project.id
                                    ? "true"
                                    : "false"
                                }
                                className={styles.projectMenu}
                              >
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setOpenProjectMenuId(null);
                                    const projectRect =
                                      projectMenuTriggerRefs.current
                                        .get(project.id)
                                        ?.closest<HTMLElement>(
                                          "[data-project-menu-root]",
                                        )
                                        ?.getBoundingClientRect();
                                    const sidebarRect =
                                      asideRef.current?.getBoundingClientRect();
                                    onEditProject?.(project, {
                                      left:
                                        sidebarRect?.right ??
                                        projectRect?.right ??
                                        0,
                                      top: projectRect?.top ?? 12,
                                    });
                                  }}
                                >
                                  <Pencil
                                    aria-hidden
                                    size={14}
                                    strokeWidth={1.7}
                                  />
                                  <span>Modifier</span>
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setOpenProjectMenuId(null);
                                    onDuplicateProject?.(project);
                                  }}
                                >
                                  <Copy
                                    aria-hidden
                                    size={14}
                                    strokeWidth={1.7}
                                  />
                                  <span>Dupliquer</span>
                                </button>
                                <div
                                  aria-hidden
                                  className={styles.projectMenuDivider}
                                />
                                <button
                                  type="button"
                                  role="menuitem"
                                  className={styles.projectMenuDelete}
                                  onClick={() => {
                                    setOpenProjectMenuId(null);
                                    onDeleteProject?.(project);
                                  }}
                                >
                                  <Trash2
                                    aria-hidden
                                    size={14}
                                    strokeWidth={1.7}
                                  />
                                  <span>Supprimer</span>
                                </button>
                              </div>
                          ) : null}
                        </div>
                        <div
                          id={conversationListId}
                          className={styles.projectConversations}
                          hidden={!expanded}
                        >
                          {renderConversationRows(project.conversations)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {appearance === "agent-dark" ? (
              <section
                className={styles.history}
                aria-label="Historique des discussions"
              >
                <div className={styles.historyHeader}>
                  <h2>Discussions</h2>
                  {conversationHistoryBusy ? (
                    <span className={styles.historyStatus}>Chargement…</span>
                  ) : null}
                </div>

                <div className={styles.generalGroup}>
                  {!conversationHistoryBusy && generalHistory.length === 0 ? (
                    <p className={styles.historyEmpty}>
                      Vos conversations récentes apparaîtront ici.
                    </p>
                  ) : null}
                  <div className={styles.historyItems}>
                    {renderConversationRows(generalHistory)}
                  </div>
                </div>
              </section>
            ) : null}

            {appearance === "agent-dark" &&
            onboardingSteps.length > 0 &&
            !onboardingDismissed &&
            !onboardingComplete ? (
                <section
                  data-testid="sidebar-onboarding"
                  className={styles.onboarding}
                  aria-labelledby="sidebar-onboarding-title"
                >
                  <div className={styles.onboardingHeader}>
                    <div className={styles.onboardingTitleRow}>
                      <h2 id="sidebar-onboarding-title">Bien démarrer</h2>
                      <span className={styles.onboardingProgress}>
                        {onboardingCompletedCount} / {onboardingSteps.length}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label="Masquer Bien démarrer"
                      className={styles.onboardingDismiss}
                      onClick={dismissOnboarding}
                    >
                      <X aria-hidden size={13} strokeWidth={1.7} />
                    </button>
                  </div>
                  <div className={styles.onboardingSteps}>
                    {onboardingSteps.map((step) => {
                      const content = (
                        <>
                          <span
                            data-completed={step.completed ? "true" : "false"}
                            className={styles.onboardingStepState}
                            aria-hidden
                          >
                            {step.completed ? (
                              <Check size={12} strokeWidth={2} />
                            ) : (
                              <Circle size={12} strokeWidth={1.7} />
                            )}
                          </span>
                          <span>{step.label}</span>
                        </>
                      );

                      if (step.href) {
                        return (
                          <Link
                            key={step.id}
                            href={step.href}
                            className={styles.onboardingStep}
                            onClick={onCloseMobile}
                          >
                            {content}
                          </Link>
                        );
                      }

                      return (
                        <button
                          key={step.id}
                          type="button"
                          className={styles.onboardingStep}
                          onClick={() => {
                            onImportInvoice?.();
                            onCloseMobile?.();
                          }}
                        >
                          {content}
                        </button>
                      );
                    })}
                  </div>
                </section>
            ) : null}
          </div>

          <div ref={profileRef} className={styles.footer}>
            <div
              id={profileMenuId}
              data-open={profileMenuOpen ? "true" : "false"}
              aria-hidden={profileMenuOpen ? undefined : true}
              aria-label="Menu utilisateur"
              className={styles.profileMenu}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                setProfileMenuOpen(false);
                profileTriggerRef.current?.focus();
              }}
            >
              <div className={styles.profileMenuHeader}>
                <p className={styles.profileMenuEmail}>
                  {userEmail ?? "Compte Sidian"}
                </p>
              </div>
              <Link
                href="/app/parametres"
                className={styles.profileMenuItem}
                onClick={() => {
                  setProfileMenuOpen(false);
                  onCloseMobile?.();
                }}
              >
                <Icon
                  icon={Settings}
                  size="sm"
                  className={styles.profileMenuIcon}
                />
                <span>Paramètres</span>
                <kbd className={styles.profileMenuShortcut}>⌘ ,</kbd>
              </Link>
              <Link
                href="/app/parametres"
                className={styles.profileMenuItem}
                onClick={() => {
                  setProfileMenuOpen(false);
                  onCloseMobile?.();
                }}
              >
                <Icon
                  icon={CreditCard}
                  size="sm"
                  className={styles.profileMenuIcon}
                />
                <span>Gérer mon abonnement</span>
              </Link>
              <div className={styles.profileMenuSignOut}>
                <SignOutButton />
              </div>
            </div>

            <button
              ref={profileTriggerRef}
              type="button"
              data-testid="assistant-sidebar-profile"
              aria-haspopup="menu"
              aria-expanded={profileMenuOpen}
              aria-controls={profileMenuId}
              className={styles.profileTrigger}
              onClick={() => setProfileMenuOpen((open) => !open)}
            >
              <span aria-hidden className={styles.avatar}>
                {userDisplayName.slice(0, 1).toUpperCase()}
              </span>
              <div className={styles.profileCopy}>
                <p className={styles.profileName}>{userDisplayName}</p>
                {userPlan ? (
                  <p className={styles.profileMeta}>{userPlan}</p>
                ) : null}
              </div>
              <ChevronDown
                aria-hidden
                size={13}
                strokeWidth={1.7}
                className={styles.profileChevron}
              />
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
