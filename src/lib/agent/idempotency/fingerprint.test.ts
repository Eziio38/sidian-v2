/**
 * Tests G1-G — empreinte canonique (fingerprint).
 *
 * Importe l’API production `@/lib/agent/idempotency` (`buildRequestFingerprint`).
 * Aucune I/O ; fixtures 100 % mémoire.
 *
 * Couverture unitaire :
 * 1 fingerprint stable · 2 ordre clés JSON · 3 argument différent
 * 4 tenant différent · 5 outil/version · 6 ressource · 7 input non muté
 */

import { describe, expect, it } from "vitest";

import {
  buildRequestFingerprint,
  canonicalizeForFingerprint,
} from "@/lib/agent/idempotency";

import {
  SENSITIVE_RAW_TOKEN,
  baseFingerprintSource,
  differentArgumentSource,
  differentResourceSource,
  differentTenantSource,
  differentToolVersionSource,
  expectNoSensitiveLeak,
  reorderedArgumentsSource,
} from "./test-fixtures";

describe("Idempotency fingerprint G1-G (déterministe)", () => {
  it("1. fingerprint stable — même intention → même empreinte", () => {
    const source = baseFingerprintSource();
    const a = buildRequestFingerprint(source);
    const b = buildRequestFingerprint(baseFingerprintSource());

    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toBe(b);
  });

  it("2. ordre différent des clés JSON → même fingerprint", () => {
    const a = buildRequestFingerprint(baseFingerprintSource());
    const b = buildRequestFingerprint(reorderedArgumentsSource());

    expect(a).toBe(b);
  });

  it("3. argument différent → fingerprint différent", () => {
    const a = buildRequestFingerprint(baseFingerprintSource());
    const b = buildRequestFingerprint(differentArgumentSource());

    expect(a).not.toBe(b);
  });

  it("4. tenant différent → fingerprint différent", () => {
    const a = buildRequestFingerprint(baseFingerprintSource());
    const b = buildRequestFingerprint(differentTenantSource());

    expect(a).not.toBe(b);
  });

  it("5. outil/version différents → fingerprint différent", () => {
    const a = buildRequestFingerprint(baseFingerprintSource());
    const b = buildRequestFingerprint(differentToolVersionSource());
    const c = buildRequestFingerprint(
      baseFingerprintSource({ tool_id: "invoice.list" }),
    );

    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it("6. ressource différente → fingerprint différent", () => {
    const a = buildRequestFingerprint(baseFingerprintSource());
    const b = buildRequestFingerprint(differentResourceSource());

    expect(a).not.toBe(b);
  });

  it("7. input non muté — source inchangée après calcul", () => {
    const source = baseFingerprintSource({
      arguments: {
        z_last: 1,
        a_first: "x",
        nested: { b: 2, a: 1 },
      },
    });
    const snapshot = structuredClone(source);

    buildRequestFingerprint(source);

    expect(source).toEqual(snapshot);
  });

  it("redaction — secret/token dans arguments n’entre pas en clair dans la canonique", () => {
    const source = baseFingerprintSource({
      arguments: {
        invoice_id: "inv_1",
        api_key: SENSITIVE_RAW_TOKEN,
        token: SENSITIVE_RAW_TOKEN,
      },
    });

    const canonical = canonicalizeForFingerprint(source.arguments);
    expectNoSensitiveLeak(canonical);
    expect(canonical).toEqual({
      api_key: "<redacted>",
      invoice_id: "inv_1",
      token: "<redacted>",
    });

    const fp = buildRequestFingerprint(source);
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });
});
