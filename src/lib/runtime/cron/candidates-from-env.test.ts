/**
 * Source candidats scanners — fail-closed credentials + projection SQL.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { RuntimeError } from "../errors";
import {
  createScannerCandidateSourceFromEnv,
  isScannerCandidateAdminConfigured,
  SCANNER_CANDIDATE_SOURCE_STATUS,
} from "./candidates-from-env";
import type { ScannerCandidateQueryClient } from "../scanners/supabase-candidate-source";

afterEach(() => {
  vi.unstubAllEnvs();
});

function chainable(
  result: { data: Record<string, unknown>[] | null; error: null },
): PromiseLike<typeof result> & Record<string, unknown> {
  const self = {
    then(
      onfulfilled?:
        | ((value: typeof result) => unknown)
        | null
        | undefined,
      onrejected?: ((reason: unknown) => unknown) | null | undefined,
    ) {
      return Promise.resolve(result).then(
        onfulfilled as ((value: typeof result) => typeof result) | null | undefined,
        onrejected,
      );
    },
    in() {
      return self;
    },
    eq() {
      return self;
    },
    is() {
      return self;
    },
  };
  return self as PromiseLike<typeof result> & Record<string, unknown>;
}

function mockClient(rows: Record<string, unknown>[] = []): ScannerCandidateQueryClient {
  return {
    from() {
      return {
        select() {
          return chainable({ data: rows, error: null }) as never;
        },
      };
    },
  };
}

describe("scanner candidate source from env", () => {
  it("status câblé = supabase (plus de stub métier)", () => {
    expect(SCANNER_CANDIDATE_SOURCE_STATUS).toBe("supabase");
  });

  it("fail-closed not_configured si credentials admin absents", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    expect(isScannerCandidateAdminConfigured()).toBe(false);
    await expect(createScannerCandidateSourceFromEnv()).rejects.toMatchObject({
      name: "RuntimeError",
      code: "not_configured",
    } satisfies Partial<RuntimeError>);
  });

  it("accepte un client injecté sans requérir l’env (tests / partage admin)", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const source = await createScannerCandidateSourceFromEnv({
      client: mockClient([]),
    });
    await expect(source.listOpenCreances()).resolves.toEqual([]);
    await expect(source.listTerminalCreances()).resolves.toEqual([]);
    await expect(source.listFailedTentatives()).resolves.toEqual([]);
  });
});
