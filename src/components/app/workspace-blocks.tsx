import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "@/design-system/utils";

import styles from "./workspace-blocks.module.css";

export function WorkspaceStack({ children }: { children: ReactNode }) {
  return <div className={styles.stack}>{children}</div>;
}

export function WorkspaceSplit({ children }: { children: ReactNode }) {
  return <div className={styles.split}>{children}</div>;
}

export function WorkspaceSection({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      {title || description ? (
        <header className={styles.sectionHeader}>
          {title ? <h2 className={styles.sectionTitle}>{title}</h2> : null}
          {description ? (
            <p className={styles.sectionDescription}>{description}</p>
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function BusinessList({
  children,
  ariaLabel,
  ordered = false,
}: {
  children: ReactNode;
  ariaLabel?: string;
  ordered?: boolean;
}) {
  const Component = ordered ? "ol" : "ul";
  return (
    <Component className={styles.list} aria-label={ariaLabel}>
      {children}
    </Component>
  );
}

export function BusinessRow({
  title,
  description,
  href,
  leading,
  accessory,
  children,
}: {
  title: string;
  description?: string;
  href?: string;
  leading?: ReactNode;
  accessory?: ReactNode;
  children?: ReactNode;
}) {
  const content = (
    <>
      <div className={styles.rowMain}>
        {leading}
        <div className={styles.rowCopy}>
          <p className={styles.rowTitle}>{title}</p>
          {description ? (
            <p className={styles.rowDescription}>{description}</p>
          ) : null}
        </div>
      </div>
      {accessory ? <div className={styles.rowAccessory}>{accessory}</div> : null}
    </>
  );

  return (
    <li className={styles.listItem}>
      {href ? (
        <Link href={href} className={styles.row}>
          {content}
        </Link>
      ) : (
        <div className={styles.row}>{content}</div>
      )}
      {children}
    </li>
  );
}

export function WorkspacePanel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{title}</h2>
      {description ? (
        <p className={styles.panelDescription}>{description}</p>
      ) : null}
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}

export function RowAvatar({ name }: { name: string }) {
  return (
    <span className={styles.avatar} aria-hidden>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function RowAmount({ children }: { children: ReactNode }) {
  return <p className={styles.amount}>{children}</p>;
}

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <nav className={styles.filters} aria-label="Filtres">
      {children}
    </nav>
  );
}

export function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        styles.filterLink,
        active && styles.filterActive,
      )}
    >
      {children}
    </Link>
  );
}

export function RowDetails({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <details className={styles.details}>
      <summary className={styles.detailsSummary}>{label}</summary>
      <div className={styles.detailsBody}>{children}</div>
    </details>
  );
}

export function SettingsStack({ children }: { children: ReactNode }) {
  return <div className={styles.settingsStack}>{children}</div>;
}

export function EventMarker({
  tone = "neutral",
}: {
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <span
      aria-hidden
      className={cx(
        styles.eventMarker,
        tone === "success" && styles.eventMarkerSuccess,
        tone === "warning" && styles.eventMarkerWarning,
        tone === "danger" && styles.eventMarkerDanger,
      )}
    />
  );
}

export function EventTime({
  dateTime,
  children,
}: {
  dateTime?: string;
  children: ReactNode;
}) {
  return (
    <time dateTime={dateTime} className={styles.eventTime}>
      {children}
    </time>
  );
}
