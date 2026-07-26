/**
 * Helpers purs partagés par les détecteurs G1-I.
 */

import { createHash } from "node:crypto";

import type {
  DetectionWindow,
  ObservabilityEventLike,
  ObservabilitySeverity,
  SecuritySignal,
  SecuritySignalReasonCode,
  SecuritySignalType,
} from "./types";

export function eventCodes(event: ObservabilityEventLike): Set<string> {
  const codes = new Set<string>();
  if (typeof event.reason_code === "string" && event.reason_code.length > 0) {
    codes.add(event.reason_code);
  }
  if (typeof event.error_code === "string" && event.error_code.length > 0) {
    codes.add(event.error_code);
  }
  return codes;
}

export function hasAnyCode(
  event: ObservabilityEventLike,
  candidates: readonly string[],
): boolean {
  const codes = eventCodes(event);
  return candidates.some((c) => codes.has(c));
}

export function filterEventsInWindow(
  events: readonly ObservabilityEventLike[],
  window: DetectionWindow,
): ObservabilityEventLike[] {
  const out: ObservabilityEventLike[] = [];
  for (const event of events) {
    if (
      event.occurred_at >= window.start &&
      event.occurred_at <= window.end
    ) {
      out.push(event);
    }
  }
  return out;
}

export function groupByTenant(
  events: readonly ObservabilityEventLike[],
): Map<string, ObservabilityEventLike[]> {
  const map = new Map<string, ObservabilityEventLike[]>();
  for (const event of events) {
    const list = map.get(event.tenant_id);
    if (list) {
      list.push(event);
    } else {
      map.set(event.tenant_id, [event]);
    }
  }
  return map;
}

export function sortedEvidenceIds(
  events: readonly ObservabilityEventLike[],
): string[] {
  return [...new Set(events.map((e) => e.event_id))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
}

export function buildSignalId(
  signalType: SecuritySignalType,
  tenantId: string,
  window: DetectionWindow,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        signal_type: signalType,
        tenant_id: tenantId,
        window_end: window.end,
        window_start: window.start,
      }),
      "utf8",
    )
    .digest("hex")
    .slice(0, 32);
  return `sig_${digest}`;
}

export function buildSignal(params: {
  signal_type: SecuritySignalType;
  tenant_id: string;
  window: DetectionWindow;
  severity: ObservabilitySeverity;
  reason_code: SecuritySignalReasonCode;
  matched: readonly ObservabilityEventLike[];
  detected_at: string;
  threshold: number;
}): SecuritySignal {
  return {
    signal_id: buildSignalId(
      params.signal_type,
      params.tenant_id,
      params.window,
    ),
    signal_type: params.signal_type,
    tenant_id: params.tenant_id,
    detected_at: params.detected_at,
    severity: params.severity,
    reason_code: params.reason_code,
    evidence_event_ids: sortedEvidenceIds(params.matched),
    window_start: params.window.start,
    window_end: params.window.end,
    count: params.matched.length,
    threshold: params.threshold,
  };
}

export function detectPerTenant(params: {
  events: readonly ObservabilityEventLike[];
  window: DetectionWindow;
  threshold: number;
  signal_type: SecuritySignalType;
  severity: ObservabilitySeverity;
  reason_code: SecuritySignalReasonCode;
  match: (event: ObservabilityEventLike) => boolean;
  detected_at: string;
}): SecuritySignal[] {
  const inWindow = filterEventsInWindow(params.events, params.window);
  const byTenant = groupByTenant(inWindow);
  const signals: SecuritySignal[] = [];

  const tenantIds = [...byTenant.keys()].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  for (const tenantId of tenantIds) {
    const tenantEvents = byTenant.get(tenantId) ?? [];
    const matched = tenantEvents.filter(params.match);
    if (matched.length >= params.threshold) {
      signals.push(
        buildSignal({
          signal_type: params.signal_type,
          tenant_id: tenantId,
          window: params.window,
          severity: params.severity,
          reason_code: params.reason_code,
          matched,
          detected_at: params.detected_at,
          threshold: params.threshold,
        }),
      );
    }
  }

  return signals;
}
