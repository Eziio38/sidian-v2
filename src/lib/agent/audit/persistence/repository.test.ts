/**
 * Tests G1-F — repository de persistance audit (append-only).
 *
 * Importe l’API production `@/lib/agent/audit/persistence`.
 * Client Supabase mocké (surface insert minimale) — zéro réseau.
 *
 * Couverture unitaire minimale :
 * 1 insertion nominale · 2 mapping complet · 3 événement invalide
 * 4 champ inconnu · 5 payload non stocké · 6 secret · 7 token · 8 stack
 * 9 erreur Supabase normalisée · 10 SQL brut non exposé · 11 duplication
 * 12 input non muté · 13 une seule tentative · 14 pas update · 15 pas delete
 * 22 déterminisme mapping hors recorded_at
 *
 * (16–21 : script SQL/RLS `scripts/test-g1-f-agent-audit-rls.mjs`)
 */

import { describe, expect, it } from "vitest";

import {
  AGENT_AUDIT_EVENTS_TABLE,
  AUDIT_EVENT_SCHEMA_VERSION,
  AUDIT_PERSISTENCE_SAFE_MESSAGES,
  classifyPersistenceError,
  createSupabaseAuditRepository,
  mapAuditEventToInsert,
} from "@/lib/agent/audit/persistence";

import {
  RAW_SQL_DETAIL,
  SENSITIVE_CARD_PAN,
  SENSITIVE_RAW_TOKEN,
  SENSITIVE_STACK_FRAGMENT,
  createSpyAuditPersistenceClient,
  expectMappedColumns,
  expectNoRawPayload,
  expectNoRawSqlLeak,
  expectNoSensitiveLeak,
  successAuditEvent,
} from "./test-fixtures";

describe("AuditEventRepository G1-F (append-only, client injecté)", () => {
  // -------------------------------------------------------------------------
  // 1–2 · Insertion nominale + mapping
  // -------------------------------------------------------------------------

  it("1. insertion nominale — append succès, une ligne, table agent_audit_events", async () => {
    const client = createSpyAuditPersistenceClient();
    const repo = createSupabaseAuditRepository(client);
    const event = successAuditEvent();

    const result = await repo.append(event);

    expect(result).toEqual({ ok: true, audit_id: event.audit_id });
    expect(client.insertCount()).toBe(1);
    expect(client.inserts[0]?.table).toBe(AGENT_AUDIT_EVENTS_TABLE);
  });

  it("2. mapping complet des champs autorisés (hors recorded_at)", async () => {
    const client = createSpyAuditPersistenceClient();
    const repo = createSupabaseAuditRepository(client);
    const event = successAuditEvent();

    await repo.append(event);

    const row = client.inserts[0]?.row;
    expect(row).toBeDefined();
    expect(row!.schema_version).toBe(AUDIT_EVENT_SCHEMA_VERSION);
    expectMappedColumns(row!, event);
  });

  // -------------------------------------------------------------------------
  // 3–4 · Validation avant insert
  // -------------------------------------------------------------------------

  it("3. événement invalide refusé avant insert (AUDIT_EVENT_INVALID)", async () => {
    const client = createSpyAuditPersistenceClient();
    const repo = createSupabaseAuditRepository(client);

    const result = await repo.append({
      audit_id: "",
      timestamp: "not-a-date",
    } as never);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("AUDIT_EVENT_INVALID");
      expect(result.message).toBe(
        AUDIT_PERSISTENCE_SAFE_MESSAGES.AUDIT_EVENT_INVALID,
      );
    }
    expect(client.insertCount()).toBe(0);
  });

  it("4. champ inconnu refusé avant insert", async () => {
    const client = createSpyAuditPersistenceClient();
    const repo = createSupabaseAuditRepository(client);
    const event = {
      ...successAuditEvent(),
      prompt_says_allowed: true,
      extra_field: "nope",
    };

    const result = await repo.append(event as never);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("AUDIT_EVENT_INVALID");
    }
    expect(client.insertCount()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 5–8 · Redaction — payload / secret / token / stack
  // -------------------------------------------------------------------------

  it("5. payload complet non stocké — pas d’arguments / sortie brute", async () => {
    const client = createSpyAuditPersistenceClient();
    const repo = createSupabaseAuditRepository(client);
    const event = successAuditEvent();

    await repo.append(event);

    const row = client.inserts[0]?.row;
    expect(row).toBeDefined();
    expectNoRawPayload(row);
    expect(row!.event_payload).not.toHaveProperty("arguments");
    expect(row!.event_payload).not.toHaveProperty("payload");
    expect(row!.params_hash).toBe(event.params_hash);
    expect(row!.output_hash).toBe(event.output_hash ?? null);
  });

  it("6. secret absent — champ secret refusé avant insert", async () => {
    const client = createSpyAuditPersistenceClient();
    const repo = createSupabaseAuditRepository(client);

    const result = await repo.append({
      ...successAuditEvent(),
      secret: SENSITIVE_RAW_TOKEN,
    } as never);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("AUDIT_EVENT_INVALID");
    }
    expect(client.insertCount()).toBe(0);
    expectNoSensitiveLeak(result);
  });

  it("7. token absent — champ token refusé avant insert", async () => {
    const client = createSpyAuditPersistenceClient();
    const repo = createSupabaseAuditRepository(client);

    const result = await repo.append({
      ...successAuditEvent(),
      token: SENSITIVE_RAW_TOKEN,
    } as never);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("AUDIT_EVENT_INVALID");
    }
    expect(client.insertCount()).toBe(0);
    expectNoSensitiveLeak(result);
    expect(JSON.stringify(result)).not.toContain(SENSITIVE_RAW_TOKEN);
  });

  it("8. stack absente — champ stack / PAN refusés avant insert", async () => {
    const client = createSpyAuditPersistenceClient();
    const repo = createSupabaseAuditRepository(client);

    for (const poison of [
      { stack: `Error\n    ${SENSITIVE_STACK_FRAGMENT}` },
      { card_pan: SENSITIVE_CARD_PAN },
      { arguments: { api_key: SENSITIVE_RAW_TOKEN } },
      { payload: { card: SENSITIVE_CARD_PAN } },
    ]) {
      const result = await repo.append({
        ...successAuditEvent(),
        ...poison,
      } as never);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("AUDIT_EVENT_INVALID");
      }
      expectNoSensitiveLeak(result);
    }
    expect(client.insertCount()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 9–11 · Normalisation erreurs Supabase / conflit / pas de SQL brut
  // -------------------------------------------------------------------------

  it("9. erreur Supabase normalisée (REJECTED / UNAVAILABLE / FAILED)", async () => {
    const client = createSpyAuditPersistenceClient();
    const repo = createSupabaseAuditRepository(client);
    const event = successAuditEvent();

    client.setNextOutcome({
      error: { code: "42501", message: "permission denied for table" },
    });
    const rejected = await repo.append(event);
    expect(rejected).toEqual({
      ok: false,
      code: "AUDIT_PERSISTENCE_REJECTED",
      message: AUDIT_PERSISTENCE_SAFE_MESSAGES.AUDIT_PERSISTENCE_REJECTED,
    });

    client.setNextOutcome({
      error: { code: "08006", message: "connection failure" },
    });
    const unavailable = await repo.append(event);
    expect(unavailable.ok).toBe(false);
    if (!unavailable.ok) {
      expect(unavailable.code).toBe("AUDIT_PERSISTENCE_UNAVAILABLE");
    }

    client.setNextOutcome({
      error: { code: "XX000", message: "unexpected internal error" },
    });
    const failed = await repo.append(event);
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.code).toBe("AUDIT_PERSISTENCE_FAILED");
    }

    expect(classifyPersistenceError({ code: "23514" })).toBe(
      "AUDIT_PERSISTENCE_REJECTED",
    );
    expect(classifyPersistenceError({ code: "PGRST301" })).toBe(
      "AUDIT_PERSISTENCE_UNAVAILABLE",
    );
  });

  it("10. message SQL brut non exposé dans le résultat", async () => {
    const client = createSpyAuditPersistenceClient();
    const repo = createSupabaseAuditRepository(client);

    client.setNextOutcome({
      error: {
        code: "23505",
        message: RAW_SQL_DETAIL,
        details: RAW_SQL_DETAIL,
        hint: "See server log for DETAIL",
      },
    });

    const result = await repo.append(successAuditEvent());

    expect(result.ok).toBe(false);
    expectNoRawSqlLeak(result);
    expectNoSensitiveLeak(result);
    if (!result.ok) {
      expect(result.message).toBe(
        AUDIT_PERSISTENCE_SAFE_MESSAGES.AUDIT_PERSISTENCE_CONFLICT,
      );
    }
  });

  it("11. duplication audit_id normalisée en AUDIT_PERSISTENCE_CONFLICT", async () => {
    const client = createSpyAuditPersistenceClient();
    const repo = createSupabaseAuditRepository(client);

    client.setNextOutcome({
      error: {
        code: "23505",
        message: RAW_SQL_DETAIL,
      },
    });

    const result = await repo.append(successAuditEvent());

    expect(result).toEqual({
      ok: false,
      code: "AUDIT_PERSISTENCE_CONFLICT",
      message: AUDIT_PERSISTENCE_SAFE_MESSAGES.AUDIT_PERSISTENCE_CONFLICT,
    });
    expect(client.insertCount()).toBe(1);
    expectNoRawSqlLeak(result);
  });

  // -------------------------------------------------------------------------
  // 12–15 · Immutabilité / une tentative / pas update-delete
  // -------------------------------------------------------------------------

  it("12. input non muté par append", async () => {
    const client = createSpyAuditPersistenceClient();
    const repo = createSupabaseAuditRepository(client);
    const event = successAuditEvent();
    const snapshot = structuredClone(event);

    await repo.append(event);

    expect(event).toEqual(snapshot);
  });

  it("13. une seule tentative d’insertion par append (succès et échec)", async () => {
    const client = createSpyAuditPersistenceClient();
    const repo = createSupabaseAuditRepository(client);

    await repo.append(successAuditEvent());
    expect(client.insertCount()).toBe(1);

    client.reset();
    client.setNextOutcome({
      error: { code: "08006", message: "connection failure" },
    });
    await repo.append(successAuditEvent());
    expect(client.insertCount()).toBe(1);

    client.reset();
    client.setNextOutcome({
      throw: Object.assign(new TypeError("fetch failed"), {
        name: "TypeError",
      }),
    });
    const transport = await repo.append(successAuditEvent());
    expect(transport.ok).toBe(false);
    if (!transport.ok) {
      expect(transport.code).toBe("AUDIT_PERSISTENCE_UNAVAILABLE");
    }
    expect(client.insertCount()).toBe(1);
  });

  it("14. aucun update via le repository", async () => {
    const client = createSpyAuditPersistenceClient();
    const repo = createSupabaseAuditRepository(client);

    expect(repo).not.toHaveProperty("update");
    expect("update" in repo).toBe(false);

    await repo.append(successAuditEvent());
    expect(client.forbiddenCalls).not.toContain("update");
  });

  it("15. aucun delete via le repository", async () => {
    const client = createSpyAuditPersistenceClient();
    const repo = createSupabaseAuditRepository(client);

    expect(repo).not.toHaveProperty("delete");
    expect("delete" in repo).toBe(false);

    await repo.append(successAuditEvent());
    expect(client.forbiddenCalls).not.toContain("delete");
  });

  // -------------------------------------------------------------------------
  // 22 · Déterminisme mapping hors recorded_at
  // -------------------------------------------------------------------------

  it("22. déterminisme du mapping hors recorded_at", () => {
    const event = successAuditEvent();
    const a = mapAuditEventToInsert(event);
    const b = mapAuditEventToInsert(structuredClone(event));

    expect(a).toEqual(b);
    expect(a).not.toHaveProperty("recorded_at");
    expect(b).not.toHaveProperty("recorded_at");
    expectMappedColumns(a, event);
  });
});
