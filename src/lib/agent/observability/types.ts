/**
 * Types du modèle d’observabilité agent (G1-I).
 * Événements structurés sanitizés — aucune I/O réseau, aucun OTel/Datadog.
 *
 * Contrats Task B :
 * - `./detectors` → `runDetectors(input: RunDetectorsInput): SecuritySignal[]`
 * - `./metrics` → `deriveMetrics(input: DeriveMetricsInput): MetricPoint[]`
 */

import type {
  AgentMode,
  AutonomyLevel,
  ResourceKind,
} from "@/lib/agent/permissions/types";

import type {
  AlertRecommendedActionCode,
  ObservabilityErrorCode,
  ObservabilityMetricName,
  SecuritySignalReasonCode,
  SecuritySignalType,
} from "./reason-codes";

export type {
  AgentMode,
  AutonomyLevel,
  ResourceKind,
  AlertRecommendedActionCode,
  ObservabilityErrorCode,
  ObservabilityMetricName,
  SecuritySignalReasonCode,
  SecuritySignalType,
};

/** Version de schéma embarquée dans chaque ObservabilityEvent. */
export const OBSERVABILITY_SCHEMA_VERSION = "1" as const;

/** Composants producteurs d’événements d’observabilité. */
export type ObservabilityComponent =
  | "tool_router"
  | "permission"
  | "idempotency"
  | "approval"
  | "audit"
  | "executor"
  | "observability";

/**
 * Issue normalisée — inclut les issues Router/Permission pour dérivation métriques.
 */
export type ObservabilityOutcome =
  | "success"
  | "blocked"
  | "denied"
  | "approval_required"
  | "validation_error"
  | "error"
  | "replayed"
  | "degraded";

/** Sévérité structurée (événements) — pas de texte libre. */
export type ObservabilitySeverity =
  | "info"
  | "warning"
  | "error"
  | "critical";

/**
 * Sévérité d’un signal de sécurité.
 * Alias volontaire de `ObservabilitySeverity` (contrat detectors Task B).
 */
export type SecuritySignalSeverity = ObservabilitySeverity;
/**
 * Métadonnées sanitizées — valeurs scalaires uniquement.
 * Interdit via schéma strict + refine : secret, token, stack, SQL, PAN, args, etc.
 */
export type ObservabilityMetadata = Record<
  string,
  string | number | boolean | null
>;

/**
 * Événement d’observabilité structuré (G1-I).
 * Interdictions absolues : args/output complets, secret, token,
 * clé d’idempotence brute, stack, SQL, PAN, PII inutile.
 */
export type ObservabilityEvent = {
  event_id: string;
  schema_version: typeof OBSERVABILITY_SCHEMA_VERSION;
  /** ISO-8601 UTC injecté — jamais Date.now() implicite. */
  occurred_at: string;
  correlation_id: string;
  tenant_id: string;
  component: ObservabilityComponent;
  operation: string;
  outcome: ObservabilityOutcome;
  severity: ObservabilitySeverity;
  duration_ms?: number;
  tool_id?: string;
  tool_version?: string;
  mode?: AgentMode;
  autonomy_level?: AutonomyLevel;
  resource_kind?: ResourceKind;
  reason_code?: string;
  error_code?: string;
  idempotency_status?: string;
  approval_status?: string;
  approval_required?: boolean;
  approval_consumed?: boolean;
  replayed?: boolean;
  execution_outcome?: string;
  metadata?: ObservabilityMetadata;
};

/**
 * Alias duck-typing pour detectors / fixtures (Task B/C).
 * Structurellement identique à `ObservabilityEvent`.
 */
export type ObservabilityEventLike = ObservabilityEvent;

/**
 * Entrée de construction / record — horloge injectée obligatoire (`now`).
 * Pas de champs payload / arguments / secret / stack.
 */
export type ObservabilityRecordInput = {
  /** Horloge injectée → `occurred_at`. Obligatoire — pas Date.now(). */
  now: string;
  /** Si omis, dérivé déterministe des champs stables. */
  event_id?: string;
  correlation_id: string;
  tenant_id: string;
  component: ObservabilityComponent;
  operation: string;
  outcome: ObservabilityOutcome;
  severity: ObservabilitySeverity;
  duration_ms?: number;
  tool_id?: string;
  tool_version?: string;
  mode?: AgentMode;
  autonomy_level?: AutonomyLevel;
  resource_kind?: ResourceKind;
  reason_code?: string;
  error_code?: string;
  idempotency_status?: string;
  approval_status?: string;
  approval_required?: boolean;
  approval_consumed?: boolean;
  replayed?: boolean;
  execution_outcome?: string;
  metadata?: ObservabilityMetadata;
  /**
   * Fenêtre de détection injectée.
   * Si omise, le service utilise `{ start: now, end: now }` (événement seul).
   */
  detection_window?: DetectionWindow;
  /** Seuils optionnels transmis aux détecteurs. */
  thresholds?: Partial<DetectorThresholds>;
};

/** Fenêtre temporelle injectée — jamais Date.now(). */
export type DetectionWindow = {
  start: string;
  end: string;
};

/** Seuils par type de signal — paramètres explicites (Task B). */
export type DetectorThresholds = Record<SecuritySignalType, number>;

/**
 * Signal de sécurité local — evidence = identifiants d’événements uniquement.
 * Pas de payload source, pas de texte libre sensible.
 */
export type SecuritySignal = {
  signal_id: string;
  signal_type: SecuritySignalType;
  tenant_id: string;
  detected_at: string;
  severity: SecuritySignalSeverity;
  reason_code: SecuritySignalReasonCode;
  evidence_event_ids: readonly string[];
  window_start: string;
  window_end: string;
  count: number;
  /** Seuil déclencheur — optionnel (certains détecteurs n’exposent que count). */
  threshold?: number;
};

export type MetricKind = "counter" | "histogram";

export type MetricUnit = "1" | "ms";

/**
 * Point de métrique déterministe — dérivé des événements, pas d’état global.
 * `kind` / `unit` : contrat metrics Task B.
 * `occurred_at` : optionnel (enrichissement service / fixtures).
 */
export type MetricPoint = {
  name: ObservabilityMetricName;
  value: number;
  kind: MetricKind;
  unit: MetricUnit;
  occurred_at?: string;
  /** Labels sanitizés (tenant, outil, outcome…) — jamais secret/payload. */
  labels?: ObservabilityMetadata;
};

/**
 * Candidat d’alerte local — pas d’envoi, pas de notification, pas d’incident auto.
 */
export type AlertCandidate = {
  alert_candidate_id: string;
  tenant_id: string;
  detected_at: string;
  signal_type: SecuritySignalType;
  severity: SecuritySignalSeverity;
  reason_code: SecuritySignalReasonCode;
  evidence_event_ids: readonly string[];
  recommended_action_code: AlertRecommendedActionCode;
  deduplication_key: string;
  window_start: string;
  window_end: string;
};

/** Options injectables pour `detectAllSecuritySignals` (Task B). */
export type DetectAllOptions = {
  thresholds?: Partial<DetectorThresholds>;
  /** Horodatage pour `detected_at` ; défaut = `window.end`. */
  now?: string;
};
/** Résultat sink — ok ou code sûr. */
export type ObservabilitySinkSuccess = {
  ok: true;
  event_id: string;
};

export type ObservabilitySinkFailure = {
  ok: false;
  code: Extract<
    ObservabilityErrorCode,
    "SINK_UNAVAILABLE" | "SINK_FAILED" | "OBSERVABILITY_INPUT_INVALID"
  >;
  message: string;
};

export type ObservabilitySinkResult =
  | ObservabilitySinkSuccess
  | ObservabilitySinkFailure;

/**
 * Sink injecté — aucune implémentation réseau/console implicite.
 */
export interface ObservabilitySink {
  record(event: ObservabilityEvent): Promise<ObservabilitySinkResult>;
}

/** Entrée detectors (`runDetectors` — Task B). */
export type RunDetectorsInput = {
  events: readonly ObservabilityEvent[];
  window: DetectionWindow;
  thresholds?: Partial<DetectorThresholds>;
  now: string;
};

export type RunDetectorsFn = (input: RunDetectorsInput) => SecuritySignal[];

/** Entrée metrics (`deriveMetrics` — Task B). */
export type DeriveMetricsInput = {
  event: ObservabilityEvent;
  events?: readonly ObservabilityEvent[];
};

export type DeriveMetricsFn = (input: DeriveMetricsInput) => MetricPoint[];

export type ObservabilityRecordSuccess = {
  ok: true;
  event: ObservabilityEvent;
  metrics: MetricPoint[];
  signals: SecuritySignal[];
  alert_candidates: AlertCandidate[];
  /** Présent lorsque des signaux ont été détectés (statut informatif). */
  code?: "SECURITY_SIGNAL_DETECTED";
  message?: string;
};

export type ObservabilityRecordFailure = {
  ok: false;
  code: Exclude<ObservabilityErrorCode, "SECURITY_SIGNAL_DETECTED">;
  message: string;
};

export type ObservabilityRecordResult =
  | ObservabilityRecordSuccess
  | ObservabilityRecordFailure;

export type CreateObservabilityServiceOptions = {
  sink: ObservabilitySink;
  /**
   * Détecteurs purs — défaut : `runDetectors` (`./detectors`).
   */
  runDetectors?: RunDetectorsFn;
  /**
   * Dérivation de métriques — défaut : `deriveMetrics` (`./metrics`).
   */
  deriveMetrics?: DeriveMetricsFn;
};

export type ObservabilityService = {
  /**
   * Valide, construit, enregistre (sink), dérive métriques / signaux / alertes.
   * Horloge via `input.now` — jamais Date.now().
   * Best-effort côté appelant Router : un échec sink ne doit pas invalider
   * le résultat métier (politique documentée hors de ce module).
   */
  record(input: unknown): Promise<ObservabilityRecordResult>;
};

export class ObservabilityError extends Error {
  readonly code: ObservabilityErrorCode;

  constructor(code: ObservabilityErrorCode, message?: string) {
    super(message ?? code);
    this.name = "ObservabilityError";
    this.code = code;
  }
}
