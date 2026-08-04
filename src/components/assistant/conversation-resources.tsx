"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ExternalLink, FileText, FolderOpen, Link2, X } from "lucide-react";

import { Icon, IconButton } from "@/design-system";

import { formatFileSize } from "./composer";
import type { MessageAttachment } from "./types";
import styles from "./conversation-resources.module.css";

export type ConversationLink = {
  id: string;
  url: string;
  label: string;
};

type ConversationResourcesProps = {
  files: MessageAttachment[];
  links: ConversationLink[];
};

const URL_WITH_SCHEME = /https?:\/\/[^\s<>"'\)\]]+/gi;
const BARE_DOMAIN =
  /\b(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>"'\)\]]*)?/gi;

const FILE_EXTENSION_TLDS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "heic",
  "heif",
  "pdf",
  "svg",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "txt",
  "zip",
  "rar",
  "mp4",
  "mov",
  "css",
  "js",
  "ts",
  "tsx",
  "jsx",
  "json",
  "xml",
]);

function normalizeDetectedUrl(raw: string): string | null {
  const cleaned = raw.replace(/[.,;:!?)]+$/g, "").trim();
  if (!cleaned) return null;
  if (cleaned.includes("@")) return null;

  if (/^https?:\/\//i.test(cleaned)) return cleaned;

  const host = cleaned.split("/")[0] ?? cleaned;
  const tld = host.split(".").pop()?.toLocaleLowerCase("en") ?? "";
  if (!tld || FILE_EXTENSION_TLDS.has(tld)) return null;
  // Un domaine utile a au moins un label alphabétique (évite 18.40.20.png).
  if (!/[a-z]/i.test(host.replace(/\./g, ""))) return null;

  return `https://${cleaned}`;
}

export function extractConversationLinks(
  contents: string[],
): ConversationLink[] {
  const seen = new Set<string>();
  const links: ConversationLink[] = [];

  for (const content of contents) {
    const withScheme = content.match(URL_WITH_SCHEME) ?? [];
    const bare = content.match(BARE_DOMAIN) ?? [];
    for (const raw of [...withScheme, ...bare]) {
      const url = normalizeDetectedUrl(raw);
      if (!url) continue;
      const key = url.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({
        id: `link-${links.length + 1}`,
        url,
        label: url.replace(/^https?:\/\//i, ""),
      });
    }
  }

  return links;
}

export function ConversationResources({
  files,
  links,
}: ConversationResourcesProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (files.length === 0 && links.length === 0) {
    return null;
  }

  return (
    <div ref={rootRef} className={styles.root}>
      <IconButton
        icon={FolderOpen}
        size="md"
        label="Fichiers et liens de la conversation"
        title="Fichiers et liens"
        data-testid="conversation-resources-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className={styles.trigger}
      />

      {open ? (
        <div
          id={panelId}
          data-testid="conversation-resources-panel"
          className={styles.panel}
          role="dialog"
          aria-label="Fichiers et liens de la conversation"
        >
          <div className={styles.panelHeader}>
            <p className={styles.panelTitle}>Fichiers et liens</p>
            <IconButton
              icon={X}
              size="sm"
              label="Fermer"
              title="Fermer"
              onClick={() => setOpen(false)}
            />
          </div>

          {files.length > 0 ? (
            <section className={styles.section} aria-label="Fichiers joints">
              <h3 className={styles.sectionTitle}>
                <Icon icon={FileText} size="sm" />
                Fichiers
              </h3>
              <ul className={styles.list}>
                {files.map((file) => (
                  <li key={file.id} className={styles.item}>
                    {file.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- blob preview local
                      <img
                        src={file.previewUrl}
                        alt=""
                        className={styles.thumb}
                      />
                    ) : (
                      <span className={styles.fileIcon} aria-hidden>
                        <Icon icon={FileText} size="sm" />
                      </span>
                    )}
                    <span className={styles.itemCopy}>
                      <span className={styles.itemName} title={file.name}>
                        {file.name}
                      </span>
                      <span className={styles.itemMeta}>
                        {formatFileSize(file.size)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {links.length > 0 ? (
            <section className={styles.section} aria-label="Liens partagés">
              <h3 className={styles.sectionTitle}>
                <Icon icon={Link2} size="sm" />
                Liens
              </h3>
              <ul className={styles.list}>
                {links.map((link) => (
                  <li key={link.id} className={styles.item}>
                    <span className={styles.fileIcon} aria-hidden>
                      <Icon icon={ExternalLink} size="sm" />
                    </span>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.link}
                      title={link.url}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
