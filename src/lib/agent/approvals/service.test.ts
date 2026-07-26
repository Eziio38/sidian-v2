/**
 * Tests G1-H — HumanApprovalService (request / decide / inspect / consume).
 *
 * Importe l’API production `@/lib/agent/approvals`.
 * Repository mémoire injecté — zéro réseau.
 *
 * Couverture unitaire :
 * 1 création pending · 2 expiration valide · 3 expiration invalide
 * 4 approve · 5 reject · 6 acteur absent · 7 inconnue · 8 terminale
 * 9–12 inspect · 13–25 consume · 26 unavailable · 27 SQL masqué
 * 28 input non muté · 29 pas de secret · 30 pas d’arguments complets
 */

import { describe, expect, it } from "vitest";

import {
  APPROVAL_SAFE_MESSAGES,
  ApprovalError,
  createHumanApprovalService,
  createSupabaseApprovalRepository,
} from "@/lib/agent/approvals";

import {
  APPROVAL_ID_UNKNOWN,
  DECIDER_ACTOR_ID,
  FIXED_EXPIRES_AT,
  FIXED_EXPIRES_AT_INVALID,
  FIXED_NOW,
  FIXED_NOW_AFTER_EXPIRY,
  FIXED_NOW_WITHIN_TTL,
  FULL_ARGUMENTS_PAYLOAD,
  INVOICE_2,
  RAW_SQL_DETAIL,
  SENSITIVE_RAW_TOKEN,
  SENSITIVE_STACK_FRAGMENT,
  TENANT_A_UUID,
  TENANT_B_UUID,
  TTL_SECONDS,
  approveDecisionInput,
  baseConsumeInput,
  baseRequestInput,
  createMemoryApprovalRepository,
  createSpyApprovalRpcClient,
  crossTenantConsume,
  expectNoRawPayload,
  expectNoRawSqlLeak,
  expectNoSecretStored,
  expectNoSensitiveLeak,
  fingerprintMismatchConsume,
  inspectInput,
  paramsMismatchConsume,
  rejectDecisionInput,
  requestWithTtl,
  sqlUnavailableError,
} from "./test-fixtures";

async function createApproved(
  repo = createMemoryApprovalRepository(),
  now = FIXED_NOW,
) {
  const service = createHumanApprovalService(repo);
  const created = await service.request(baseRequestInput({ now }));
  const decided = await service.decide(
    approveDecisionInput(created.approval_id, { now }),
  );
  return { repo, service, created, decided };
}

describe("HumanApprovalService G1-H (request/decide/inspect/consume)", () => {
  // -------------------------------------------------------------------------
  // 1–3 · Création / expiration
  // -------------------------------------------------------------------------

  it("1. création nominale → pending + approval_id + expires_at", async () => {
    const repo = createMemoryApprovalRepository();
    const service = createHumanApprovalService(repo);

    const result = await service.request(baseRequestInput());

    expect(result.status).toBe("pending");
    expect(result.approval_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(result.requested_at).toBe(FIXED_NOW);
    expect(result.expires_at).toBe(FIXED_EXPIRES_AT);
    expect(repo.getById(result.approval_id)?.status).toBe("pending");
    expect(repo.createCalls).toHaveLength(1);
  });

  it("2. expiration valide acceptée (expires_at ou ttl_seconds)", async () => {
    const repo = createMemoryApprovalRepository();
    const service = createHumanApprovalService(repo);

    const viaAbsolute = await service.request(baseRequestInput());
    expect(viaAbsolute.expires_at).toBe(FIXED_EXPIRES_AT);

    const viaTtl = await service.request(requestWithTtl());
    expect(Date.parse(viaTtl.expires_at)).toBe(
      Date.parse(FIXED_NOW) + TTL_SECONDS * 1000,
    );
  });

  it("3. expiration invalide refusée — APPROVAL_INPUT_INVALID", async () => {
    const repo = createMemoryApprovalRepository();
    const service = createHumanApprovalService(repo);

    await expect(
      service.request(
        baseRequestInput({ expires_at: FIXED_EXPIRES_AT_INVALID }),
      ),
    ).rejects.toMatchObject({
      name: "ApprovalError",
      code: "APPROVAL_INPUT_INVALID",
    });

    const { expires_at: _drop, ttl_seconds: _ttl, ...noExpiry } =
      baseRequestInput();
    void _drop;
    void _ttl;
    await expect(service.request(noExpiry as never)).rejects.toMatchObject({
      code: "APPROVAL_INPUT_INVALID",
    });

    expect(repo.createCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 4–8 · Décision
  // -------------------------------------------------------------------------

  it("4. décision approve → status approved", async () => {
    const repo = createMemoryApprovalRepository();
    const service = createHumanApprovalService(repo);
    const created = await service.request(baseRequestInput());

    const decided = await service.decide(
      approveDecisionInput(created.approval_id),
    );

    expect(decided).toEqual({
      approval_id: created.approval_id,
      status: "approved",
      decision: "approve",
      decided_at: FIXED_NOW,
    });
    expect(repo.getById(created.approval_id)?.status).toBe("approved");
    expect(repo.getById(created.approval_id)?.decided_by_actor_id).toBe(
      DECIDER_ACTOR_ID,
    );
  });

  it("5. décision reject → status rejected", async () => {
    const repo = createMemoryApprovalRepository();
    const service = createHumanApprovalService(repo);
    const created = await service.request(baseRequestInput());

    const decided = await service.decide(
      rejectDecisionInput(created.approval_id),
    );

    expect(decided.status).toBe("rejected");
    expect(decided.decision).toBe("reject");
    expect(repo.getById(created.approval_id)?.status).toBe("rejected");
  });

  it("6. acteur décideur absent refusé", async () => {
    const repo = createMemoryApprovalRepository();
    const service = createHumanApprovalService(repo);
    const created = await service.request(baseRequestInput());

    await expect(
      service.decide(
        approveDecisionInput(created.approval_id, {
          decided_by_actor_id: "",
        }),
      ),
    ).rejects.toMatchObject({
      code: "APPROVAL_INPUT_INVALID",
    });

    await expect(
      service.decide(
        approveDecisionInput(created.approval_id, {
          decided_by_actor_id: "   ",
        }),
      ),
    ).rejects.toMatchObject({
      code: "APPROVAL_ACTOR_UNAUTHORIZED",
    });

    expect(repo.getById(created.approval_id)?.status).toBe("pending");
  });

  it("7. décision sur approval inconnue → APPROVAL_NOT_FOUND", async () => {
    const repo = createMemoryApprovalRepository();
    const service = createHumanApprovalService(repo);

    await expect(
      service.decide(approveDecisionInput(APPROVAL_ID_UNKNOWN)),
    ).rejects.toMatchObject({
      name: "ApprovalError",
      code: "APPROVAL_NOT_FOUND",
      message: APPROVAL_SAFE_MESSAGES.APPROVAL_NOT_FOUND,
    });
  });

  it("8. décision sur approval terminale refusée", async () => {
    const { repo, service, created } = await createApproved();
    await service.consume(baseConsumeInput(created.approval_id));

    await expect(
      service.decide(approveDecisionInput(created.approval_id)),
    ).rejects.toMatchObject({
      code: "APPROVAL_ALREADY_CONSUMED",
    });

    const rejected = await service.request(baseRequestInput());
    await service.decide(rejectDecisionInput(rejected.approval_id));
    await expect(
      service.decide(approveDecisionInput(rejected.approval_id)),
    ).rejects.toMatchObject({
      code: "APPROVAL_DECISION_FAILED",
    });

    expect(repo.getById(rejected.approval_id)?.status).toBe("rejected");
  });

  // -------------------------------------------------------------------------
  // 9–12 · Inspect
  // -------------------------------------------------------------------------

  it("9. inspect pending", async () => {
    const repo = createMemoryApprovalRepository();
    const service = createHumanApprovalService(repo);
    const created = await service.request(baseRequestInput());

    const inspection = await service.inspect(inspectInput(created.approval_id));
    expect(inspection.found).toBe(true);
    if (!inspection.found) return;
    expect(inspection.status).toBe("pending");
    expect(inspection.approval_id).toBe(created.approval_id);
    expect(inspection.logically_expired).toBeUndefined();
  });

  it("10. inspect approved", async () => {
    const { service, created } = await createApproved();
    const inspection = await service.inspect(inspectInput(created.approval_id));
    expect(inspection.found).toBe(true);
    if (!inspection.found) return;
    expect(inspection.status).toBe("approved");
    expect(inspection.decided_by_actor_id).toBe(DECIDER_ACTOR_ID);
  });

  it("11. inspect rejected", async () => {
    const repo = createMemoryApprovalRepository();
    const service = createHumanApprovalService(repo);
    const created = await service.request(baseRequestInput());
    await service.decide(rejectDecisionInput(created.approval_id));

    const inspection = await service.inspect(inspectInput(created.approval_id));
    expect(inspection.found).toBe(true);
    if (!inspection.found) return;
    expect(inspection.status).toBe("rejected");
  });

  it("12. inspect expired (overlay logique)", async () => {
    const repo = createMemoryApprovalRepository();
    const service = createHumanApprovalService(repo);
    const created = await service.request(baseRequestInput());

    const inspection = await service.inspect(
      inspectInput(created.approval_id, { now: FIXED_NOW_AFTER_EXPIRY }),
    );
    expect(inspection.found).toBe(true);
    if (!inspection.found) return;
    expect(inspection.status).toBe("expired");
    expect(inspection.logically_expired).toBe(true);
    // Ligne mémoire encore pending — overlay pure côté service.
    expect(repo.getById(created.approval_id)?.status).toBe("pending");
  });

  // -------------------------------------------------------------------------
  // 13–25 · Consume
  // -------------------------------------------------------------------------

  it("13. consommation nominale → consumed", async () => {
    const { repo, service, created } = await createApproved();

    const result = await service.consume(baseConsumeInput(created.approval_id));
    expect(result).toEqual({
      outcome: "consumed",
      approval_id: created.approval_id,
      status: "consumed",
      consumed_at: FIXED_NOW,
    });
    expect(repo.getById(created.approval_id)?.status).toBe("consumed");
    expect(
      repo.getById(created.approval_id)?.consumed_by_correlation_id,
    ).toBeTruthy();
  });

  it("14. même approval consommée deux fois → already_consumed", async () => {
    const { service, created } = await createApproved();

    const first = await service.consume(baseConsumeInput(created.approval_id));
    expect(first.outcome).toBe("consumed");

    const second = await service.consume(baseConsumeInput(created.approval_id));
    expect(second).toMatchObject({
      outcome: "already_consumed",
      code: "APPROVAL_ALREADY_CONSUMED",
      approval_id: created.approval_id,
    });
  });

  it("15. fingerprint différent → scope_mismatch", async () => {
    const { service, created } = await createApproved();
    const result = await service.consume(
      fingerprintMismatchConsume(created.approval_id),
    );
    expect(result).toMatchObject({
      outcome: "scope_mismatch",
      code: "APPROVAL_SCOPE_MISMATCH",
    });
  });

  it("16. params_hash différent → params_mismatch", async () => {
    const { service, created } = await createApproved();
    const result = await service.consume(
      paramsMismatchConsume(created.approval_id),
    );
    expect(result).toMatchObject({
      outcome: "params_mismatch",
      code: "APPROVAL_PARAMS_MISMATCH",
    });
  });

  it("17. tenant différent → not_found / refus", async () => {
    const { service, created } = await createApproved();
    const result = await service.consume(
      crossTenantConsume(created.approval_id),
    );
    expect(result).toMatchObject({
      outcome: "not_found",
      code: "APPROVAL_NOT_FOUND",
    });
  });

  it("18. outil différent → scope_mismatch", async () => {
    const { service, created } = await createApproved();
    const result = await service.consume(
      baseConsumeInput(created.approval_id, {
        tool_id: "invoice.mark_paid",
      }),
    );
    expect(result).toMatchObject({
      outcome: "scope_mismatch",
      code: "APPROVAL_SCOPE_MISMATCH",
    });
  });

  it("19. version différente → scope_mismatch", async () => {
    const { service, created } = await createApproved();
    const result = await service.consume(
      baseConsumeInput(created.approval_id, { tool_version: "2.0.0" }),
    );
    expect(result).toMatchObject({
      outcome: "scope_mismatch",
      code: "APPROVAL_SCOPE_MISMATCH",
    });
  });

  it("20. mode différent → scope_mismatch", async () => {
    const { service, created } = await createApproved();
    const result = await service.consume(
      baseConsumeInput(created.approval_id, { mode: "conseiller" }),
    );
    expect(result).toMatchObject({
      outcome: "scope_mismatch",
      code: "APPROVAL_SCOPE_MISMATCH",
    });
  });

  it("21. autonomie différente → refus (autonomy_mismatch)", async () => {
    const { service, created } = await createApproved();
    const result = await service.consume(
      baseConsumeInput(created.approval_id, {
        requested_autonomy_level: 3,
      }),
    );
    expect(result).toMatchObject({
      outcome: "autonomy_mismatch",
      code: "APPROVAL_AUTONOMY_MISMATCH",
    });
  });

  it("22. ressource différente → scope_mismatch", async () => {
    const { service, created } = await createApproved();
    const result = await service.consume(
      baseConsumeInput(created.approval_id, {
        resource: {
          kind: "invoice",
          resource_id: INVOICE_2,
          tenant_id: TENANT_A_UUID,
        },
      }),
    );
    expect(result).toMatchObject({
      outcome: "scope_mismatch",
      code: "APPROVAL_SCOPE_MISMATCH",
    });
  });

  it("23. approval pending non consommable", async () => {
    const repo = createMemoryApprovalRepository();
    const service = createHumanApprovalService(repo);
    const created = await service.request(baseRequestInput());

    const result = await service.consume(baseConsumeInput(created.approval_id));
    expect(result).toMatchObject({
      outcome: "pending",
      code: "APPROVAL_PENDING",
    });
  });

  it("24. approval rejected non consommable", async () => {
    const repo = createMemoryApprovalRepository();
    const service = createHumanApprovalService(repo);
    const created = await service.request(baseRequestInput());
    await service.decide(rejectDecisionInput(created.approval_id));

    const result = await service.consume(baseConsumeInput(created.approval_id));
    expect(result).toMatchObject({
      outcome: "rejected",
      code: "APPROVAL_REJECTED",
    });
  });

  it("25. approval expired non consommable", async () => {
    const { service, created } = await createApproved();
    const result = await service.consume(
      baseConsumeInput(created.approval_id, {
        now: FIXED_NOW_AFTER_EXPIRY,
      }),
    );
    expect(result).toMatchObject({
      outcome: "expired",
      code: "APPROVAL_EXPIRED",
    });
  });

  // -------------------------------------------------------------------------
  // 26–27 · Fail-closed / sanitization
  // -------------------------------------------------------------------------

  it("26. repository indisponible → fail-closed", async () => {
    const repo = createMemoryApprovalRepository();
    repo.setNextCreateError(new ApprovalError("APPROVAL_UNAVAILABLE"));
    const service = createHumanApprovalService(repo);

    await expect(service.request(baseRequestInput())).rejects.toMatchObject({
      code: "APPROVAL_UNAVAILABLE",
    });

    const { service: okService, created } = await createApproved();
    const failingRepo = createMemoryApprovalRepository();
    // Rejoue une consommation sur un repo qui échoue.
    failingRepo.setNextConsumeError(new TypeError("fetch failed"));
    const failingService = createHumanApprovalService(failingRepo);
    // Seed minimal : injecte une ligne via create puis force l’erreur consume.
    const seeded = await failingService.request(baseRequestInput());
    await failingService.decide(approveDecisionInput(seeded.approval_id));
    failingRepo.setNextConsumeError(new TypeError("fetch failed"));

    const consume = await failingService.consume(
      baseConsumeInput(seeded.approval_id),
    );
    expect(consume).toMatchObject({
      outcome: "unavailable",
      code: "APPROVAL_UNAVAILABLE",
    });
    expectNoRawSqlLeak(consume);
    void okService;
    void created;
  });

  it("27. erreur SQL brute masquée (classify + service)", async () => {
    const client = createSpyApprovalRpcClient();
    client.setNextOutcome({
      data: null,
      error: {
        code: "23505",
        message: RAW_SQL_DETAIL,
        details: RAW_SQL_DETAIL,
        hint: "See DETAIL",
      },
    });
    const repo = createSupabaseApprovalRepository(client);
    const service = createHumanApprovalService(repo);

    await expect(service.request(baseRequestInput())).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(ApprovalError);
        expectNoRawSqlLeak(err);
        expectNoSensitiveLeak(err);
        return true;
      },
    );

    client.setNextOutcome({
      data: null,
      error: sqlUnavailableError(),
    });
    const consume = await service.consume(
      baseConsumeInput(APPROVAL_ID_UNKNOWN),
    );
    expect(consume.outcome).toBe("unavailable");
    expectNoRawSqlLeak(consume);
    expectNoSensitiveLeak(consume);
  });

  // -------------------------------------------------------------------------
  // 28–30 · Immutabilité / pas de secret / pas d’args
  // -------------------------------------------------------------------------

  it("28. input non muté par request/decide/consume", async () => {
    const repo = createMemoryApprovalRepository();
    const service = createHumanApprovalService(repo);

    const request = baseRequestInput();
    const requestSnapshot = structuredClone(request);
    const created = await service.request(request);
    expect(request).toEqual(requestSnapshot);

    const decision = approveDecisionInput(created.approval_id);
    const decisionSnapshot = structuredClone(decision);
    await service.decide(decision);
    expect(decision).toEqual(decisionSnapshot);

    const consumption = baseConsumeInput(created.approval_id);
    const consumptionSnapshot = structuredClone(consumption);
    await service.consume(consumption);
    expect(consumption).toEqual(consumptionSnapshot);
  });

  it("29. aucun secret stocké dans le repository mémoire", async () => {
    const repo = createMemoryApprovalRepository();
    const service = createHumanApprovalService(repo);

    const created = await service.request(
      baseRequestInput({
        // Champs hors contrat refusés par schéma — on vérifie le stockage nominal.
        request_fingerprint: baseRequestInput().request_fingerprint,
      }),
    );
    await service.decide(approveDecisionInput(created.approval_id));
    await service.consume(baseConsumeInput(created.approval_id));

    const stored = repo.getById(created.approval_id);
    expect(stored).toBeTruthy();
    expectNoSecretStored(stored);
    expect(JSON.stringify(stored)).not.toContain(SENSITIVE_RAW_TOKEN);
    expect(JSON.stringify(stored)).not.toContain(SENSITIVE_STACK_FRAGMENT);
    expect(stored).not.toHaveProperty("secret");
    expect(stored).not.toHaveProperty("token");
    expect(stored).not.toHaveProperty("arguments");
  });

  it("30. aucun argument métier complet stocké", async () => {
    const repo = createMemoryApprovalRepository();
    const service = createHumanApprovalService(repo);

    // Tentative d’injection d’arguments complets refusée par schéma strict.
    await expect(
      service.request({
        ...baseRequestInput(),
        arguments: FULL_ARGUMENTS_PAYLOAD,
      } as never),
    ).rejects.toMatchObject({ code: "APPROVAL_INPUT_INVALID" });

    const created = await service.request(baseRequestInput());
    await service.decide(approveDecisionInput(created.approval_id));
    await service.consume(baseConsumeInput(created.approval_id));

    const stored = repo.getById(created.approval_id);
    expectNoRawPayload(stored);
    expect(JSON.stringify(stored)).not.toContain("amount_cents");
    expect(JSON.stringify(stored)).not.toContain("FR761234567890");
    expect(stored?.params_hash).toBe(baseRequestInput().params_hash);
    expect(stored?.request_fingerprint).toBe(
      baseRequestInput().request_fingerprint,
    );

    // Inspect dans la fenêtre TTL ne fuit rien non plus.
    const inspection = await service.inspect(
      inspectInput(created.approval_id, { now: FIXED_NOW_WITHIN_TTL }),
    );
    expectNoRawPayload(inspection);
    expectNoSensitiveLeak(inspection);
    void TENANT_B_UUID;
  });
});
