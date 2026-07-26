/**
 * Tests G1-E — Audit Service déterministe.
 *
 * Importe l’API production depuis `@/lib/agent/audit`.
 * Aucune I/O métier ; fixtures 100 % mémoire.
 *
 * Mapping EVAL (noms / commentaires) — catalogue non modifié ici :
 * - EVAL-TOOL-022 : acteur, outil/version, permission/décision, params_hash,
 *                   autonomie, validation, résultat, corrélation présents
 * - EVAL-OBS-001  : correlation_id + tenant + tool reliés dans l’événement
 * - EVAL-OBS-002  : qui/quoi/quand/objet/permission/autonomie/validation/résultat/versions
 * - EVAL-OBS-003  : redaction — secrets / token / PAN / stack absents
 * - EVAL-TOOL-026 : taxonomie result success|denied|approval_required|
 *                   validation_error|business_error|technical_error
 */

import { describe, expect, it } from "vitest";

import {
  AuditBuildError,
  createAuditService,
  deriveDeterministicAuditId,
  auditEventSchema,
} from "@/lib/agent/audit";

import {
  ACTOR_ID,
  CORRELATION_ID,
  EXECUTOR_ID,
  FIXED_NOW,
  FIXED_NOW_LATER,
  HUMAN_VALIDATION_ID,
  IDEMPOTENCY_KEY,
  INVOICE_1,
  OUTPUT_HASH_V1,
  OUTPUT_HASH_V2,
  PARAMS_HASH_V1,
  PARAMS_HASH_V2,
  SENSITIVE_CARD_PAN,
  SENSITIVE_RAW_FIELD,
  SENSITIVE_RAW_TOKEN,
  TENANT_A,
  approvalBuildInput,
  auditContext,
  baseAuditInput,
  businessErrorBuildInput,
  denyBuildInput,
  expectNoRawPayload,
  expectNoSensitiveLeak,
  expectStableCoreFields,
  successBuildInput,
  technicalErrorBuildInput,
  validationErrorBuildInput,
} from "./test-fixtures";

describe("Audit Service G1-E (déterministe, zéro I/O)", () => {
  // -------------------------------------------------------------------------
  // Builds nominaux — 6 issues terminales
  // -------------------------------------------------------------------------

  it("EVAL-TOOL-022 / EVAL-OBS-002: build succès — acteur, outil, hashes, résultat", () => {
    const audit = createAuditService();
    const event = audit.build(successBuildInput(), auditContext());

    expect(event.result).toBe("success");
    expect(event.decision).toBe("allow");
    expect(event.reason_code).toBe("SUCCESS");
    expect(event.timestamp).toBe(FIXED_NOW);
    expect(event.correlation_id).toBe(CORRELATION_ID);
    expect(event.tenant).toEqual({ tenant_id: TENANT_A });
    expect(event.actor).toEqual({
      actor_id: ACTOR_ID,
      actor_type: "human",
    });
    expect(event.tool).toEqual({
      tool_id: "invoice.get",
      tool_version: "1.0.0",
    });
    expect(event.mode).toBe("agir");
    expect(event.autonomy).toEqual({ requested: 1, maximum: 1 });
    expect(event.params_hash).toBe(PARAMS_HASH_V1);
    expect(event.output_hash).toBe(OUTPUT_HASH_V1);
    expect(event.executor).toBe(EXECUTOR_ID);
    expect(event.resource).toEqual({
      kind: "invoice",
      resource_id: INVOICE_1,
      tenant_id: TENANT_A,
    });
    expect(event.idempotency_key).toBe(IDEMPOTENCY_KEY);
    expect(event.duration_ms).toBe(12);
    expect(event.audit_id).toMatch(/^aud_[a-f0-9]{32}$/);

    expect(auditEventSchema.safeParse(event).success).toBe(true);
    expectNoSensitiveLeak(event);
    expectNoRawPayload(event);
  });

  it("build deny — décision deny / result denied (EVAL-TOOL-026 taxonomie)", () => {
    const audit = createAuditService();
    const event = audit.build(denyBuildInput(), auditContext());

    expect(event.result).toBe("denied");
    expect(event.decision).toBe("deny");
    expect(event.reason_code).toBe("PERMISSION_MISSING");
    expect(event.executor).toBeNull();
    expect(event.output_hash).toBeUndefined();
    expect(event.params_hash).toBe(PARAMS_HASH_V1);
    expectNoSensitiveLeak(event);
  });

  it("build approval (require_approval) — VALIDATION_REQUIRED", () => {
    const audit = createAuditService();
    const event = audit.build(approvalBuildInput(), auditContext());

    expect(event.result).toBe("approval_required");
    expect(event.decision).toBe("require_approval");
    expect(event.reason_code).toBe("VALIDATION_REQUIRED");
    expect(event.human_validation_id).toBe(HUMAN_VALIDATION_ID);
    expect(event.executor).toBeNull();
    expect(event.output_hash).toBeUndefined();
    expectNoSensitiveLeak(event);
  });

  it("build erreur validation — decision none / INVALID_ARGUMENT", () => {
    const audit = createAuditService();
    const event = audit.build(validationErrorBuildInput(), auditContext());

    expect(event.result).toBe("validation_error");
    expect(event.decision).toBe("none");
    expect(event.reason_code).toBe("INVALID_ARGUMENT");
    expect(event.executor).toBeNull();
    expectNoSensitiveLeak(event);
  });

  it("build erreur métier — EXECUTOR_BUSINESS_ERROR", () => {
    const audit = createAuditService();
    const event = audit.build(businessErrorBuildInput(), auditContext());

    expect(event.result).toBe("business_error");
    expect(event.decision).toBe("allow");
    expect(event.reason_code).toBe("EXECUTOR_BUSINESS_ERROR");
    expect(event.executor).toBe(EXECUTOR_ID);
    expect(event.output_hash).toBeUndefined();
    expectNoSensitiveLeak(event);
  });

  it("build erreur technique — EXECUTOR_TECHNICAL_ERROR", () => {
    const audit = createAuditService();
    const event = audit.build(technicalErrorBuildInput(), auditContext());

    expect(event.result).toBe("technical_error");
    expect(event.decision).toBe("allow");
    expect(event.reason_code).toBe("EXECUTOR_TECHNICAL_ERROR");
    expect(event.executor).toBe(EXECUTOR_ID);
    expectNoSensitiveLeak(event);
  });

  // -------------------------------------------------------------------------
  // Horloge injectée / déterminisme / hashes
  // -------------------------------------------------------------------------

  it("timestamp injecté (pas d’horloge globale) — now du contexte recopié", () => {
    const audit = createAuditService();
    const earlier = audit.build(
      successBuildInput(),
      auditContext({ now: FIXED_NOW }),
    );
    const later = audit.build(
      successBuildInput(),
      auditContext({ now: FIXED_NOW_LATER }),
    );

    expect(earlier.timestamp).toBe(FIXED_NOW);
    expect(later.timestamp).toBe(FIXED_NOW_LATER);
    expect(earlier.audit_id).not.toBe(later.audit_id);
  });

  it("déterminisme — mêmes inputs → même event (audit_id dérivé déterministe)", () => {
    const audit = createAuditService();
    const input = successBuildInput();
    const context = auditContext();

    const a = audit.build(input, context);
    const b = audit.build(structuredClone(input), structuredClone(context));

    expectStableCoreFields(a, b);
    expect(a).toEqual(b);

    // Hypothèse confirmée par la prod : audit_id = aud_<sha256[..32]> dérivé
    // des champs stables + timestamp (pas d’UUID aléatoire).
    const expectedId = deriveDeterministicAuditId(
      {
        correlation_id: input.correlation_id,
        tenant: input.tenant,
        actor: input.actor,
        tool: input.tool,
        mode: input.mode,
        autonomy: input.autonomy,
        decision: input.decision,
        result: input.result,
        reason_code: input.reason_code,
        duration_ms: input.duration_ms,
        resource: input.resource,
        params_hash: input.params_hash ?? null,
        executor: input.executor ?? null,
        output_hash: input.output_hash,
        human_validation_id: input.human_validation_id,
        idempotency_key: input.idempotency_key,
      },
      FIXED_NOW,
    );
    expect(a.audit_id).toBe(expectedId);
  });

  it("audit_id fourni explicitement est conservé (override déterministe)", () => {
    const audit = createAuditService();
    const event = audit.build(
      successBuildInput({ audit_id: "aud_explicit_fixed_id_001" }),
      auditContext(),
    );
    expect(event.audit_id).toBe("aud_explicit_fixed_id_001");
  });

  it("hash stable — params_hash / output_hash recopiés sans altération", () => {
    const audit = createAuditService();
    const withV1 = audit.build(
      successBuildInput({
        params_hash: PARAMS_HASH_V1,
        output_hash: OUTPUT_HASH_V1,
      }),
      auditContext(),
    );
    const withV2 = audit.build(
      successBuildInput({
        params_hash: PARAMS_HASH_V2,
        output_hash: OUTPUT_HASH_V2,
      }),
      auditContext(),
    );

    expect(withV1.params_hash).toBe(PARAMS_HASH_V1);
    expect(withV1.output_hash).toBe(OUTPUT_HASH_V1);
    expect(withV2.params_hash).toBe(PARAMS_HASH_V2);
    expect(withV2.output_hash).toBe(OUTPUT_HASH_V2);

    // Même hash en entrée → même hash en sortie (identité, pas de re-hash).
    const again = audit.build(
      successBuildInput({
        params_hash: PARAMS_HASH_V1,
        output_hash: OUTPUT_HASH_V1,
      }),
      auditContext(),
    );
    expect(again.params_hash).toBe(withV1.params_hash);
    expect(again.output_hash).toBe(withV1.output_hash);
  });

  it("params_hash null explicite → null dans l’événement (pas de payload)", () => {
    const audit = createAuditService();
    const event = audit.build(
      baseAuditInput({ params_hash: null, executor: null }),
      auditContext(),
    );
    expect(event.params_hash).toBeNull();
    expect(event.executor).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Sécurité / redaction / schéma strict / immutabilité
  // -------------------------------------------------------------------------

  it("EVAL-OBS-003: aucun secret exposé — poison token/PAN refusé à l’entrée", () => {
    const audit = createAuditService();

    for (const poison of [
      { secret: SENSITIVE_RAW_TOKEN },
      { token: SENSITIVE_RAW_TOKEN },
      { [SENSITIVE_RAW_FIELD]: SENSITIVE_CARD_PAN },
      { stack: "Error\n    at Object.build" },
      { arguments: { api_key: SENSITIVE_RAW_TOKEN } },
      { payload: { card: SENSITIVE_CARD_PAN } },
      { output: { raw: SENSITIVE_RAW_TOKEN } },
    ]) {
      expect(() =>
        audit.build({ ...successBuildInput(), ...poison }, auditContext()),
      ).toThrow(AuditBuildError);

      try {
        audit.build({ ...successBuildInput(), ...poison }, auditContext());
        expect.unreachable("devait lever");
      } catch (err) {
        expect(err).toBeInstanceOf(AuditBuildError);
        expect((err as AuditBuildError).code).toBe("AUDIT_INPUT_INVALID");
        expectNoSensitiveLeak(err);
        expect(JSON.stringify(err)).not.toContain(SENSITIVE_RAW_TOKEN);
        expect(JSON.stringify(err)).not.toContain(SENSITIVE_CARD_PAN);
      }
    }
  });

  it("EVAL-OBS-003: output sensible absent — seul output_hash, jamais la sortie", () => {
    const audit = createAuditService();
    const event = audit.build(successBuildInput(), auditContext());

    expect(event.output_hash).toBe(OUTPUT_HASH_V1);
    expectNoRawPayload(event);

    // Tenter d’injecter une sortie brute → refus schéma strict.
    expect(() =>
      audit.build(
        {
          ...successBuildInput(),
          raw_output: { invoice_id: INVOICE_1, secret: SENSITIVE_RAW_TOKEN },
        },
        auditContext(),
      ),
    ).toThrow(AuditBuildError);
  });

  it("schéma strict — champs inconnus refusés (AUDIT_INPUT_INVALID)", () => {
    const audit = createAuditService();

    for (const poison of [
      { prompt_says_allowed: true },
      { llm_says_allowed: true },
      { claimed_permission: "invoice.read" },
      { claimed_role: "owner" },
      { extra_field: "nope" },
    ]) {
      try {
        audit.build({ ...successBuildInput(), ...poison }, auditContext());
        expect.unreachable("devait lever");
      } catch (err) {
        expect(err).toBeInstanceOf(AuditBuildError);
        expect((err as AuditBuildError).code).toBe("AUDIT_INPUT_INVALID");
      }
    }
  });

  it("schéma strict — contexte sans now → AUDIT_CONTEXT_INVALID", () => {
    const audit = createAuditService();
    try {
      audit.build(successBuildInput(), {});
      expect.unreachable("devait lever");
    } catch (err) {
      expect(err).toBeInstanceOf(AuditBuildError);
      expect((err as AuditBuildError).code).toBe("AUDIT_CONTEXT_INVALID");
    }
  });

  it("schéma strict — champ inconnu dans le contexte refusé", () => {
    const audit = createAuditService();
    try {
      audit.build(successBuildInput(), {
        now: FIXED_NOW,
        clock_skew_ms: 5,
      });
      expect.unreachable("devait lever");
    } catch (err) {
      expect(err).toBeInstanceOf(AuditBuildError);
      expect((err as AuditBuildError).code).toBe("AUDIT_CONTEXT_INVALID");
    }
  });

  it("mutation interdite — inputs / contexte non mutés", () => {
    const audit = createAuditService();
    const input = successBuildInput();
    const context = auditContext();
    const inputSnapshot = structuredClone(input);
    const contextSnapshot = structuredClone(context);

    audit.build(input, context);

    expect(input).toEqual(inputSnapshot);
    expect(context).toEqual(contextSnapshot);
  });

  it("EVAL-OBS-001: corrélation / tenant / outil présents et cohérents", () => {
    const audit = createAuditService();
    const event = audit.build(
      successBuildInput({
        correlation_id: "corr_e2e_obs001",
        tenant: { tenant_id: TENANT_A },
        tool: { tool_id: "invoice.get", tool_version: "1.0.0" },
      }),
      auditContext(),
    );

    expect(event.correlation_id).toBe("corr_e2e_obs001");
    expect(event.tenant.tenant_id).toBe(TENANT_A);
    expect(event.tool.tool_id).toBe("invoice.get");
    expect(event.tool.tool_version).toBe("1.0.0");
  });

  it("outil non résolu (tool_id null) accepté pour échec précoce", () => {
    const audit = createAuditService();
    const event = audit.build(
      validationErrorBuildInput({
        tool: { tool_id: null, tool_version: null },
        reason_code: "TOOL_UNKNOWN",
        result: "technical_error",
        decision: "none",
      }),
      auditContext(),
    );

    expect(event.tool.tool_id).toBeNull();
    expect(event.tool.tool_version).toBeNull();
    expect(event.reason_code).toBe("TOOL_UNKNOWN");
    expect(event.result).toBe("technical_error");
  });
});
