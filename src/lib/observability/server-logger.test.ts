import { afterEach, describe, expect, it, vi } from "vitest";

import { logSupabaseAuthError } from "@/lib/auth/log-auth-error";
import { requestIdFromHeaders } from "@/lib/observability/request-id";
import {
  logServerEvent,
  redactLogContext,
} from "@/lib/observability/server-logger";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("journal serveur structuré", () => {
  it("expurge secrets, données personnelles et messages d'erreur", () => {
    const context = redactLogContext({
      safeId: "req_123",
      email: "payeur@example.test",
      stripeSecret: "sk_test_do-not-log",
      nested: {
        authorization: "Bearer do-not-log",
        error: new Error("détail interne à ne pas exposer"),
        message: "détail brut",
        referrer: "https://example.test/auth/callback?code=secret-code",
        requestUrl: "https://example.test/p/token-brut",
      },
    });

    expect(context).toMatchObject({
      safeId: "req_123",
      email: "[REDACTED]",
      stripeSecret: "[REDACTED]",
      nested: {
        authorization: "[REDACTED]",
        error: { name: "Error" },
        message: "[REDACTED]",
        referrer: "[REDACTED]",
        requestUrl: "[REDACTED]",
      },
    });
    expect(JSON.stringify(context)).not.toContain("do-not-log");
    expect(JSON.stringify(context)).not.toContain("payeur@example.test");
  });

  it("n'accepte comme identifiant de corrélation qu'un UUID v4", () => {
    const valid = "11111111-1111-4111-8111-111111111111";

    expect(
      requestIdFromHeaders(
        new Headers({ "x-sidian-request-id": valid }),
      ),
    ).toBe(valid);
    expect(
      requestIdFromHeaders(
        new Headers({ "x-sidian-request-id": "attacker-controlled" }),
      ),
    ).toBeNull();
  });

  it("émet une seule ligne JSON avec un événement stable", () => {
    const sink = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logServerEvent("error", "health.dependency_unavailable", {
      requestId: "request-safe",
    });

    expect(sink).toHaveBeenCalledTimes(1);
    const record = JSON.parse(String(sink.mock.calls[0]?.[0])) as {
      level: string;
      event: string;
      context: { requestId: string };
    };
    expect(record).toMatchObject({
      level: "error",
      event: "health.dependency_unavailable",
      context: { requestId: "request-safe" },
    });
  });

  it("n'écrit jamais le message brut d'une erreur Supabase Auth", () => {
    const sink = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logSupabaseAuthError(
      "signUp",
      {
        code: "unexpected_failure",
        status: 500,
        name: "AuthApiError",
        message: "SQL interne avec payeur@example.test et sk_test_secret",
      },
      { redirectHost: "preview.example.test" },
    );

    const line = String(sink.mock.calls[0]?.[0]);
    expect(line).toContain('"event":"auth.supabase_error"');
    expect(line).toContain('"errorCode":"unexpected_failure"');
    expect(line).not.toContain("SQL interne");
    expect(line).not.toContain("payeur@example.test");
    expect(line).not.toContain("sk_test_secret");
  });
});
