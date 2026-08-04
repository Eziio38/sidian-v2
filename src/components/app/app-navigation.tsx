"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  CreditCard,
  FolderOpen,
  SquarePen,
  Users,
  type LucideIcon,
} from "lucide-react";

import { BrandLockup } from "@/components/brand/brand-lockup";
import { Icon } from "@/design-system";
import { cx } from "@/design-system/utils";
import { APP_NAV, isAppNavCurrent } from "./app-nav-config";
import styles from "./app-navigation.module.css";

type AppNavigationProps = {
  compact?: boolean;
  onNavigate?: () => void;
  onHomeNavigate?: () => void;
  onNewConversation?: () => void;
  showNewConversation?: boolean;
  newConversationDisabled?: boolean;
  homeActive?: boolean;
  previewActiveNavId?: string;
};

const NAV_ICONS: Record<string, LucideIcon> = {
  protections: FolderOpen,
  paiements: CreditCard,
  clients: Users,
  activite: Activity,
};

export function AppNavigation({
  compact = false,
  onNavigate,
  onHomeNavigate,
  onNewConversation,
  showNewConversation = false,
  newConversationDisabled = false,
  homeActive,
  previewActiveNavId,
}: AppNavigationProps) {
  const pathname = usePathname();

  return (
    <nav aria-label="Navigation principale" data-testid="app-navigation">
      <ul className={cx(styles.list, compact && styles.compact)}>
        {APP_NAV.map((item) => {
          const routeCurrent =
            previewActiveNavId !== undefined
              ? previewActiveNavId === item.id
              : isAppNavCurrent(pathname, item);
          const current =
            item.id === "aujourdhui" && homeActive !== undefined
              ? homeActive
              : routeCurrent;
          const icon = NAV_ICONS[item.id];
          return (
            <Fragment key={item.id}>
              <li>
                <Link
                  href={item.href}
                  aria-label={item.id === "aujourdhui" ? "Accueil" : undefined}
                  aria-current={current ? "page" : undefined}
                  onClick={(event) => {
                    if (item.id === "aujourdhui" && onHomeNavigate) {
                      event.preventDefault();
                      onHomeNavigate();
                      return;
                    }
                    onNavigate?.();
                  }}
                  data-nav-id={item.id}
                  className={cx(styles.link, current && styles.current)}
                >
                  {item.id === "aujourdhui" ? (
                    <>
                      <BrandLockup size="sm" className={styles.homeMark} />
                      <span className={cx(styles.label, styles.homeLabel)}>
                        Sidian
                      </span>
                    </>
                  ) : icon ? (
                    <Icon icon={icon} size="sm" className={styles.icon} />
                  ) : null}
                  {item.id !== "aujourdhui" ? (
                    <span className={styles.label}>{item.label}</span>
                  ) : null}
                </Link>
              </li>

              {item.id === "aujourdhui" && showNewConversation ? (
                <li>
                  {onNewConversation ? (
                    <button
                      type="button"
                      data-testid="sidebar-new-conversation"
                      className={cx(styles.link, styles.newConversation)}
                      disabled={newConversationDisabled}
                      onClick={onNewConversation}
                    >
                      <Icon
                        icon={SquarePen}
                        size="sm"
                        className={styles.icon}
                      />
                      <span className={styles.label}>Demander à Sidian</span>
                    </button>
                  ) : (
                    <Link
                      href="/app/assistant"
                      data-testid="sidebar-new-conversation"
                      className={styles.link}
                      onClick={onNavigate}
                    >
                      <Icon
                        icon={SquarePen}
                        size="sm"
                        className={styles.icon}
                      />
                      <span className={styles.label}>Demander à Sidian</span>
                    </Link>
                  )}
                </li>
              ) : null}
            </Fragment>
          );
        })}
      </ul>
    </nav>
  );
}
