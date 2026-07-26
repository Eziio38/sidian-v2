import type { ConfigChannelStatus } from "@/lib/ux/config-status-types";

import { StatusBanner } from "./status-banner";
import type { FeedbackTone } from "./types";

function toneForState(state: ConfigChannelStatus["state"]): FeedbackTone {
  if (state === "ready") return "success";
  if (state === "partial") return "info";
  if (state === "blocked" || state === "missing") return "warning";
  return "danger";
}

type MissingConfigBannerProps = {
  channel: ConfigChannelStatus;
  className?: string;
};

/** Affiche un canal manquant / partiel / bloqué — ignore les canaux prêts. */
export function MissingConfigBanner({
  channel,
  className = "",
}: MissingConfigBannerProps) {
  if (channel.state === "ready") return null;

  return (
    <StatusBanner
      tone={toneForState(channel.state)}
      badge={channel.label}
      title={channel.title}
      description={channel.description}
      className={className}
      action={
        channel.href
          ? {
              label: channel.actionLabel ?? "Voir",
              href: channel.href,
            }
          : undefined
      }
    />
  );
}

type ConfigStatusListProps = {
  channels: ConfigChannelStatus[];
  /** Si true, n’affiche que les canaux non prêts. */
  gapsOnly?: boolean;
  className?: string;
  title?: string;
  description?: string;
};

export function ConfigStatusList({
  channels,
  gapsOnly = false,
  className = "",
  title,
  description,
}: ConfigStatusListProps) {
  const visible = gapsOnly
    ? channels.filter((channel) => channel.state !== "ready")
    : channels;

  if (visible.length === 0) {
    return null;
  }

  return (
    <section
      data-testid="config-status-list"
      className={`space-y-3 ${className}`}
      aria-label={title ?? "État des canaux"}
    >
      {title ? (
        <div className="mb-1">
          <h2 className="text-lg font-semibold text-nuit">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm leading-relaxed text-gris-500">
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
      <ul className="space-y-3">
        {visible.map((channel) => (
          <li key={channel.kind}>
            <StatusBanner
              tone={toneForState(channel.state)}
              badge={channel.label}
              title={channel.title}
              description={channel.description}
              action={
                channel.href
                  ? {
                      label: channel.actionLabel ?? "Voir",
                      href: channel.href,
                    }
                  : undefined
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
