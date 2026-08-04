"use client";

import { ArrowUpRight } from "lucide-react";

import { Badge, Button, Icon, SuccessCard, TimelineCard } from "@/design-system";

import type { AssistantMessageCard } from "./types";
import styles from "./message-card.module.css";

type MessageCardProps = {
  card: AssistantMessageCard;
  onOpen?: () => void;
};

function paymentTone(label: string): "success" | "info" | "upcoming" {
  const key = label.toLocaleLowerCase("fr");
  if (key.includes("valid")) return "success";
  if (key.includes("cours")) return "info";
  return "upcoming";
}

function looksEmptyPaymentValue(value: string): boolean {
  return /(?:^|\s)0(?:\s|$)|0[,.]00\s*€|aucun|indisponible|à préciser/i.test(
    value,
  );
}

function insightEyebrow(kind: AssistantMessageCard["kind"]): string {
  switch (kind) {
    case "protection_draft":
      return "Protection";
    case "protection":
      return "Protection prête";
    case "action_needed":
      return "Action";
    case "payment":
      return "Paiements";
    default:
      return "Détail";
  }
}

function InsightBlock({
  card,
  onOpen,
  openLabel = "Continuer",
}: {
  card: Extract<
    AssistantMessageCard,
    { kind: "protection" | "protection_draft" | "action_needed" }
  >;
  onOpen?: () => void;
  openLabel?: string;
}) {
  return (
    <article
      data-testid="message-card"
      data-card-kind={card.kind}
      className={styles.insight}
    >
      <header className={styles.insightHeader}>
        <div>
          <p className={styles.insightEyebrow}>{insightEyebrow(card.kind)}</p>
          <h3 className={styles.insightTitle}>{card.title}</h3>
          {card.subtitle ? (
            <p className={styles.insightSubtitle}>{card.subtitle}</p>
          ) : null}
        </div>
        {card.statusLabel ? (
          <Badge tone="neutral">{card.statusLabel}</Badge>
        ) : null}
      </header>

      {card.meta && card.meta.length > 0 ? (
        <dl className={styles.meta}>
          {card.meta.slice(0, 4).map((row) => (
            <div key={`${row.label}-${row.value}`} className={styles.metaItem}>
              <dt className={styles.metaLabel}>{row.label}</dt>
              <dd className={styles.metaValue}>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {onOpen ? (
        <footer className={styles.insightFooter}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onOpen}
            data-testid="message-card-open"
          >
            {openLabel}
          </Button>
        </footer>
      ) : null}
    </article>
  );
}

/**
 * Blocs métier conversationnels — exceptionnels, compacts, un seul max.
 * Le texte reste la forme principale de communication.
 */
export function MessageCard({ card, onOpen }: MessageCardProps) {
  if (card.kind === "confirmation") {
    return (
      <SuccessCard
        data-testid="message-card"
        data-card-kind="confirmation"
        className={styles.confirmation}
        density="compact"
        title={card.title}
        description={card.subtitle}
      />
    );
  }

  if (card.kind === "timeline") {
    return (
      <TimelineCard
        data-testid="message-card"
        data-card-kind="timeline"
        className={styles.card}
        density="compact"
        title={card.title}
        items={card.items.map((item, index) => ({
          id: `${index}-${item.label}`,
          ...item,
        }))}
      />
    );
  }

  if (card.kind === "payment") {
    const meta = card.meta ?? [];
    const isEmpty =
      meta.length > 0 && meta.every((row) => looksEmptyPaymentValue(row.value));

    return (
      <article
        data-testid="message-card"
        data-card-kind="payment"
        data-empty={isEmpty ? "true" : "false"}
        className={styles.paymentCard}
      >
        <header className={styles.paymentHeader}>
          <div className={styles.paymentHeading}>
            <p className={styles.insightEyebrow}>Paiements</p>
            <h3 className={styles.paymentTitle}>{card.title}</h3>
            {card.subtitle ? (
              <p className={styles.paymentSubtitle}>{card.subtitle}</p>
            ) : null}
          </div>
          {card.statusLabel ? (
            <Badge tone="neutral">{card.statusLabel}</Badge>
          ) : null}
        </header>

        {isEmpty ? (
          <p className={styles.paymentEmpty}>
            Aucun paiement suivi pour le moment. Quand une protection sera
            active, le détail apparaîtra ici.
          </p>
        ) : meta.length > 0 ? (
          <dl className={styles.paymentMetrics}>
            {meta.map((row) => (
              <div
                key={`${row.label}-${row.value}`}
                className={styles.paymentMetric}
                data-tone={paymentTone(row.label)}
              >
                <dt className={styles.paymentMetricLabel}>{row.label}</dt>
                <dd className={styles.paymentMetricValue}>{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {onOpen ? (
          <footer className={styles.paymentFooter}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onOpen}
              data-testid="message-card-open"
            >
              Consulter les paiements
              <Icon icon={ArrowUpRight} size="sm" aria-hidden />
            </Button>
          </footer>
        ) : null}
      </article>
    );
  }

  return (
    <InsightBlock
      card={card}
      onOpen={onOpen}
      openLabel={
        card.kind === "protection_draft"
          ? "Continuer"
          : card.kind === "protection"
            ? "Confirmer"
            : "Voir le détail"
      }
    />
  );
}
