import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createConsoleErrorReporter,
  createMemoryErrorReporter,
  createNoopErrorReporter,
  describeErrorReporting,
  getErrorReporter,
  hashTenantId,
  reportError,
  reportMessage,
  resolveErrorReportingBackend,
  setErrorReporter,
  type ErrorReportEvent,
} from "./error-reporter";

const originalBackend = process.env.SIDIAN_ERROR_REPORTING;

afterEach(() => {
  vi.restoreAllMocks();
  setErrorReporter(null);
  if (originalBackend === undefined) delete process.env.SIDIAN_ERROR_REPORTING;
  else process.env.SIDIAN_ERROR_REPORTING = originalBackend;
});

function capture(): {
  events: ErrorReportEvent[];
  reporter: ReturnType<typeof createNoopErrorReporter>;
} {
  const events: ErrorReportEvent[] = [];
  const reporter = createNoopErrorReporter({
    emit: (event) => events.push(event),
    now: () => new Date("2026-08-03T10:00:00.000Z"),
  });
  return { events, reporter };
}

describe("interface de remontée d'erreurs", () => {
  it("normalise une exception en événement diffusable", () => {
    const { events, reporter } = capture();

    reporter.captureException(new TypeError("échec du drain"), {
      requestId: "0f4d4c1e-1e2a-4a8e-9c1a-2b3c4d5e6f70",
      tenantHash: hashTenantId("prestataire-42"),
      severity: "warning",
      scope: "runtime.drains",
      extra: { attempt: 3 },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "exception",
      severity: "warning",
      scope: "runtime.drains",
      message: "échec du drain",
      error_name: "TypeError",
      request_id: "0f4d4c1e-1e2a-4a8e-9c1a-2b3c4d5e6f70",
      extra: { attempt: 3 },
      occurred_at: "2026-08-03T10:00:00.000Z",
    });
    expect(events[0].tenant_hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("n'émet jamais la stack ni la cause", () => {
    const { events, reporter } = capture();
    const cause = new Error("corps de réponse fournisseur complet");
    const error = new Error("échec transport", { cause });

    reporter.captureException(error);

    const serialized = JSON.stringify(events[0]);
    expect(serialized).not.toContain("corps de réponse fournisseur");
    expect(serialized).not.toContain("error-reporter.test");
    expect(events[0]).not.toHaveProperty("stack");
  });

  it("expurge secrets et données personnelles du message", () => {
    const { events, reporter } = capture();

    reporter.captureMessage(
      "échec pour payeur@exemple.test avec Bearer eyJhbGciOiJIUzI1NiJ9.aaaaaaaa.bbbbbbbb et IBAN FR7630006000011234567890189",
    );

    const message = events[0].message;
    expect(message).not.toContain("payeur@exemple.test");
    expect(message).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(message).not.toContain("FR7630006000011234567890189");
    expect(message).toContain("[redacted]");
  });

  it("expurge le contexte additionnel", () => {
    const { events, reporter } = capture();

    reporter.captureMessage("état inattendu", {
      extra: {
        email: "payeur@exemple.test",
        stripeSecret: "sk_test_ne-pas-journaliser",
        authorization: "Bearer ne-pas-journaliser",
        creanceId: "creance_123",
      },
    });

    expect(events[0].extra).toMatchObject({
      email: "[REDACTED]",
      stripeSecret: "[REDACTED]",
      authorization: "[REDACTED]",
      creanceId: "creance_123",
    });
  });

  it("tronque les messages trop longs", () => {
    const { events, reporter } = capture();
    reporter.captureMessage("x".repeat(5_000));
    expect(events[0].message.length).toBeLessThanOrEqual(301);
  });

  it("refuse un scope malformé plutôt que de le propager", () => {
    const { events, reporter } = capture();
    reporter.captureMessage("ok", { scope: "scope avec espaces & <script>" });
    expect(events[0].scope).toBe("invalid_scope");
  });

  it("attribue le scope 'unknown' par défaut et la sévérité 'error'", () => {
    const { events, reporter } = capture();
    reporter.captureException("panne opaque");
    expect(events[0]).toMatchObject({ scope: "unknown", severity: "error" });
  });

  it("gère une valeur levée non sérialisable", () => {
    const { events, reporter } = capture();
    reporter.captureException(Symbol("boom"));
    expect(events[0].message).toBe("unserializable_error");
  });
});

describe("implémentation par défaut", () => {
  it("est un no-op explicite, jamais silencieusement 'configuré'", () => {
    const reporter = createNoopErrorReporter();
    expect(reporter.provider).toBe("noop");
    expect(reporter.configured).toBe(false);
    expect(() => reporter.captureException(new Error("x"))).not.toThrow();
  });

  it("est sélectionnée tant que SIDIAN_ERROR_REPORTING n'est pas renseigné", () => {
    delete process.env.SIDIAN_ERROR_REPORTING;
    setErrorReporter(null);
    expect(resolveErrorReportingBackend()).toBe("off");
    expect(getErrorReporter().provider).toBe("noop");
    expect(describeErrorReporting()).toEqual({
      provider: "noop",
      configured: false,
      backend: "off",
    });
  });

  it("sélectionne le journal serveur quand SIDIAN_ERROR_REPORTING=console", () => {
    process.env.SIDIAN_ERROR_REPORTING = "console";
    setErrorReporter(null);
    expect(getErrorReporter().provider).toBe("console");
    expect(describeErrorReporting()).toEqual({
      provider: "console",
      configured: true,
      backend: "console",
    });
  });
});

describe("adaptateur journal serveur", () => {
  it("émet un enregistrement structuré expurgé", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reporter = createConsoleErrorReporter();

    reporter.captureException(new Error("échec cron"), {
      scope: "api.cron.drains",
      requestId: "0f4d4c1e-1e2a-4a8e-9c1a-2b3c4d5e6f70",
      extra: { email: "payeur@exemple.test" },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const record = JSON.parse(spy.mock.calls[0][0] as string);
    expect(record.level).toBe("error");
    expect(record.event).toBe("error_report");
    expect(record.context.summary).toBe("échec cron");
    expect(record.context.scope).toBe("api.cron.drains");
    expect(record.context.extra.email).toBe("[REDACTED]");
  });

  it("mappe la sévérité sur le niveau de journal", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reporter = createConsoleErrorReporter();

    reporter.captureMessage("trace", { severity: "info" });
    reporter.captureMessage("alerte", { severity: "warning" });

    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("raccourcis pour blocs catch", () => {
  it("route vers l'instance active", () => {
    const memory = createMemoryErrorReporter();
    setErrorReporter(memory);

    reportError(new Error("avalée jusqu'ici"), { scope: "app.clients" });
    reportMessage("état inattendu", { scope: "app.clients" });

    expect(memory.events).toHaveLength(2);
    expect(memory.events[0].kind).toBe("exception");
    expect(memory.events[1].kind).toBe("message");
  });

  it("ne lève jamais, même si le collecteur est défaillant", () => {
    setErrorReporter({
      provider: "explosif",
      configured: true,
      captureException() {
        throw new Error("collecteur cassé");
      },
      captureMessage() {
        throw new Error("collecteur cassé");
      },
    });

    expect(() => reportError(new Error("x"))).not.toThrow();
    expect(() => reportMessage("x")).not.toThrow();
  });
});

describe("empreinte de tenant", () => {
  it("est stable, tronquée, et ne contient pas l'identifiant", () => {
    const hash = hashTenantId("prestataire-42");
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).toBe(hashTenantId("prestataire-42"));
    expect(hash).not.toContain("42");
    expect(hashTenantId("prestataire-43")).not.toBe(hash);
  });
});
