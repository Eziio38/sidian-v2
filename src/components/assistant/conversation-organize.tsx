"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, FolderPlus, FolderTree, X } from "lucide-react";

import { IconButton } from "@/design-system";

import type { ConversationProject } from "./types";
import styles from "./conversation-resources.module.css";

export type ConversationOrganizeOption = {
  id: string;
  label: string;
  kind: "general" | "project" | "client";
  clientId: string | null;
  clientName: string | null;
  projectId: string | null;
  projectName: string | null;
};

type ConversationOrganizeProps = {
  options: ConversationOrganizeOption[];
  activeClientId?: string | null;
  activeClientName?: string | null;
  activeProjectId?: string | null;
  activeProjectName?: string | null;
  disabled?: boolean;
  onSelect: (option: ConversationOrganizeOption) => void;
  onCreateProject?: () => void;
};

export function ConversationOrganize({
  options,
  activeProjectId = null,
  activeProjectName = null,
  disabled = false,
  onSelect,
  onCreateProject,
}: ConversationOrganizeProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const selectedKey = useMemo(() => {
    if (activeProjectId) return `project:${activeProjectId}`;
    if (activeProjectName?.trim()) {
      return `project-name:${activeProjectName.trim().toLocaleLowerCase("fr")}`;
    }
    return "general";
  }, [activeProjectId, activeProjectName]);

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

  return (
    <div ref={rootRef} className={styles.root}>
      <IconButton
        icon={FolderTree}
        size="md"
        label="Organiser la discussion"
        title="Classer dans un projet"
        data-testid="conversation-organize-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={styles.trigger}
      />

      {open ? (
        <div
          id={panelId}
          data-testid="conversation-organize-panel"
          className={styles.panel}
          role="dialog"
          aria-label="Organiser la discussion"
        >
          <div className={styles.panelHeader}>
            <p className={styles.panelTitle}>Classer dans</p>
            <IconButton
              icon={X}
              size="sm"
              label="Fermer"
              title="Fermer"
              onClick={() => setOpen(false)}
            />
          </div>

          {onCreateProject ? (
            <button
              type="button"
              data-testid="conversation-organize-create-project"
              className={styles.createProject}
              onClick={() => {
                // Le tiroir de création prend le relais : garder ce panneau
                // ouvert empilerait deux surfaces sur la même décision.
                setOpen(false);
                onCreateProject();
              }}
            >
              <FolderPlus aria-hidden size={15} strokeWidth={1.8} />
              <span>Créer un projet</span>
            </button>
          ) : null}

          <section className={styles.section} aria-label="Emplacements">
            <ul className={styles.list}>
              {options.map((option) => {
                const optionKey =
                  option.kind === "project"
                    ? option.projectId
                      ? `project:${option.projectId}`
                      : `project-name:${(option.projectName ?? "")
                          .trim()
                          .toLocaleLowerCase("fr")}`
                    : option.kind === "client"
                      ? option.clientId
                        ? `client:${option.clientId}`
                        : `client-name:${(option.clientName ?? "")
                            .trim()
                            .toLocaleLowerCase("fr")}`
                      : "general";
                const selected = optionKey === selectedKey;
                const meta =
                  option.kind === "project"
                    ? "Projet"
                    : option.kind === "client"
                      ? "Client"
                      : "Sans projet";
                return (
                  <li key={option.id}>
                    <button
                      type="button"
                      data-testid={`conversation-organize-option-${option.id}`}
                      data-selected={selected ? "true" : "false"}
                      className={styles.organizeOption}
                      onClick={() => {
                        onSelect(option);
                        setOpen(false);
                      }}
                    >
                      <span className={styles.itemCopy}>
                        <span className={styles.itemName}>{option.label}</span>
                        <span className={styles.itemMeta}>{meta}</span>
                      </span>
                      {selected ? (
                        <Check aria-hidden size={14} strokeWidth={2} />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Emplacements de classement : Général + projets explicites uniquement.
 * Les noms de clients (connus / historique) ne deviennent des projets
 * qu’après acceptation de « Créer l’espace … » ou création manuelle.
 */
export function buildConversationOrganizeOptions(params: {
  projects: ConversationProject[];
}): ConversationOrganizeOption[] {
  const options: ConversationOrganizeOption[] = [
    {
      id: "general",
      label: "Général",
      kind: "general",
      clientId: null,
      clientName: null,
      projectId: null,
      projectName: null,
    },
  ];

  const seenProjects = new Set<string>();

  for (const project of params.projects) {
    const name = project.name.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase("fr");
    if (seenProjects.has(key)) continue;
    seenProjects.add(key);
    options.push({
      id: `project-${project.id}`,
      label: name,
      kind: "project",
      clientId: null,
      clientName: null,
      projectId: project.id,
      projectName: name,
    });
  }

  return options;
}
