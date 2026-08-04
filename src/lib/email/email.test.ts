import { describe, expect, it, vi } from "vitest";

import {
  canonicalizeEmailAddress,
  hashEmailAddress,
} from "./address";
import { createEmailChannel } from "./channel";
import { loadEmailEnv } from "./env";
import { EmailError } from "./errors";
import { buildEmailIdempotencyKey } from "./idempotency";
import { createMemoryEmailOutboxRepository } from "./outbox/memory-repository";
import {
  createBrevoEmailProvider,
  createResendEmailProvider,
  isEmailProviderError,
  createStubEmailProvider,
  EmailProviderError,
} from "./provider";
import { escapeHtml, assertSafeHttpsUrl } from "./templates/escape";
import { renderEmailTemplate } from "./templates/registry";
import {
  canTransitionEmailStatus,
  EMAIL_TEMPLATE_KEYS,
} from "./types";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CREANCE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function stubEnv(overrides: Record<string, string> = {}) {
  return loadEmailEnv({
    SIDIAN_ENVIRONMENT: "local",
    SIDIAN_EMAIL_PROVIDER_ENABLED: "true",
    SIDIAN_EMAIL_TRANSPORT_MODE: "stub",
    SIDIAN_EMAIL_FROM_ADDRESS: "noreply@sidian.test",
    SIDIAN_EMAIL_FROM_NAME: "Sidian",
    ...overrides,
  });
}

describe("email address", () => {
  it("canonicalise et hashe une adresse valide", () => {
    const email = canonicalizeEmailAddress("  Jean.Dupont@Example.COM ");
    expect(email).toBe("jean.dupont@example.com");
    expect(hashEmailAddress(email)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejette une adresse invalide", () => {
    expect(() => canonicalizeEmailAddress("pas-un-email")).toThrow(EmailError);
  });
});

describe("email env fail-closed", () => {
  it("exige TRANSPORT_MODE si provider activé", () => {
    expect(() =>
      loadEmailEnv({
        SIDIAN_ENVIRONMENT: "local",
        SIDIAN_EMAIL_PROVIDER_ENABLED: "true",
      }),
    ).toThrow(/TRANSPORT_MODE/);
  });

  it("refuse stub hors local", () => {
    expect(() =>
      loadEmailEnv({
        SIDIAN_ENVIRONMENT: "production",
        SIDIAN_EMAIL_PROVIDER_ENABLED: "true",
        SIDIAN_EMAIL_TRANSPORT_MODE: "stub",
      }),
    ).toThrow(/stub interdit/);
  });

  it("refuse production activée hors live", () => {
    expect(() =>
      loadEmailEnv({
        SIDIAN_ENVIRONMENT: "production",
        SIDIAN_EMAIL_PROVIDER_ENABLED: "true",
        SIDIAN_EMAIL_TRANSPORT_MODE: "disabled",
      }),
    ).toThrow(/production exige mode live/);
  });

  it("échoue si config live incomplète", () => {
    expect(() =>
      loadEmailEnv({
        SIDIAN_ENVIRONMENT: "local",
        SIDIAN_EMAIL_PROVIDER_ENABLED: "true",
        SIDIAN_EMAIL_TRANSPORT_MODE: "live",
      }),
    ).toThrow(/live incomplète/);
  });

  it("accepte live complète", () => {
    const env = loadEmailEnv({
      SIDIAN_ENVIRONMENT: "production",
      SIDIAN_EMAIL_PROVIDER_ENABLED: "true",
      SIDIAN_EMAIL_TRANSPORT_MODE: "live",
      SIDIAN_EMAIL_API_KEY: "re_test_key",
      SIDIAN_EMAIL_FROM_ADDRESS: "noreply@sidian.app",
    });
    expect(env.mode).toBe("live");
    expect(env.apiKey).toBe("re_test_key");
  });
});

describe("email templates", () => {
  it("enregistre les 8 templates transactionnels", () => {
    expect(EMAIL_TEMPLATE_KEYS).toHaveLength(8);
  });

  it("rend HTML + text déterministes et échappe l'injection", () => {
    const rendered = renderEmailTemplate({
      templateKey: "reminder_before_due",
      locale: "fr",
      variables: {
        prestataireName: "Agence <script>",
        clientName: "Marie & Co",
        amountLabel: "1 200,00 €",
        dueDateLabel: "31/07/2026",
      },
    });

    expect(rendered.subject).toContain("1 200,00 €");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("Marie &amp; Co");
    expect(rendered.text).toContain("Marie & Co");
    expect(rendered.text).toContain("Agence <script>");
  });

  it("exige un lien https pour reminder_after_due", () => {
    expect(() =>
      renderEmailTemplate({
        templateKey: "reminder_after_due",
        locale: "fr",
        variables: {
          prestataireName: "Agence",
          clientName: "Marie",
          amountLabel: "100 €",
          dueDateLabel: "01/08/2026",
          paymentLinkUrl: "javascript:alert(1)",
        },
      }),
    ).toThrow(EmailError);
  });

  it("refuse les URL non https", () => {
    expect(() => assertSafeHttpsUrl("x", "http://example.com/pay")).toThrow(
      /email_url_rejected/,
    );
  });

  it("échappe le HTML", () => {
    expect(escapeHtml(`a<"b">c&d`)).toBe("a&lt;&quot;b&quot;&gt;c&amp;d");
  });
});

describe("email outbox channel", () => {
  it("enqueue idempotent + process sent via stub", async () => {
    const outbox = createMemoryEmailOutboxRepository();
    const env = stubEnv();
    const channel = createEmailChannel({ outbox, env });

    const first = await channel.enqueue({
      tenantId: TENANT,
      templateKey: "payment_received",
      recipient: { email: "client@example.com", name: "Client" },
      variables: {
        prestataireName: "Studio Nord",
        clientName: "Client",
        amountLabel: "500,00 €",
        paidAtLabel: "26/07/2026",
      },
      relatedEntityType: "creance",
      relatedEntityId: CREANCE,
      occurrenceKey: "paid:2026-07-26",
    });

    expect(first.status).toBe("queued");
    expect(first.recipientEmail).toBe("client@example.com");
    expect(first.providerMessageId).toBeNull();

    const second = await channel.enqueue({
      tenantId: TENANT,
      templateKey: "payment_received",
      recipient: { email: "client@example.com" },
      variables: {
        prestataireName: "Studio Nord",
        clientName: "Client",
        amountLabel: "500,00 €",
        paidAtLabel: "26/07/2026",
      },
      relatedEntityType: "creance",
      relatedEntityId: CREANCE,
      occurrenceKey: "paid:2026-07-26",
    });

    expect(second.id).toBe(first.id);

    const result = await channel.process(first.id);
    expect(result.outcome).toBe("sent");
    if (result.outcome === "sent") {
      expect(result.record.status).toBe("sent");
      expect(result.record.providerMessageId).toMatch(/^email_stub_/);
    }
  });

  it("retries bornés puis dead_letter", async () => {
    const outbox = createMemoryEmailOutboxRepository();
    const env = stubEnv();
    let calls = 0;
    const provider = createStubEmailProvider({
      scenario: () => {
        calls += 1;
        return { type: "unavailable" };
      },
    });
    const channel = createEmailChannel({ outbox, env, provider });

    const queued = await channel.enqueue({
      tenantId: TENANT,
      templateKey: "cancellation_notice",
      recipient: { email: "a@b.co" },
      variables: {
        prestataireName: "P",
        clientName: "C",
        amountLabel: "10 €",
        cancelledAtLabel: "26/07/2026",
      },
      relatedEntityId: CREANCE,
      occurrenceKey: "cancel:1",
      maxAttempts: 2,
    });

    const r1 = await channel.process(queued.id);
    expect(r1.outcome).toBe("failed");
    if (r1.outcome === "failed") {
      expect(r1.retryable).toBe(true);
      expect(r1.record.status).toBe("queued");
    }

    const r2 = await channel.process(queued.id);
    expect(r2.outcome).toBe("dead_letter");
    if (r2.outcome === "dead_letter") {
      expect(r2.record.status).toBe("dead_letter");
    }
    expect(calls).toBe(2);
  });

  it("échec non retryable → failed terminal", async () => {
    const outbox = createMemoryEmailOutboxRepository();
    const env = stubEnv();
    const provider = createStubEmailProvider({
      scenario: { type: "validation" },
    });
    const channel = createEmailChannel({ outbox, env, provider });

    const queued = await channel.enqueue({
      tenantId: TENANT,
      templateKey: "guide_internal_notice",
      recipient: { email: "guide@sidian.test" },
      variables: {
        noticeTitle: "Action requise",
        noticeBody: "Stripe non finalisé pour un paiement.",
      },
      occurrenceKey: "guide:1",
    });

    const result = await channel.process(queued.id);
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.retryable).toBe(false);
      expect(result.record.status).toBe("failed");
    }
  });

  it("processBatch traite la file", async () => {
    const outbox = createMemoryEmailOutboxRepository();
    const env = stubEnv();
    const channel = createEmailChannel({ outbox, env });

    await channel.enqueue({
      tenantId: TENANT,
      templateKey: "update_payment_method",
      recipient: { email: "c@example.com" },
      variables: {
        prestataireName: "P",
        clientName: "C",
        updateMethodUrl: "https://pay.sidian.app/update",
      },
      occurrenceKey: "upd:1",
    });

    const results = await channel.processBatch(5);
    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("sent");
  });
});

describe("resend provider (fetch injectable)", () => {
  it("envoie via HTTP et lit provider_message_id", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ id: "re_123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const provider = createResendEmailProvider({
      apiKey: "re_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => new Date("2026-07-26T12:00:00.000Z"),
    });

    const result = await provider.send({
      timeoutMs: 5000,
      message: {
        to: { email: "to@example.com" },
        from: { email: "from@example.com", name: "Sidian" },
        subject: "Test",
        text: "hello",
        html: "<p>hello</p>",
        idempotencyKey: "idem_abc_12345678",
      },
    });

    expect(result.providerMessageId).toBe("re_123");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const init = call[1];
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(
      "idem_abc_12345678",
    );
    const body = JSON.parse(String(init.body)) as {
      from: string;
      to: string[];
      text: string;
    };
    expect(body.from).toBe("Sidian <from@example.com>");
    expect(body.to).toEqual(["to@example.com"]);
    expect(body.text).toBe("hello");
  });

  it("classifie 429 comme retryable", async () => {
    const provider = createResendEmailProvider({
      apiKey: "re_test",
      fetchImpl: (async () =>
        new Response("{}", { status: 429 })) as unknown as typeof fetch,
    });

    await expect(
      provider.send({
        timeoutMs: 1000,
        message: {
          to: { email: "to@example.com" },
          from: { email: "from@example.com" },
          subject: "x",
          text: "x",
          html: "<p>x</p>",
        },
      }),
    ).rejects.toMatchObject({
      name: "EmailProviderError",
      retryable: true,
      category: "rate_limited",
    } satisfies Partial<EmailProviderError>);
  });
});

describe("email logs sans PII", () => {
  it("n’embarque ni adresse ni subject/body dans le contexte loggé", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const outbox = createMemoryEmailOutboxRepository();
    const env = stubEnv();
    const channel = createEmailChannel({ outbox, env });

    await channel.enqueue({
      tenantId: TENANT,
      templateKey: "payment_received",
      recipient: { email: "secret.client@example.com", name: "Secret" },
      variables: {
        prestataireName: "Studio",
        clientName: "Secret",
        amountLabel: "42,00 €",
        paidAtLabel: "26/07/2026",
      },
      relatedEntityId: CREANCE,
      occurrenceKey: "pii:1",
    });

    const payloads = info.mock.calls.map((call) => String(call[0]));
    expect(payloads.some((line) => line.includes("email.enqueue.queued"))).toBe(
      true,
    );
    for (const line of payloads) {
      expect(line).not.toContain("secret.client@example.com");
      expect(line).not.toContain("42,00 €");
      expect(line).not.toContain("Secret");
    }
    info.mockRestore();
  });
});

describe("email helpers", () => {
  it("construit une clé d'idempotence stable", () => {
    const hash = hashEmailAddress("a@b.co");
    const a = buildEmailIdempotencyKey({
      tenantId: TENANT,
      templateKey: "payment_failed",
      entityId: CREANCE,
      occurrenceKey: "t1",
      recipientEmailHash: hash,
    });
    const b = buildEmailIdempotencyKey({
      tenantId: TENANT,
      templateKey: "payment_failed",
      entityId: CREANCE,
      occurrenceKey: "t1",
      recipientEmailHash: hash,
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("transitions de statut", () => {
    expect(canTransitionEmailStatus("queued", "processing")).toBe(true);
    expect(canTransitionEmailStatus("processing", "sent")).toBe(true);
    expect(canTransitionEmailStatus("sent", "queued")).toBe(false);
    expect(canTransitionEmailStatus("dead_letter", "queued")).toBe(false);
  });
});


describe("brevo provider (fetch injectable)", () => {
  function okResponse(messageId = "<202608.abc@relay.brevo.com>") {
    return new Response(JSON.stringify({ messageId }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("respecte le contrat HTTP de Brevo", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const provider = createBrevoEmailProvider({
      apiKey: "xkeysib-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => new Date("2026-08-04T12:00:00.000Z"),
    });

    const result = await provider.send({
      timeoutMs: 5000,
      message: {
        to: { email: "client@exemple.test", name: "Société Martin" },
        from: { email: "relances@exemple.test", name: "Sidian" },
        replyTo: "contact@exemple.test",
        subject: "Rappel",
        text: "bonjour",
        html: "<p>bonjour</p>",
      },
    });

    expect(provider.kind).toBe("brevo");
    expect(result.providerMessageId).toBe("<202608.abc@relay.brevo.com>");

    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://api.brevo.com/v3/smtp/email");

    // Brevo s'authentifie par `api-key`, jamais par `Authorization: Bearer`.
    const headers = call[1].headers as Record<string, string>;
    expect(headers["api-key"]).toBe("xkeysib-test");
    expect(headers.Authorization).toBeUndefined();

    // Formes propres à Brevo : objets, et non chaînes « Nom <email> ».
    const body = JSON.parse(String(call[1].body)) as Record<string, unknown>;
    expect(body.sender).toEqual({
      email: "relances@exemple.test",
      name: "Sidian",
    });
    expect(body.to).toEqual([
      { email: "client@exemple.test", name: "Société Martin" },
    ]);
    expect(body.replyTo).toEqual({ email: "contact@exemple.test" });
    expect(body.htmlContent).toBe("<p>bonjour</p>");
    expect(body.textContent).toBe("bonjour");
  });

  it("refuse une réponse sans messageId plutôt que d'inventer un identifiant", async () => {
    const provider = createBrevoEmailProvider({
      apiKey: "xkeysib-test",
      fetchImpl: (async () =>
        new Response(JSON.stringify({}), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        })) as unknown as typeof fetch,
    });

    await expect(
      provider.send({
        timeoutMs: 5000,
        message: {
          to: { email: "client@exemple.test" },
          from: { email: "relances@exemple.test" },
          subject: "Rappel",
          text: "bonjour",
          html: "<p>bonjour</p>",
        },
      }),
    ).rejects.toThrow(/email_missing_message_id/);
  });

  it.each([
    [401, false],
    [400, false],
    [429, true],
    [503, true],
  ])("classifie le statut %i (rejouable : %s)", async (status, retryable) => {
    const provider = createBrevoEmailProvider({
      apiKey: "xkeysib-test",
      fetchImpl: (async () =>
        new Response(JSON.stringify({ code: "x", message: "y" }), {
          status,
          headers: { "Content-Type": "application/json" },
        })) as unknown as typeof fetch,
    });

    await provider
      .send({
        timeoutMs: 5000,
        message: {
          to: { email: "client@exemple.test" },
          from: { email: "relances@exemple.test" },
          subject: "Rappel",
          text: "bonjour",
          html: "<p>bonjour</p>",
        },
      })
      .then(
        () => {
          throw new Error("aurait dû échouer");
        },
        (error: unknown) => {
          expect(isEmailProviderError(error)).toBe(true);
          const typed = error as { retryable: boolean; message: string };
          expect(typed.retryable).toBe(retryable);
          // Le corps de réponse ne doit jamais fuiter dans le message.
          expect(typed.message).toBe(`email_http_${status}`);
        },
      );
  });
});
