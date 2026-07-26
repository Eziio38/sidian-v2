/**
 * Contrats locaux des détecteurs — alignés types racine + duck-typing fixtures.
 */

export type {
  SecuritySignal,
  DetectionWindow,
  DetectorThresholds,
  RunDetectorsInput,
  ObservabilityEvent,
  ObservabilitySeverity,
  SecuritySignalSeverity,
} from "../types";

export type {
  SecuritySignalType,
  SecuritySignalReasonCode,
} from "../reason-codes";

export {
  SECURITY_SIGNAL_TYPES,
  SECURITY_SIGNAL_REASON_CODES,
} from "../reason-codes";

/**
 * Vue duck-typée minimale pour fixtures / détecteurs purs.
 * Compatible structurellement avec `ObservabilityEvent`.
 */
export type ObservabilityEventLike = {
  event_id: string;
  occurred_at: string;
  tenant_id: string;
  component?: string | null;
  operation?: string | null;
  outcome?: string | null;
  severity?: string | null;
  duration_ms?: number | null;
  tool_id?: string | null;
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

/** Options injectables — jamais Date.now(). */
export type DetectAllOptions = {
  thresholds?: Partial<import("../types").DetectorThresholds>;
  now?: string;
};

export type DetectorOptions = {
  threshold?: number;
  now?: string;
};
