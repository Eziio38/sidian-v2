"use client";

import { cx } from "@/design-system/utils";

import { formatGreeting } from "./greeting";
import {
  buildWelcomeSituationCopy,
  type WelcomeDataState,
} from "./welcome-summary";
import styles from "./welcome-state.module.css";

export type WelcomeBriefCard = {
  id: string;
  label: string;
  value: string;
  hint?: string;
};

type WelcomeStateProps = {
  userFirstName: string | null;
  summaryLines: string[];
  visible: boolean;
  dataState?: WelcomeDataState;
  briefCards?: WelcomeBriefCard[];
  compact?: boolean;
};

export function WelcomeState({
  userFirstName,
  summaryLines,
  visible,
  dataState = "none_due",
  briefCards,
  compact = false,
}: WelcomeStateProps) {
  if (!visible) return null;

  const greeting = formatGreeting(userFirstName);
  const situation = buildWelcomeSituationCopy({
    dataState,
    summaryLines,
    briefCards,
  });

  if (compact) {
    return (
      <div
        data-testid="welcome-state"
        data-welcome-state={dataState}
        data-compact="true"
        className={cx(styles.welcome, styles.compact)}
      >
        <p className={styles.compactCopy}>
          {greeting}. {situation.headline}
          {situation.detail ? ` ${situation.detail}` : ""}
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="welcome-state"
      data-welcome-state={dataState}
      className={styles.welcome}
    >
      <p className={styles.eyebrow} data-testid="welcome-eyebrow">
        Votre agent IA
      </p>

      <h1 data-testid="welcome-greeting" className={styles.greeting}>
        {greeting}
        <span aria-hidden>,</span>
      </h1>

      <section
        data-testid="welcome-sidian-message"
        className={styles.situation}
        aria-label="Situation du jour"
      >
        <p
          data-testid="welcome-attention-line"
          className={styles.situationHeadline}
        >
          {situation.headline}
        </p>
        {situation.detail ? (
          <p
            data-testid="welcome-situation-detail"
            className={styles.situationDetail}
          >
            {situation.detail}
          </p>
        ) : null}
      </section>
    </div>
  );
}
