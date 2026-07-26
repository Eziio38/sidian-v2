/**
 * Contrats locaux métriques — alignés types racine + duck-typing fixtures.
 */

export type {
  MetricPoint,
  ObservabilityEvent,
  DeriveMetricsInput,
  ObservabilityMetadata,
} from "../types";

export type { ObservabilityMetricName } from "../reason-codes";

export { OBSERVABILITY_METRIC_NAMES } from "../reason-codes";

export { OBSERVABILITY_METRIC_NAMES as METRIC_NAMES } from "../reason-codes";

/**
 * Vue duck-typée minimale pour fixtures / dérivation.
 * Compatible structurellement avec `ObservabilityEvent`.
 */
export type ObservabilityEventLike = {
  event_id: string;
  occurred_at: string;
  tenant_id?: string;
  component?: string | null;
  operation?: string | null;
  outcome?: string | null;
  duration_ms?: number | null;
  reason_code?: string | null;
  error_code?: string | null;
  idempotency_status?: string | null;
  approval_status?: string | null;
  approval_required?: boolean | null;
  approval_consumed?: boolean | null;
  replayed?: boolean | null;
  execution_outcome?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
};
