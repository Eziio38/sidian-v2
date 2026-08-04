/**
 * Tests G1-G — IdempotencyService (claim / complete / fail).
 *
 * Importe l’API production `@/lib/agent/idempotency`.
 * Repository mémoire injecté — zéro réseau.
 *
 * Couverture unitaire :
 * 8 clé absente · 9 claim nominal · 10 replay succeeded · 11 replay failed
 * 12 conflict · 13 in_progress · 14 expire/reacquired · 15 unavailable
 * 16 owner mismatch complete · 17 owner mismatch fail · 18 pas de SQL brut
 * 19 terminal sanitizé · 20 aucune stack persistée
 */

import { describe, expect, it } from "vitest";

import {
  IdempotencyError,
  IDEMPOTENCY_SAFE_MESSAGES,
  createIdempotencyService,
  createSupabaseIdempotencyRepository,
  hashOwnerToken,
} from "@/lib/agent/idempotency";

import {
  FIXED_NOW_AFTER_EXPIRY,
  FIXED_NOW_WITHIN_LEASE,
  IDEMPOTENCY_KEY,
  OWNER_TOKEN_B,
  RAW_SQL_DETAIL,
  SENSITIVE_RAW_TOKEN,
  SENSITIVE_STACK_FRAGMENT,
  baseClaimInput,
  completeInput,
  conflictClaimInput,
  createMemoryIdempotencyRepository,
  createSpyIdempotencyRpcClient,
  expectNoOwnerTokenLeak,
  expectNoRawSqlLeak,
  expectNoSensitiveLeak,
  failInput,
  failureTerminal,
  sqlUnavailableError,
  successTerminal,
} from "./test-fixtures";

describe("IdempotencyService G1-G (claim/complete/fail, repo injecté)", () => {
  // -------------------------------------------------------------------------
  // 8 · Clé absente
  // -------------------------------------------------------------------------

  it("8. clé absente refusée — IDEMPOTENCY_KEY_REQUIRED", async () => {
    const repo = createMemoryIdempotencyRepository();
    const service = createIdempotencyService(repo);

    await expect(
      service.claim(baseClaimInput({ idempotency_key: "" })),
    ).rejects.toMatchObject({
      name: "IdempotencyError",
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });

    await expect(
      service.claim(baseClaimInput({ idempotency_key: "   " })),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });

    expect(repo.claimCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 9 · Claim nominal
  // -------------------------------------------------------------------------

  it("9. claim nominal → acquired + owner_token + record_id", async () => {
    const repo = createMemoryIdempotencyRepository();
    const service = createIdempotencyService(repo);

    const decision = await service.claim(baseClaimInput());

    expect(decision.decision).toBe("acquired");
    if (decision.decision !== "acquired") return;
    expect(decision.owner_token.length).toBeGreaterThan(16);
    expect(decision.record_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(decision.expires_at).toBeTruthy();
    expect(decision.reacquired).toBeUndefined();

    const stored = repo.getByKey(
      baseClaimInput().tenant_id,
      IDEMPOTENCY_KEY,
    );
    expect(stored?.status).toBe("in_progress");
    expect(stored?.owner_token_hash).toBe(hashOwnerToken(decision.owner_token));
    expect(stored?.owner_token_hash).not.toBe(decision.owner_token);
  });

  // -------------------------------------------------------------------------
  // 10–11 · Replay
  // -------------------------------------------------------------------------

  it("10. replay succeeded → résultat existant, sans nouveau claim owner", async () => {
    const repo = createMemoryIdempotencyRepository();
    const service = createIdempotencyService(repo);

    const first = await service.claim(baseClaimInput());
    expect(first.decision).toBe("acquired");
    if (first.decision !== "acquired") return;

    await service.complete(completeInput(first.record_id, first.owner_token));

    const replay = await service.claim(baseClaimInput());
    expect(replay.decision).toBe("replay_success");
    if (replay.decision !== "replay_success") return;
    expect(replay.terminal_result).toEqual(successTerminal());
    expectNoSensitiveLeak(replay);
  });

  it("11. replay failed → échec existant (IDEMPOTENCY_REPLAY_FAILURE)", async () => {
    const repo = createMemoryIdempotencyRepository();
    const service = createIdempotencyService(repo);

    const first = await service.claim(baseClaimInput());
    expect(first.decision).toBe("acquired");
    if (first.decision !== "acquired") return;

    await service.fail(failInput(first.record_id, first.owner_token));

    const replay = await service.claim(baseClaimInput());
    expect(replay.decision).toBe("replay_failure");
    if (replay.decision !== "replay_failure") return;
    expect(replay.code).toBe("IDEMPOTENCY_REPLAY_FAILURE");
    expect(replay.terminal_result).toEqual(
      failureTerminal({
        failure_code: "EXECUTOR_TECHNICAL_ERROR",
        message: "Erreur technique sanitizée",
      }),
    );
    expect(replay.failure_code).toBe("EXECUTOR_TECHNICAL_ERROR");
  });

  // -------------------------------------------------------------------------
  // 12–14 · Conflict / in_progress / expire
  // -------------------------------------------------------------------------

  it("12. même clé + fingerprint différent → conflict", async () => {
    const repo = createMemoryIdempotencyRepository();
    const service = createIdempotencyService(repo);

    const first = await service.claim(baseClaimInput());
    expect(first.decision).toBe("acquired");

    const second = await service.claim(conflictClaimInput());
    expect(second).toEqual({
      decision: "conflict",
      code: "IDEMPOTENCY_KEY_CONFLICT",
    });
  });

  it("13. in_progress non expiré → blocked (IDEMPOTENCY_IN_PROGRESS)", async () => {
    const repo = createMemoryIdempotencyRepository();
    const service = createIdempotencyService(repo);

    const first = await service.claim(baseClaimInput());
    expect(first.decision).toBe("acquired");

    const second = await service.claim(
      baseClaimInput({ now: FIXED_NOW_WITHIN_LEASE }),
    );
    expect(second.decision).toBe("in_progress");
    if (second.decision !== "in_progress") return;
    expect(second.code).toBe("IDEMPOTENCY_IN_PROGRESS");
    expect(second.expires_at).toBeTruthy();
  });

  it("14. in_progress expiré → reacquired (acquired + reacquired)", async () => {
    const repo = createMemoryIdempotencyRepository();
    const service = createIdempotencyService(repo);

    const first = await service.claim(baseClaimInput());
    expect(first.decision).toBe("acquired");
    if (first.decision !== "acquired") return;
    const oldToken = first.owner_token;

    const reclaim = await service.claim(
      baseClaimInput({ now: FIXED_NOW_AFTER_EXPIRY }),
    );
    expect(reclaim.decision).toBe("acquired");
    if (reclaim.decision !== "acquired") return;
    expect(reclaim.reacquired).toBe(true);
    expect(reclaim.owner_token).not.toBe(oldToken);

    await expect(
      service.complete(
        completeInput(reclaim.record_id, oldToken, {
          now: FIXED_NOW_AFTER_EXPIRY,
        }),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_OWNER_MISMATCH" });

    await service.complete(
      completeInput(reclaim.record_id, reclaim.owner_token, {
        now: FIXED_NOW_AFTER_EXPIRY,
      }),
    );
    expect(repo.getByKey(baseClaimInput().tenant_id, IDEMPOTENCY_KEY)?.status).toBe(
      "succeeded",
    );
  });

  // -------------------------------------------------------------------------
  // 15 · Unavailable fail-closed
  // -------------------------------------------------------------------------

  it("15. repository indisponible → fail-closed unavailable", async () => {
    const repo = createMemoryIdempotencyRepository();
    repo.setNextClaimError(
      new IdempotencyError("IDEMPOTENCY_UNAVAILABLE"),
    );
    const service = createIdempotencyService(repo);

    const decision = await service.claim(baseClaimInput());
    expect(decision).toEqual({
      decision: "unavailable",
      code: "IDEMPOTENCY_UNAVAILABLE",
    });
    expectNoRawSqlLeak(decision);
  });

  it("15b. erreur transport opaque → unavailable (pas de throw)", async () => {
    const repo = createMemoryIdempotencyRepository();
    repo.setNextClaimError(new TypeError("fetch failed"));
    const service = createIdempotencyService(repo);

    const decision = await service.claim(baseClaimInput());
    expect(decision.decision).toBe("unavailable");
  });

  // -------------------------------------------------------------------------
  // 16–17 · Owner mismatch
  // -------------------------------------------------------------------------

  it("16. owner mismatch sur complete → refus", async () => {
    const repo = createMemoryIdempotencyRepository();
    const service = createIdempotencyService(repo);

    const first = await service.claim(baseClaimInput());
    expect(first.decision).toBe("acquired");

    if (first.decision !== "acquired") return;

    await expect(
      service.complete(completeInput(first.record_id, OWNER_TOKEN_B)),
    ).rejects.toMatchObject({
      name: "IdempotencyError",
      code: "IDEMPOTENCY_OWNER_MISMATCH",
      message: IDEMPOTENCY_SAFE_MESSAGES.IDEMPOTENCY_OWNER_MISMATCH,
    });

    expect(repo.getByKey(baseClaimInput().tenant_id, IDEMPOTENCY_KEY)?.status).toBe(
      "in_progress",
    );
  });

  it("17. owner mismatch sur fail → refus", async () => {
    const repo = createMemoryIdempotencyRepository();
    const service = createIdempotencyService(repo);

    const first = await service.claim(baseClaimInput());
    expect(first.decision).toBe("acquired");
    if (first.decision !== "acquired") return;

    await expect(
      service.fail(failInput(first.record_id, OWNER_TOKEN_B)),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_OWNER_MISMATCH",
    });

    expect(repo.getByKey(baseClaimInput().tenant_id, IDEMPOTENCY_KEY)?.status).toBe(
      "in_progress",
    );
  });

  // -------------------------------------------------------------------------
  // 18 · Pas de SQL brut exposé
  // -------------------------------------------------------------------------

  it("18. aucune erreur SQL brute exposée (classify + service)", async () => {
    const client = createSpyIdempotencyRpcClient();
    client.setNextOutcome({
      data: null,
      error: {
        code: "23505",
        message: RAW_SQL_DETAIL,
        details: RAW_SQL_DETAIL,
        hint: "See DETAIL",
      },
    });
    const repo = createSupabaseIdempotencyRepository(client);
    const service = createIdempotencyService(repo);

    const decision = await service.claim(baseClaimInput());
    expect(decision.decision).toBe("unavailable");
    expectNoRawSqlLeak(decision);
    expectNoSensitiveLeak(decision);

    // complete path — erreur SQL normalisée
    client.setNextOutcome({
      data: null,
      error: sqlUnavailableError(),
    });
    await expect(
      service.complete(
        completeInput(
          "11111111-1111-4111-8111-111111111111",
          "token_with_enough_entropy_abcdefghij",
        ),
      ),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(IdempotencyError);
      expectNoRawSqlLeak(err);
      expectNoOwnerTokenLeak(err);
      return true;
    });
  });

  // -------------------------------------------------------------------------
  // 19–20 · Sanitization terminal / stack
  // -------------------------------------------------------------------------

  it("19. résultat terminal sanitizé — schéma strict refuse stack/secret", async () => {
    const repo = createMemoryIdempotencyRepository();
    const service = createIdempotencyService(repo);

    const first = await service.claim(baseClaimInput());
    expect(first.decision).toBe("acquired");
    if (first.decision !== "acquired") return;

    await expect(
      service.complete(
        completeInput(first.record_id, first.owner_token, {
          terminal_result: {
            status: "success",
            output_hash: "hash_ok",
            summary: { ok: true },
            stack: SENSITIVE_STACK_FRAGMENT,
          } as never,
        }),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_INPUT_INVALID" });

    await expect(
      service.complete(
        completeInput(first.record_id, first.owner_token, {
          terminal_result: {
            status: "success",
            output_hash: "hash_ok",
            secret: SENSITIVE_RAW_TOKEN,
          } as never,
        }),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_INPUT_INVALID" });

    await service.complete(completeInput(first.record_id, first.owner_token));
    const stored = repo.getByKey(baseClaimInput().tenant_id, IDEMPOTENCY_KEY);
    expect(stored?.terminal_result).toEqual(successTerminal());
    expectNoSensitiveLeak(stored?.terminal_result);
  });

  it("20. aucune stack persistée — fail stocke uniquement terminal sanitizé", async () => {
    const repo = createMemoryIdempotencyRepository();
    const service = createIdempotencyService(repo);

    const first = await service.claim(baseClaimInput());
    expect(first.decision).toBe("acquired");
    if (first.decision !== "acquired") return;

    await service.fail(failInput(first.record_id, first.owner_token));

    const stored = repo.getByKey(baseClaimInput().tenant_id, IDEMPOTENCY_KEY);
    expect(stored?.status).toBe("failed");
    expect(stored?.terminal_result).toEqual(
      failureTerminal({
        failure_code: "EXECUTOR_TECHNICAL_ERROR",
        message: "Erreur technique sanitizée",
      }),
    );
    expectNoSensitiveLeak(stored);
    expect(JSON.stringify(stored)).not.toContain(SENSITIVE_STACK_FRAGMENT);
    expect(JSON.stringify(stored)).not.toMatch(/"stack"\s*:/);
    // Hash owner uniquement pendant in_progress — effacé au terminal.
    expect(stored?.owner_token_hash).toBeNull();
  });
});
