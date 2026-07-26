/**
 * Adaptateurs fixtures — branchent detectors/metrics sur le service.
 *
 * Friction : selon les révisions Task B, `deriveMetrics` accepte soit
 * `DeriveMetricsInput` soit `events[]`. L’adaptateur normalise les deux.
 */

import type {
  DeriveMetricsFn,
  MetricPoint,
  RunDetectorsFn,
} from "@/lib/agent/observability";
import { runDetectors } from "@/lib/agent/observability/detectors";
import {
  deriveMetrics,
  deriveMetricsFromEvents,
} from "@/lib/agent/observability/metrics";

function asMetricPoints(value: unknown): MetricPoint[] {
  if (!Array.isArray(value)) {
    throw new Error("METRIC_DERIVATION_FAILED");
  }
  return value as MetricPoint[];
}

/** Contrat service — dérivation métriques (robuste aux deux signatures B). */
export const fixtureDeriveMetrics: DeriveMetricsFn = ({ event, events }) => {
  const source = events && events.length > 0 ? events : [event];
  try {
    // Signature objet Preferée
    return asMetricPoints(deriveMetrics({ event, events: source }));
  } catch {
    // Signature tableau (révisions antérieures / parallèles)
    return asMetricPoints(deriveMetricsFromEvents(source));
  }
};

/** Contrat service — détecteurs. */
export const fixtureRunDetectors: RunDetectorsFn = (input) =>
  runDetectors(input);
