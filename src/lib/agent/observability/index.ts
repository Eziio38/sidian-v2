/**
 * Observability & Security Monitoring déterministe (G1-I) — exports publics.
 *
 * Périmètre : modèle d’événements, sink injecté, service record(), alert candidates.
 * Détecteurs / métriques purs : `./detectors` et `./metrics` (Task B).
 *
 * Contrats Task B (branchés par défaut dans le service) :
 * ```ts
 * // detectors
 * export function runDetectors(input: RunDetectorsInput): SecuritySignal[];
 * export function detectAllSecuritySignals(events, window, options?): SecuritySignal[];
 *
 * // metrics
 * export function deriveMetrics(input: DeriveMetricsInput): MetricPoint[];
 * ```
 * Surcharge tests : `createObservabilityService({ sink, runDetectors, deriveMetrics })`.
 */

export {
  OBSERVABILITY_ERROR_CODES,
  OBSERVABILITY_SAFE_MESSAGES,
  SECURITY_SIGNAL_TYPES,
  SECURITY_SIGNAL_REASON_CODES,
  ALERT_RECOMMENDED_ACTION_CODES,
  OBSERVABILITY_METRIC_NAMES,
} from "./reason-codes";
export type {
  ObservabilityErrorCode,
  SecuritySignalType,
  SecuritySignalReasonCode,
  AlertRecommendedActionCode,
  ObservabilityMetricName,
} from "./reason-codes";

export {
  observabilityRecordInputSchema,
  observabilityEventSchema,
  observabilityMetadataSchema,
  observabilityComponentSchema,
  observabilityOutcomeSchema,
  observabilitySeveritySchema,
  securitySignalSchema,
  securitySignalTypeSchema,
  securitySignalReasonCodeSchema,
  metricPointSchema,
  observabilityMetricNameSchema,
  alertCandidateSchema,
  alertRecommendedActionCodeSchema,
  detectionWindowSchema,
  detectorThresholdsSchema,
} from "./schemas";
export type {
  ParsedObservabilityRecordInput,
  ParsedObservabilityEvent,
  ParsedSecuritySignal,
  ParsedMetricPoint,
  ParsedAlertCandidate,
} from "./schemas";

export {
  buildObservabilityEvent,
  deriveDeterministicEventId,
} from "./event-builder";

export {
  buildAlertCandidate,
  buildAlertCandidates,
} from "./alert-candidates";

export {
  InMemoryObservabilitySink,
  NullObservabilitySink,
  isInMemoryObservabilitySink,
} from "./sink";

export { createObservabilityService } from "./service";

export {
  OBSERVABILITY_SCHEMA_VERSION,
  ObservabilityError,
} from "./types";
export type {
  ObservabilityEvent,
  ObservabilityEventLike,
  ObservabilityRecordInput,
  ObservabilityMetadata,
  ObservabilityComponent,
  ObservabilityOutcome,
  ObservabilitySeverity,
  SecuritySignalSeverity,
  SecuritySignal,
  MetricPoint,
  MetricKind,
  MetricUnit,
  AlertCandidate,
  DetectAllOptions,
  ObservabilitySink,
  ObservabilitySinkResult,
  ObservabilitySinkSuccess,
  ObservabilitySinkFailure,
  ObservabilityRecordResult,
  ObservabilityRecordSuccess,
  ObservabilityRecordFailure,
  ObservabilityService,
  CreateObservabilityServiceOptions,
  DetectionWindow,
  DetectorThresholds,
  RunDetectorsInput,
  RunDetectorsFn,
  DeriveMetricsInput,
  DeriveMetricsFn,
  AgentMode,
  AutonomyLevel,
  ResourceKind,
} from "./types";
