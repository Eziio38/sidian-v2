/**
 * Métriques d’observabilité pures G1-I — barrel public.
 * Service : `import { deriveMetrics } from "./metrics"`
 */

export {
  OBSERVABILITY_METRIC_NAMES,
  METRIC_NAMES,
} from "./types";

export type {
  MetricPoint,
  ObservabilityEvent,
  ObservabilityEventLike,
  DeriveMetricsInput,
  ObservabilityMetadata,
  ObservabilityMetricName,
} from "./types";

export {
  deriveMetrics,
  deriveMetricsFromEvents,
  deriveMetricsFromEvent,
  isKnownMetricName,
} from "./derive";
