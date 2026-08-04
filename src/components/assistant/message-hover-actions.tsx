"use client";

import {
  Check,
  Copy,
  MessageSquareText,
  Pencil,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { Button, IconButton } from "@/design-system";
import { cx } from "@/design-system/utils";

import type { MessageFeedback } from "./types";
import styles from "./message-hover-actions.module.css";

export type PanelPlacement = "above" | "below";

const PANEL_HEIGHT_FALLBACK = 260;
const PANEL_GAP = 8;
const PANEL_WIDTH = "min(18rem, calc(100vw - 2rem))";

function getScrollParent(element: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = element.parentElement;
  while (node) {
    const { overflowY } = window.getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function findBottomObstacle(anchor: HTMLElement): number {
  const dock =
    anchor.ownerDocument.querySelector<HTMLElement>(
      '[data-testid="assistant-composer-dock"]',
    ) ??
    anchor.ownerDocument.querySelector<HTMLElement>('[data-testid="composer"]');
  if (!dock) return window.innerHeight;
  const top = dock.getBoundingClientRect().top;
  return Number.isFinite(top) ? top : window.innerHeight;
}

function resolvePanelHeight(panel: HTMLElement | null): number {
  const measured = panel?.getBoundingClientRect().height ?? 0;
  return measured > 0 ? measured : PANEL_HEIGHT_FALLBACK;
}

/**
 * Choisit au-dessus / en dessous selon l’espace réel (viewport, scroller, composer).
 * En fil de discussion, le bas est souvent bloqué → préférence « above ».
 */
export function resolvePanelPlacement(
  anchor: HTMLElement,
  panelHeight = PANEL_HEIGHT_FALLBACK,
): PanelPlacement {
  const rect = anchor.getBoundingClientRect();
  const scrollParent = getScrollParent(anchor);
  const scrollBounds = scrollParent?.getBoundingClientRect();

  const topLimit = Math.max(0, scrollBounds?.top ?? 0);
  const bottomLimit = Math.min(
    window.innerHeight,
    scrollBounds?.bottom ?? window.innerHeight,
    findBottomObstacle(anchor),
  );

  const spaceBelow = bottomLimit - rect.bottom - PANEL_GAP;
  const spaceAbove = rect.top - topLimit - PANEL_GAP;

  if (spaceBelow >= panelHeight && spaceBelow >= spaceAbove) return "below";
  if (spaceAbove >= Math.min(panelHeight, 120) || spaceAbove >= spaceBelow) {
    return "above";
  }
  return spaceBelow > spaceAbove ? "below" : "above";
}

function buildFixedPanelStyle(
  anchor: HTMLElement,
  placement: PanelPlacement,
): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(18 * 16, window.innerWidth - 32);
  const left = Math.max(
    16,
    Math.min(rect.right - width, window.innerWidth - width - 16),
  );

  if (placement === "above") {
    return {
      position: "fixed",
      left,
      width,
      right: "auto",
      top: "auto",
      bottom: window.innerHeight - rect.top + PANEL_GAP,
    };
  }

  return {
    position: "fixed",
    left,
    width,
    right: "auto",
    top: rect.bottom + PANEL_GAP,
    bottom: "auto",
  };
}

type MessageHoverActionsProps = {
  messageId: string;
  content: string;
  feedback?: MessageFeedback | null;
  feedbackComment?: string | null;
  canEdit?: boolean;
  canRetry?: boolean;
  busy?: boolean;
  onFeedback?: (feedback: MessageFeedback | null, comment: string) => void;
  onEdit?: () => void;
  onRetry?: () => void;
  align?: "start" | "end";
};

export function MessageHoverActions({
  messageId,
  content,
  feedback = null,
  feedbackComment = null,
  canEdit = true,
  canRetry = false,
  busy = false,
  onFeedback,
  onEdit,
  onRetry,
  align = "end",
}: MessageHoverActionsProps) {
  const [copyState, setCopyState] = useState<
    "idle" | "copied" | "failed"
  >("idle");
  const [comment, setComment] = useState("");
  const [pendingKind, setPendingKind] = useState<MessageFeedback | null>(null);
  const [placement, setPlacement] = useState<PanelPlacement>("above");
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({
    width: PANEL_WIDTH,
  });
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const feedbackTriggerRef = useRef<HTMLElement | null>(null);
  const feedbackSubmissionGuardRef = useRef(false);
  const retryGuardRef = useRef(false);
  const copyResetTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
        copyResetTimerRef.current = null;
      }
    };
  }, []);

  function closeFeedback(options?: { restoreFocus?: boolean }) {
    setPendingKind(null);
    setComment("");
    if (options?.restoreFocus) {
      window.requestAnimationFrame(() => feedbackTriggerRef.current?.focus());
    }
  }

  useLayoutEffect(() => {
    if (!pendingKind || !rootRef.current) return;

    const updatePlacement = () => {
      const anchor = rootRef.current;
      if (!anchor) return;
      const next = resolvePanelPlacement(
        anchor,
        resolvePanelHeight(panelRef.current),
      );
      setPlacement(next);
      setPanelStyle(buildFixedPanelStyle(anchor, next));
    };

    updatePlacement();
    const frame = window.requestAnimationFrame(updatePlacement);

    const scrollParent = getScrollParent(rootRef.current);
    scrollParent?.addEventListener("scroll", updatePlacement, { passive: true });
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);

    return () => {
      window.cancelAnimationFrame(frame);
      scrollParent?.removeEventListener("scroll", updatePlacement);
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [pendingKind]);

  useEffect(() => {
    if (!pendingKind) return;
    textareaRef.current?.focus();

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        closeFeedback();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeFeedback({ restoreFocus: true });
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [pendingKind]);

  async function handleCopy() {
    const text = content.trim();
    if (!text) return;
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = null;
    }
    try {
      await navigator.clipboard.writeText(text);
      if (!mountedRef.current) return;
      setCopyState("copied");
      copyResetTimerRef.current = window.setTimeout(() => {
        copyResetTimerRef.current = null;
        setCopyState("idle");
      }, 1600);
    } catch {
      if (!mountedRef.current) return;
      setCopyState("failed");
      copyResetTimerRef.current = window.setTimeout(() => {
        copyResetTimerRef.current = null;
        setCopyState("idle");
      }, 2200);
    }
  }

  function openFeedbackEditor(kind: MessageFeedback, trigger: HTMLElement) {
    feedbackTriggerRef.current = trigger;
    if (rootRef.current) {
      const next = resolvePanelPlacement(rootRef.current);
      setPlacement(next);
      setPanelStyle(buildFixedPanelStyle(rootRef.current, next));
    }
    setPendingKind(kind);
    setComment(feedbackComment ?? "");
  }

  function commitFeedback(kind: MessageFeedback | null, nextComment: string) {
    if (!onFeedback || feedbackSubmissionGuardRef.current) return;
    feedbackSubmissionGuardRef.current = true;
    try {
      onFeedback(kind, kind ? nextComment.trim() : "");
    } finally {
      queueMicrotask(() => {
        feedbackSubmissionGuardRef.current = false;
      });
    }
  }

  function handleFeedbackChoice(kind: MessageFeedback) {
    if (feedback === kind) {
      commitFeedback(null, "");
      closeFeedback();
      return;
    }
    commitFeedback(kind, feedbackComment ?? "");
    closeFeedback();
  }

  function submitFeedback() {
    if (!pendingKind) return;
    commitFeedback(pendingKind, comment);
    closeFeedback({ restoreFocus: true });
  }

  function handleRetry() {
    if (busy || !onRetry || retryGuardRef.current) return;
    retryGuardRef.current = true;
    try {
      onRetry();
    } finally {
      queueMicrotask(() => {
        retryGuardRef.current = false;
      });
    }
  }

  const copyLabel =
    copyState === "copied"
      ? "Copié"
      : copyState === "failed"
        ? "Copie impossible"
        : "Copier";

  return (
    <div
      ref={rootRef}
      className={cx(styles.root, align === "start" && styles.alignStart)}
      data-testid={`message-hover-actions-${messageId}`}
      data-feedback-open={pendingKind ? "true" : "false"}
      data-panel-placement={pendingKind ? placement : undefined}
    >
      <div className={styles.actions} role="group" aria-label="Actions du message">
        <span className={styles.tip} data-tooltip="Utile">
          <IconButton
            icon={ThumbsUp}
            size="sm"
            label="Utile"
            data-testid={`message-like-${messageId}`}
            data-active={feedback === "like" ? "true" : "false"}
            aria-pressed={feedback === "like"}
            className={cx(styles.action, feedback === "like" && styles.activeLike)}
            onClick={() => handleFeedbackChoice("like")}
          />
        </span>
        <span className={styles.tip} data-tooltip="Pas utile">
          <IconButton
            icon={ThumbsDown}
            size="sm"
            label="Pas utile"
            data-testid={`message-dislike-${messageId}`}
            data-active={feedback === "dislike" ? "true" : "false"}
            aria-pressed={feedback === "dislike"}
            className={cx(
              styles.action,
              feedback === "dislike" && styles.activeDislike,
            )}
            onClick={() => handleFeedbackChoice("dislike")}
          />
        </span>
        {feedback && onFeedback ? (
          <span
            className={styles.tip}
            data-tooltip={
              feedbackComment
                ? "Modifier le commentaire"
                : "Ajouter un commentaire"
            }
          >
            <IconButton
              icon={MessageSquareText}
              size="sm"
              label={
                feedbackComment
                  ? "Modifier le commentaire"
                  : "Ajouter un commentaire"
              }
              data-testid={`message-feedback-comment-${messageId}`}
              className={styles.action}
              aria-haspopup="dialog"
              aria-expanded={pendingKind === feedback}
              aria-controls={pendingKind === feedback ? panelId : undefined}
              onClick={(event) =>
                openFeedbackEditor(feedback, event.currentTarget)
              }
            />
          </span>
        ) : null}
        <span className={styles.tip} data-tooltip={copyLabel}>
          <IconButton
            icon={copyState === "copied" ? Check : Copy}
            size="sm"
            label={copyLabel}
            data-testid={`message-copy-${messageId}`}
            className={styles.action}
            onClick={() => {
              void handleCopy();
            }}
          />
        </span>
        {canEdit ? (
          <span className={styles.tip} data-tooltip="Modifier">
            <IconButton
              icon={Pencil}
              size="sm"
              label="Modifier"
              data-testid={`message-edit-${messageId}`}
              className={styles.action}
              onClick={onEdit}
            />
          </span>
        ) : null}
        {canRetry && onRetry ? (
          <span className={styles.tip} data-tooltip="Réessayer">
            <IconButton
              icon={RotateCcw}
              size="sm"
              label="Réessayer"
              data-testid="message-retry"
              data-message-id={messageId}
              className={styles.action}
              disabled={busy}
              onClick={handleRetry}
            />
          </span>
        ) : null}
      </div>
      <span className={styles.visuallyHidden} role="status" aria-live="polite">
        {copyState === "copied"
          ? "Contenu copié."
          : copyState === "failed"
            ? "La copie a échoué."
            : ""}
      </span>

      {pendingKind ? (
        <div
          ref={panelRef}
          id={panelId}
          className={styles.feedbackPanel}
          style={panelStyle}
          data-testid={`message-feedback-panel-${messageId}`}
          data-placement={placement}
          role="dialog"
          aria-label={
            pendingKind === "like"
              ? "Qu’est-ce qui t’a plu ?"
              : "Qu’est-ce qui ne t’a pas plu ?"
          }
        >
          <div className={styles.feedbackHeader}>
            <p className={styles.feedbackTitle}>
              {pendingKind === "like"
                ? "Qu’est-ce qui t’a plu ?"
                : "Qu’est-ce qui ne t’a pas plu ?"}
            </p>
            <IconButton
              icon={X}
              size="sm"
              label="Fermer"
              className={styles.feedbackClose}
              onClick={() => closeFeedback({ restoreFocus: true })}
            />
          </div>
          <textarea
            ref={textareaRef}
            className={styles.feedbackInput}
            data-testid={`message-feedback-input-${messageId}`}
            rows={3}
            maxLength={500}
            placeholder={
              pendingKind === "like"
                ? "Ex. la réponse était claire et utile…"
                : "Ex. la réponse n’était pas assez précise…"
            }
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <div className={styles.feedbackFooter}>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => closeFeedback({ restoreFocus: true })}
            >
              Annuler
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              data-testid={`message-feedback-submit-${messageId}`}
              onClick={submitFeedback}
            >
              Envoyer
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
