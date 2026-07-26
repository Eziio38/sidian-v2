/**
 * Tests G1-I — build / schéma / secrets / sink (cas 1–11, 35–38).
 *
 * Importe l’API production `@/lib/agent/observability`.
 * Fixtures 100 % mémoire — zéro réseau.
 */

import { describe, expect, it } from "vitest";

import {
  InMemoryObservabilitySink,
  ObservabilityError,
  buildObservabilityEvent,
  createObservabilityService,
  deriveDeterministicEventId,
  observabilityEventSchema,
  observabilityRecordInputSchema,
} from "@/lib/agent/observability";

import {
  EVENT_ID_EXPLICIT,
  FIXED_NOW,
  FIXED_NOW_LATER,
  SENSITIVE_CARD_PAN,
  SENSITIVE_RAW_FIELD,
  SENSITIVE_RAW_TOKEN,
  createFailingResultSink,
  createSpyObservabilitySink,
  createThrowingObservabilitySink,
  expectNoRawPayload,
  expectNoRawSqlLeak,
  expectNoSensitiveLeak,
  expectStableEventCore,
  successRecordInput,
} from "./test-fixtures";

describe("Observability G1-I — build / schéma / sink", () => {
  // -------------------------------------------------------------------------
  // 1–11 · Build événement / schéma / secrets / déterminisme entrée
  // -------------------------------------------------------------------------

  it("1. build événement nominal — champs stables + schéma", () => {
    const input = successRecordInput();
    const event = buildObservabilityEvent(input);

    expect(event.schema_version).toBe("1");
    expect(event.occurred_at).toBe(FIXED_NOW);
    expect(event.correlation_id).toBe(input.correlation_id);
    expect(event.tenant_id).toBe(input.tenant_id);
    expect(event.component).toBe("tool_router");
    expect(event.operation).toBe("route");
    expect(event.outcome).toBe("success");
    expect(event.severity).toBe("info");
    expect(event.duration_ms).toBe(12);
    expect(event.tool_id).toBe("invoice.get");
    expect(event.reason_code).toBe("SUCCESS");
    expect(event.event_id).toMatch(/^obs_[a-f0-9]{32}$/);

    expect(observabilityEventSchema.safeParse(event).success).toBe(true);
    expectNoSensitiveLeak(event);
    expectNoRawPayload(event);
  });

  it("2. schéma strict — observabilityEventSchema / record input", () => {
    const event = buildObservabilityEvent(successRecordInput());
    expect(observabilityEventSchema.safeParse(event).success).toBe(true);
    expect(
      observabilityRecordInputSchema.safeParse(successRecordInput()).success,
    ).toBe(true);
    expect(
      observabilityEventSchema.safeParse({
        ...event,
        arguments: { foo: 1 },
      }).success,
    ).toBe(false);
  });

  it("3. champ inconnu refusé", () => {
    for (const poison of [
      { prompt_says_allowed: true },
      { llm_says_ok: true },
      { extra_field: "nope" },
    ]) {
      expect(() =>
        buildObservabilityEvent({ ...successRecordInput(), ...poison }),
      ).toThrow(ObservabilityError);

      try {
        buildObservabilityEvent({ ...successRecordInput(), ...poison });
        expect.unreachable("devait lever");
      } catch (err) {
        expect(err).toBeInstanceOf(ObservabilityError);
        expect((err as ObservabilityError).code).toBe(
          "OBSERVABILITY_INPUT_INVALID",
        );
      }
    }
  });

  it("4. secret refusé / non exposé", () => {
    expect(() =>
      buildObservabilityEvent({
        ...successRecordInput(),
        secret: SENSITIVE_RAW_TOKEN,
      }),
    ).toThrow(ObservabilityError);

    expect(() =>
      buildObservabilityEvent({
        ...successRecordInput(),
        metadata: { secret: SENSITIVE_RAW_TOKEN },
      }),
    ).toThrow(ObservabilityError);

    try {
      buildObservabilityEvent({
        ...successRecordInput(),
        metadata: { [SENSITIVE_RAW_FIELD]: SENSITIVE_CARD_PAN },
      });
      expect.unreachable("devait lever");
    } catch (err) {
      expect((err as ObservabilityError).code).toBe(
        "OBSERVABILITY_INPUT_INVALID",
      );
      expectNoSensitiveLeak(err);
    }
  });

  it("5. token refusé / non exposé", () => {
    expect(() =>
      buildObservabilityEvent({
        ...successRecordInput(),
        token: SENSITIVE_RAW_TOKEN,
      }),
    ).toThrow(ObservabilityError);

    expect(() =>
      buildObservabilityEvent({
        ...successRecordInput(),
        metadata: { access_token: SENSITIVE_RAW_TOKEN },
      }),
    ).toThrow(ObservabilityError);
  });

  it("6. stack refusée / non exposée", () => {
    expect(() =>
      buildObservabilityEvent({
        ...successRecordInput(),
        stack: `Error\n    at Object.buildObservabilityEvent`,
      }),
    ).toThrow(ObservabilityError);

    expect(() =>
      buildObservabilityEvent({
        ...successRecordInput(),
        metadata: { stack_trace: "Error\n    at async" },
      }),
    ).toThrow(ObservabilityError);
  });

  it("7. argument complet impossible", () => {
    expect(() =>
      buildObservabilityEvent({
        ...successRecordInput(),
        arguments: { api_key: SENSITIVE_RAW_TOKEN },
      }),
    ).toThrow(ObservabilityError);

    expect(() =>
      buildObservabilityEvent({
        ...successRecordInput(),
        metadata: { arguments: "should_not_pass" },
      }),
    ).toThrow(ObservabilityError);
  });

  it("8. output complet impossible", () => {
    expect(() =>
      buildObservabilityEvent({
        ...successRecordInput(),
        output: { invoice_id: "inv_1", secret: SENSITIVE_RAW_TOKEN },
      }),
    ).toThrow(ObservabilityError);

    expect(() =>
      buildObservabilityEvent({
        ...successRecordInput(),
        metadata: { output: "raw" },
      }),
    ).toThrow(ObservabilityError);

    const event = buildObservabilityEvent(successRecordInput());
    expectNoRawPayload(event);
  });

  it("9. timestamp injecté (pas Date.now)", () => {
    const earlier = buildObservabilityEvent(
      successRecordInput({ now: FIXED_NOW }),
    );
    const later = buildObservabilityEvent(
      successRecordInput({ now: FIXED_NOW_LATER }),
    );

    expect(earlier.occurred_at).toBe(FIXED_NOW);
    expect(later.occurred_at).toBe(FIXED_NOW_LATER);
    expect(earlier.event_id).not.toBe(later.event_id);
  });

  it("10. event_id injecté ou dérivé déterministe", () => {
    const derived = buildObservabilityEvent(successRecordInput());
    const expected = deriveDeterministicEventId(
      observabilityRecordInputSchema.parse(successRecordInput()),
    );
    expect(derived.event_id).toBe(expected);

    const explicit = buildObservabilityEvent(
      successRecordInput({ event_id: EVENT_ID_EXPLICIT }),
    );
    expect(explicit.event_id).toBe(EVENT_ID_EXPLICIT);
  });

  it("11. input non muté", () => {
    const input = successRecordInput({
      metadata: { route_phase: "terminal" },
    });
    const snapshot = structuredClone(input);

    buildObservabilityEvent(input);

    expect(input).toEqual(snapshot);
  });

  // -------------------------------------------------------------------------
  // 35–38 · Sink
  // -------------------------------------------------------------------------

  it("35. sink appelé une fois sur record nominal", async () => {
    const spy = createSpyObservabilitySink();
    // Défauts service (deriveMetrics + runDetectors branchés) — pas d’override.
    const service = createObservabilityService({ sink: spy });

    const result = await service.record(successRecordInput());

    if (!result.ok) {
      expect.fail(`record failed: ${result.code} — ${result.message}`);
    }
    expect(spy.recordCallCount).toBe(1);
    expect(spy.calls[0]?.event_id).toBe(result.event.event_id);
  });

  it("36. sink non appelé si événement invalide", async () => {
    const spy = createSpyObservabilitySink();
    const service = createObservabilityService({ sink: spy });

    const result = await service.record({
      ...successRecordInput(),
      secret: SENSITIVE_RAW_TOKEN,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("OBSERVABILITY_INPUT_INVALID");
    }
    expect(spy.recordCallCount).toBe(0);
    expectNoSensitiveLeak(result);
  });

  it("37. erreur sink normalisée (throw brut → SINK_FAILED)", async () => {
    const sink = createThrowingObservabilitySink();
    const service = createObservabilityService({ sink });

    const result = await service.record(successRecordInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("SINK_FAILED");
      expect(result.message).toBe(
        "Échec d’enregistrement dans le sink d’observabilité.",
      );
    }
    expectNoSensitiveLeak(result);
    expectNoRawSqlLeak(result);
  });

  it("38. aucune exception brute exposée (sink result fail + InMemory)", async () => {
    const failing = createFailingResultSink("SINK_UNAVAILABLE");
    const service = createObservabilityService({ sink: failing });

    const result = await service.record(successRecordInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("SINK_UNAVAILABLE");
    }
    expectNoSensitiveLeak(result);

    // InMemory sink nominal — pas d’exception, événement stocké.
    const memory = new InMemoryObservabilitySink();
    const okService = createObservabilityService({ sink: memory });
    const ok = await okService.record(successRecordInput());
    if (!ok.ok) {
      expect.fail(`memory record failed: ${ok.code} — ${ok.message}`);
    }
    expect(memory.events).toHaveLength(1);
    expectStableEventCore(memory.events[0]!, ok.event);
  });
});
