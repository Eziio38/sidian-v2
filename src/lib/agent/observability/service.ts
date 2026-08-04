/**
 * Observability Service déterministe (G1-I).
 * Valide → construit → sink → métriques → détecteurs → alert candidates.
 * Horloge via `input.now` — jamais Date.now().
 * Aucun réseau, aucune console implicite, aucun OTel/Datadog.
 *
 * Branche Task B :
 * - `./detectors` → `runDetectors`
 * - `./metrics` → `deriveMetrics`
 */

import { buildAlertCandidates } from "./alert-candidates";
import { runDetectors as defaultDetectors } from "./detectors";
import { buildObservabilityEvent } from "./event-builder";
import { deriveMetrics as defaultMetricsDerive } from "./metrics";
import { OBSERVABILITY_SAFE_MESSAGES } from "./reason-codes";
import { observabilityRecordInputSchema } from "./schemas";
import { isInMemoryObservabilitySink } from "./sink";
import type {
  CreateObservabilityServiceOptions,
  DeriveMetricsFn,
  DetectionWindow,
  MetricPoint,
  ObservabilityEvent,
  ObservabilityRecordResult,
  ObservabilityService,
  RunDetectorsFn,
  SecuritySignal,
} from "./types";
import { ObservabilityError } from "./types";

const defaultRunDetectors: RunDetectorsFn = (input) =>
  defaultDetectors(input);

/** Défaut = contrat metrics Task B (`DeriveMetricsInput`). */
const defaultDeriveMetrics: DeriveMetricsFn = (input) =>
  defaultMetricsDerive(input);
function resolveHistory(
  sink: CreateObservabilityServiceOptions["sink"],
  current: ObservabilityEvent,
): ObservabilityEvent[] {
  if (isInMemoryObservabilitySink(sink)) {
    const snapshot = sink.snapshot();
    const hasCurrent = snapshot.some((e) => e.event_id === current.event_id);
    return hasCurrent ? snapshot : [...snapshot, current];
  }
  return [current];
}

function filterTenantEvents(
  events: ObservabilityEvent[],
  tenantId: string,
): ObservabilityEvent[] {
  return events.filter((event) => event.tenant_id === tenantId);
}

function resolveWindow(
  inputWindow: DetectionWindow | undefined,
  now: string,
): DetectionWindow {
  if (inputWindow) {
    return { start: inputWindow.start, end: inputWindow.end };
  }
  return { start: now, end: now };
}

function safeDeriveMetrics(
  deriveMetricsFn: DeriveMetricsFn,
  event: ObservabilityEvent,
  events: ObservabilityEvent[],
): { ok: true; metrics: MetricPoint[] } | { ok: false } {
  try {
    const metrics = deriveMetricsFn({ event, events });
    if (!Array.isArray(metrics)) {
      return { ok: false };
    }
    return { ok: true, metrics: [...metrics] };
  } catch {
    return { ok: false };
  }
}

function safeRunDetectors(
  runDetectorsFn: RunDetectorsFn,
  args: Parameters<RunDetectorsFn>[0],
): SecuritySignal[] {
  try {
    const signals = runDetectorsFn(args);
    return Array.isArray(signals) ? [...signals] : [];
  } catch {
    // Détection best-effort : un plantage détecteur ne fait pas échouer record().
    return [];
  }
}

/**
 * Crée un Observability Service.
 * API minimale : `createObservabilityService({ sink })`.
 * Options `runDetectors` / `deriveMetrics` surchargables (tests).
 */
export function createObservabilityService(
  options: CreateObservabilityServiceOptions,
): ObservabilityService {
  const sink = options.sink;
  if (!sink || typeof sink.record !== "function") {
    throw new ObservabilityError(
      "SINK_UNAVAILABLE",
      OBSERVABILITY_SAFE_MESSAGES.SINK_UNAVAILABLE,
    );
  }

  const runDetectorsFn = options.runDetectors ?? defaultRunDetectors;
  const deriveMetricsFn = options.deriveMetrics ?? defaultDeriveMetrics;

  return {
    async record(input: unknown): Promise<ObservabilityRecordResult> {
      const parsed = observabilityRecordInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          code: "OBSERVABILITY_INPUT_INVALID",
          message: OBSERVABILITY_SAFE_MESSAGES.OBSERVABILITY_INPUT_INVALID,
        };
      }

      let event: ObservabilityEvent;
      try {
        event = buildObservabilityEvent(parsed.data);
      } catch (error) {
        if (error instanceof ObservabilityError) {
          if (
            error.code === "OBSERVABILITY_INPUT_INVALID" ||
            error.code === "EVENT_BUILD_FAILED"
          ) {
            return {
              ok: false,
              code: error.code,
              message: error.message,
            };
          }
        }
        return {
          ok: false,
          code: "EVENT_BUILD_FAILED",
          message: OBSERVABILITY_SAFE_MESSAGES.EVENT_BUILD_FAILED,
        };
      }

      let sinkResult;
      try {
        sinkResult = await sink.record(event);
      } catch {
        return {
          ok: false,
          code: "SINK_FAILED",
          message: OBSERVABILITY_SAFE_MESSAGES.SINK_FAILED,
        };
      }

      if (!sinkResult || typeof sinkResult.ok !== "boolean") {
        return {
          ok: false,
          code: "SINK_UNAVAILABLE",
          message: OBSERVABILITY_SAFE_MESSAGES.SINK_UNAVAILABLE,
        };
      }

      if (!sinkResult.ok) {
        return {
          ok: false,
          code:
            sinkResult.code === "SINK_UNAVAILABLE"
              ? "SINK_UNAVAILABLE"
              : "SINK_FAILED",
          message:
            sinkResult.message || OBSERVABILITY_SAFE_MESSAGES.SINK_FAILED,
        };
      }

      const history = filterTenantEvents(
        resolveHistory(sink, event),
        event.tenant_id,
      );

      const metricsResult = safeDeriveMetrics(
        deriveMetricsFn,
        event,
        history,
      );
      if (!metricsResult.ok) {
        return {
          ok: false,
          code: "METRIC_DERIVATION_FAILED",
          message: OBSERVABILITY_SAFE_MESSAGES.METRIC_DERIVATION_FAILED,
        };
      }

      const window = resolveWindow(
        parsed.data.detection_window,
        parsed.data.now,
      );
      const signals = safeRunDetectors(runDetectorsFn, {
        events: history,
        window,
        thresholds: parsed.data.thresholds,
        now: parsed.data.now,
      });

      const alert_candidates = buildAlertCandidates(signals);

      if (signals.length > 0) {
        return {
          ok: true,
          event,
          metrics: metricsResult.metrics,
          signals,
          alert_candidates,
          code: "SECURITY_SIGNAL_DETECTED",
          message: OBSERVABILITY_SAFE_MESSAGES.SECURITY_SIGNAL_DETECTED,
        };
      }

      return {
        ok: true,
        event,
        metrics: metricsResult.metrics,
        signals,
        alert_candidates,
      };
    },
  };
}
