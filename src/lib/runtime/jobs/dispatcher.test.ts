import { describe, expect, it } from "vitest";

import {
  buildTestRuntimeJobContext,
  createMemoryRuntimeJobRepository,
  type MemoryRuntimeJobRepository,
} from "./memory-repository";
import {
  closeDossierHandler,
  DEFAULT_RUNTIME_JOB_HANDLERS,
  dispatchRuntimeJobs,
  UNWIRED_JOB_KINDS,
  type RuntimeJobHandler,
} from "./dispatcher";
import { createMemoryRelanceMailer } from "./handlers/memory-mailer";
import {
  buildRelanceEmailIdempotencyKey,
  RELANCE_ERROR_CODES,
} from "./handlers/relance";
import { resolveRelanceMailerStatus } from "./handlers/mailer";
import {
  formatDateEcheanceLabel,
  formatMontantLabel,
} from "./handlers/format";
import type { WorkflowJobKind, WorkflowScannerKind } from "../workflow-policy";

const NOW = "2026-08-03T10:00:00.000Z";

function at(offsetSeconds: number): string {
  return new Date(Date.parse(NOW) + offsetSeconds * 1000).toISOString();
}

async function seedJob(
  repo: MemoryRuntimeJobRepository,
  overrides: {
    jobKind?: WorkflowJobKind;
    scannerKind?: WorkflowScannerKind;
    creanceId?: string;
    idempotencyKey?: string;
  } = {},
) {
  return repo.enqueue({
    prestataireId: "prestataire-1",
    creanceId: overrides.creanceId ?? "creance-1",
    dossierSuiviId: "dossier-1",
    scannerKind: overrides.scannerKind ?? "closure",
    jobKind: overrides.jobKind ?? "closure_close_dossier",
    policyVersion: "2026-07-26.v1",
    idempotencyKey: overrides.idempotencyKey ?? "closure-creance-1-REGLEE",
    payload: { target_dossier_etat: "CLOS" },
    now: NOW,
  });
}

describe("dispatchRuntimeJobs — la boucle scanner → effet", () => {
  it("traite un job de clôture et l'acquitte", async () => {
    const repo = createMemoryRuntimeJobRepository();
    await seedJob(repo);

    const result = await dispatchRuntimeJobs({
      repository: repo,
      now: () => new Date(NOW),
    });

    expect(result.claimed).toBe(1);
    expect(result.completed).toBe(1);
    expect(result.terminal).toBe(0);
    expect(repo.closeDossierCalls).toEqual(["creance-1"]);
    expect([...repo.jobs.values()][0].status).toBe("completed");
  });

  it("un job acquitté n'est jamais re-claimé", async () => {
    const repo = createMemoryRuntimeJobRepository();
    await seedJob(repo);

    await dispatchRuntimeJobs({ repository: repo, now: () => new Date(NOW) });
    const second = await dispatchRuntimeJobs({
      repository: repo,
      now: () => new Date(at(600)),
    });

    expect(second.claimed).toBe(0);
    expect(repo.closeDossierCalls).toHaveLength(1);
  });

  it("un dossier déjà clos est un succès, pas une erreur", async () => {
    // Le rejeu doit être idempotent : c'est la garantie qui rend sûr le
    // re-claim après expiration de lease.
    const repo = createMemoryRuntimeJobRepository();
    await seedJob(repo);
    repo.closeDossierOutcomes.set("creance-1", "already_closed");

    const result = await dispatchRuntimeJobs({
      repository: repo,
      now: () => new Date(NOW),
    });

    expect(result.completed).toBe(1);
    expect(result.terminal).toBe(0);
  });

  it("une créance redevenue active échoue en terminal, sans réessai inutile", async () => {
    const repo = createMemoryRuntimeJobRepository();
    await seedJob(repo);
    repo.closeDossierOutcomes.set("creance-1", "creance_not_terminal");

    const result = await dispatchRuntimeJobs({
      repository: repo,
      now: () => new Date(NOW),
    });

    expect(result.terminal).toBe(1);
    expect(result.retryable).toBe(0);
    expect([...repo.jobs.values()][0].status).toBe("failed_terminal");
  });
});

describe("types de jobs sans handler", () => {
  it("ne sont jamais claimés et restent en attente", async () => {
    // Le point le plus important : un câblage manquant ne doit pas consommer
    // les tentatives d'un job ni le pousser en échec terminal.
    const repo = createMemoryRuntimeJobRepository();
    await seedJob(repo, {
      jobKind: "autopay_intent",
      scannerKind: "auto_pay",
      idempotencyKey: "autopay-creance-1-2026-08-03",
    });

    const result = await dispatchRuntimeJobs({
      repository: repo,
      now: () => new Date(NOW),
    });

    expect(result.claimed).toBe(0);
    const job = [...repo.jobs.values()][0];
    expect(job.status).toBe("pending");
    expect(job.attemptCount).toBe(0);
  });

  it("autopay_intent reste le seul type non câblé, et pour une raison produit", () => {
    // Les relances ont quitté cette liste : leur cadence est versionnée dans
    // WORKFLOW_POLICY et leurs gabarits existent. Seul le prélèvement
    // automatique reste bloqué en amont, faute de plafond de règle arbitré.
    expect(Object.keys(UNWIRED_JOB_KINDS)).toEqual(["autopay_intent"]);
    expect(UNWIRED_JOB_KINDS.autopay_intent).toContain(
      "AUTO_DEBIT_REGLE_CEILING_PRODUCT_READY=false",
    );
  });

  it("sont signalés dans le rapport avec leur raison", async () => {
    const repo = createMemoryRuntimeJobRepository();
    await seedJob(repo, {
      jobKind: "autopay_intent",
      scannerKind: "auto_pay",
      idempotencyKey: "autopay-creance-1-2026-08-03",
    });

    const result = await dispatchRuntimeJobs({
      repository: repo,
      now: () => new Date(NOW),
    });

    expect(result.unwired).toEqual([
      {
        jobKind: "autopay_intent",
        reason: UNWIRED_JOB_KINDS.autopay_intent,
        pending: 1,
      },
    ]);
  });

  it("chaque type non câblé porte une raison explicite", () => {
    const wired = Object.keys(DEFAULT_RUNTIME_JOB_HANDLERS);
    const allKinds: WorkflowJobKind[] = [
      "prevention_notice",
      "due_send_link",
      "silence_escalate",
      "closure_close_dossier",
      "autopay_intent",
      "retry_failed_notify",
    ];
    for (const kind of allKinds) {
      if (wired.includes(kind)) continue;
      expect(
        UNWIRED_JOB_KINDS[kind],
        `${kind} doit documenter pourquoi il n'est pas câblé`,
      ).toBeTruthy();
    }
  });
});

describe("résilience", () => {
  it("une exception du handler est rejouable, avec backoff", async () => {
    const repo = createMemoryRuntimeJobRepository();
    await seedJob(repo);
    const throwing: RuntimeJobHandler = async () => {
      throw new Error("supabase_unreachable");
    };

    const result = await dispatchRuntimeJobs({
      repository: repo,
      handlers: { closure_close_dossier: throwing },
      now: () => new Date(NOW),
    });

    expect(result.retryable).toBe(1);
    const job = [...repo.jobs.values()][0];
    expect(job.status).toBe("failed_retryable");
    expect(job.lastErrorCode).toBe("supabase_unreachable");
    // Backoff : le job n'est pas immédiatement re-disponible.
    expect(Date.parse(job.availableAt)).toBeGreaterThan(Date.parse(NOW));
  });

  it("le backoff croît et le job finit en terminal au plafond", async () => {
    const repo = createMemoryRuntimeJobRepository();
    await seedJob(repo);
    const throwing: RuntimeJobHandler = async () => {
      throw new Error("boom");
    };

    const delays: number[] = [];
    let clock = Date.parse(NOW);
    for (let i = 0; i < 6; i += 1) {
      await dispatchRuntimeJobs({
        repository: repo,
        handlers: { closure_close_dossier: throwing },
        maxAttempts: 3,
        backoffBaseSeconds: 60,
        now: () => new Date(clock),
      });
      const job = [...repo.jobs.values()][0];
      if (job.status === "failed_retryable") {
        delays.push((Date.parse(job.availableAt) - clock) / 1000);
        clock = Date.parse(job.availableAt);
      }
    }

    // 60 s, puis 120 s : croissance exponentielle.
    expect(delays.slice(0, 2)).toEqual([60, 120]);
    // Au plafond de tentatives, le job sort de la file au lieu de la bloquer.
    expect([...repo.jobs.values()][0].status).toBe("failed_terminal");
  });

  it("un lease expiré rend le job re-claimable — reprise après crash", async () => {
    const repo = createMemoryRuntimeJobRepository();
    await seedJob(repo);

    // Worker qui meurt : il claime puis n'acquitte jamais.
    const claimed = await repo.claim({
      now: NOW,
      leaseSeconds: 120,
      batchSize: 10,
      jobKinds: ["closure_close_dossier"],
    });
    expect(claimed).toHaveLength(1);

    // Avant expiration : personne d'autre ne peut le prendre.
    const tooEarly = await dispatchRuntimeJobs({
      repository: repo,
      now: () => new Date(at(60)),
    });
    expect(tooEarly.claimed).toBe(0);

    // Après expiration : reprise automatique.
    const recovered = await dispatchRuntimeJobs({
      repository: repo,
      now: () => new Date(at(300)),
    });
    expect(recovered.claimed).toBe(1);
    expect(recovered.completed).toBe(1);
  });

  it("un acquittement sous lease perdu est signalé, jamais compté comme succès", async () => {
    const repo = createMemoryRuntimeJobRepository();
    await seedJob(repo);

    // Le handler prend assez de temps pour que le lease expire.
    const slow: RuntimeJobHandler = async () => ({ status: "completed" });
    let call = 0;
    const clock = () => {
      call += 1;
      // 1er appel = ranAt, 2e = jobNow, 3e = acquittement (après expiration).
      return new Date(call >= 3 ? at(1000) : NOW);
    };

    const result = await dispatchRuntimeJobs({
      repository: repo,
      handlers: { closure_close_dossier: slow },
      leaseSeconds: 60,
      now: clock,
    });

    expect(result.completed).toBe(0);
    expect(result.leaseLost).toBe(1);
  });

  it("respecte la deadline du cron sans perdre les jobs restants", async () => {
    const repo = createMemoryRuntimeJobRepository();
    for (let i = 0; i < 3; i += 1) {
      await seedJob(repo, {
        creanceId: `creance-${i}`,
        idempotencyKey: `closure-creance-${i}-REGLEE`,
      });
    }

    const result = await dispatchRuntimeJobs({
      repository: repo,
      now: () => new Date(NOW),
      isDeadlineExpired: () => true,
    });

    expect(result.claimed).toBe(3);
    expect(result.completed).toBe(0);
    expect(repo.closeDossierCalls).toHaveLength(0);

    // Les jobs sont rendus au pool, et surtout : sans consommer de tentative.
    expect(result.released).toBe(3);
    for (const job of repo.jobs.values()) {
      expect(job.status).toBe("pending");
      expect(job.attemptCount).toBe(0);
    }
  });

  it("un job repoussé à chaque passage n'épuise jamais ses tentatives", async () => {
    // Régression : sans relâchement, un job systématiquement pris en fin de lot
    // était re-claimé à chaque cron, incrémentant attempt_count sans jamais être
    // exécuté — jusqu'à buter sur la contrainte SQL `attempt_count <= 32`, ce
    // qui faisait échouer le claim de TOUT le lot.
    const repo = createMemoryRuntimeJobRepository();
    await seedJob(repo);

    for (let i = 0; i < 40; i += 1) {
      await dispatchRuntimeJobs({
        repository: repo,
        now: () => new Date(at(i * 300)),
        isDeadlineExpired: () => true,
      });
    }

    const job = [...repo.jobs.values()][0];
    expect(job.attemptCount).toBe(0);
    expect(job.status).toBe("pending");

    // Et il reste traitable une fois le budget disponible.
    const done = await dispatchRuntimeJobs({
      repository: repo,
      now: () => new Date(at(20_000)),
    });
    expect(done.completed).toBe(1);
  });

  it("cesse de claimer au-delà du plafond de tentatives", async () => {
    // Miroir de la borne SQL : au-delà, le job sort de la file au lieu de faire
    // échouer le claim du lot entier sur violation de contrainte.
    const repo = createMemoryRuntimeJobRepository();
    await seedJob(repo);
    [...repo.jobs.values()][0].attemptCount = 32;

    const result = await dispatchRuntimeJobs({
      repository: repo,
      now: () => new Date(NOW),
    });

    expect(result.claimed).toBe(0);
  });

  it("borne le lot claimé", async () => {
    const repo = createMemoryRuntimeJobRepository();
    for (let i = 0; i < 10; i += 1) {
      await seedJob(repo, {
        creanceId: `creance-${i}`,
        idempotencyKey: `closure-creance-${i}-REGLEE`,
      });
    }

    const result = await dispatchRuntimeJobs({
      repository: repo,
      batchSize: 4,
      now: () => new Date(NOW),
    });

    expect(result.claimed).toBe(4);
  });
});

describe("relances — la boucle job → email", () => {
  const RELANCE_KINDS: Array<{
    jobKind: WorkflowJobKind;
    scannerKind: WorkflowScannerKind;
  }> = [
    { jobKind: "prevention_notice", scannerKind: "prevention" },
    { jobKind: "due_send_link", scannerKind: "due" },
    { jobKind: "silence_escalate", scannerKind: "silence" },
    { jobKind: "retry_failed_notify", scannerKind: "retries" },
  ];

  async function seedRelance(
    kind: (typeof RELANCE_KINDS)[number],
    contextOverrides: Parameters<typeof buildTestRuntimeJobContext>[0] = {
      creanceId: "creance-1",
    },
  ) {
    const repo = createMemoryRuntimeJobRepository();
    repo.jobContexts.set(
      contextOverrides.creanceId,
      buildTestRuntimeJobContext(contextOverrides),
    );
    await seedJob(repo, {
      jobKind: kind.jobKind,
      scannerKind: kind.scannerKind,
      creanceId: contextOverrides.creanceId,
      idempotencyKey: `${kind.jobKind}:${contextOverrides.creanceId}:2026-08-03`,
    });
    return repo;
  }

  it("prevention_notice enfile un rappel avant échéance, sans lien", async () => {
    const repo = await seedRelance(RELANCE_KINDS[0]);
    const mailer = createMemoryRelanceMailer();

    const result = await dispatchRuntimeJobs({
      repository: repo,
      mailer,
      now: () => new Date(NOW),
    });

    expect(result.completed).toBe(1);
    expect(mailer.sent).toHaveLength(1);
    const email = mailer.sent[0];
    expect(email.templateKey).toBe("reminder_before_due");
    expect(email.tenantId).toBe("prestataire-1");
    expect(email.recipient.email).toBe("client@exemple.test");
    expect(email.relatedEntityId).toBe("creance-1");
    // Exactement les variables obligatoires du gabarit, formatées en français.
    expect(email.variables).toEqual({
      prestataireName: "Atelier Dupont",
      clientName: "Société Martin",
      amountLabel: formatMontantLabel(125_000, "EUR"),
      dueDateLabel: "3 août 2026",
    });
  });

  it("retry_failed_notify enfile la notification d'échec de paiement", async () => {
    const repo = await seedRelance(RELANCE_KINDS[3]);
    const mailer = createMemoryRelanceMailer();

    const result = await dispatchRuntimeJobs({
      repository: repo,
      mailer,
      now: () => new Date(NOW),
    });

    expect(result.completed).toBe(1);
    expect(mailer.sent[0].templateKey).toBe("payment_failed");
    expect(mailer.sent[0].variables).toEqual({
      prestataireName: "Atelier Dupont",
      clientName: "Société Martin",
      amountLabel: formatMontantLabel(125_000, "EUR"),
    });
  });

  it("un rejeu n'envoie jamais deux fois — la propriété qui compte", async () => {
    // Le rejeu est la norme, pas l'exception : lease expiré, reprise après
    // crash, backoff. Deux relances identiques au même client seraient un
    // dommage produit direct.
    const repo = await seedRelance(RELANCE_KINDS[0]);
    const mailer = createMemoryRelanceMailer();

    await dispatchRuntimeJobs({
      repository: repo,
      mailer,
      now: () => new Date(NOW),
    });

    // Le job repart en file comme s'il n'avait jamais été acquitté.
    const job = [...repo.jobs.values()][0];
    job.status = "pending";
    job.attemptCount = 0;

    const second = await dispatchRuntimeJobs({
      repository: repo,
      mailer,
      now: () => new Date(at(600)),
    });

    expect(second.completed).toBe(1);
    // Deux demandes, un seul envoi retenu.
    expect(mailer.calls).toHaveLength(2);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.calls[0].idempotencyKey).toBe(mailer.calls[1].idempotencyKey);
  });

  it("la clé d'idempotence email dérive de celle du job", async () => {
    const repo = await seedRelance(RELANCE_KINDS[0]);
    const mailer = createMemoryRelanceMailer();
    await dispatchRuntimeJobs({
      repository: repo,
      mailer,
      now: () => new Date(NOW),
    });

    const job = [...repo.jobs.values()][0];
    expect(mailer.sent[0].idempotencyKey).toBe(
      buildRelanceEmailIdempotencyKey(job.idempotencyKey),
    );
  });

  it("replie sur une empreinte si la clé du job dépasse la borne de l'outbox", () => {
    // Tronquer ferait collisionner deux occurrences métier distinctes.
    const long = "x".repeat(256);
    const key = buildRelanceEmailIdempotencyKey(long);
    expect(key.length).toBeLessThanOrEqual(256);
    expect(key.startsWith("runtime_job:sha256:")).toBe(true);
    expect(buildRelanceEmailIdempotencyKey(long)).toBe(key);
    expect(buildRelanceEmailIdempotencyKey(`${long}y`)).not.toBe(key);
  });

  it("due_send_link refuse d'envoyer sans URL de lien — jamais de faux lien", async () => {
    // `payment_link` ne stocke que le hash du jeton : l'URL n'existe pas côté
    // serveur. Le gabarit `reminder_after_due` l'exige et sa copie annonce le
    // lien. On échoue plutôt que d'envoyer une promesse vide.
    const repo = await seedRelance(RELANCE_KINDS[1], {
      creanceId: "creance-1",
      paymentLinkActive: true,
      paymentLinkId: "link-1",
    });
    const mailer = createMemoryRelanceMailer();

    const result = await dispatchRuntimeJobs({
      repository: repo,
      mailer,
      now: () => new Date(NOW),
    });

    expect(mailer.sent).toHaveLength(0);
    expect(result.completed).toBe(0);
    expect(result.terminal).toBe(1);
    expect(result.items[0].errorCode).toBe(
      RELANCE_ERROR_CODES.paymentLinkUrlUnavailable,
    );
  });

  it("silence_escalate n'envoie rien : aucun gabarit ne dit l'escalade", async () => {
    const repo = await seedRelance(RELANCE_KINDS[2]);
    const mailer = createMemoryRelanceMailer();

    const result = await dispatchRuntimeJobs({
      repository: repo,
      mailer,
      now: () => new Date(NOW),
    });

    expect(mailer.sent).toHaveLength(0);
    expect(result.items[0].errorCode).toBe(
      RELANCE_ERROR_CODES.escalationTemplateUnavailable,
    );
    expect(result.retryable).toBe(0);
  });

  it("un canal désactivé produit un échec visible, jamais un faux succès", async () => {
    const repo = await seedRelance(RELANCE_KINDS[0]);
    const mailer = createMemoryRelanceMailer({
      available: false,
      errorCode: "email_provider_disabled",
    });

    const result = await dispatchRuntimeJobs({
      repository: repo,
      mailer,
      now: () => new Date(NOW),
    });

    expect(result.completed).toBe(0);
    expect(result.terminal).toBe(1);
    expect(result.items[0].errorCode).toBe("email_provider_disabled");
    // Rien n'a même été tenté : pas de file fantôme.
    expect(mailer.calls).toHaveLength(0);
    // Et surtout : aucune lecture de contexte, donc aucune PII manipulée.
    expect(repo.loadJobContextCalls).toHaveLength(0);
  });

  it("sans canal injecté, la relance échoue au lieu d'être acquittée", async () => {
    const repo = await seedRelance(RELANCE_KINDS[0]);

    const result = await dispatchRuntimeJobs({
      repository: repo,
      now: () => new Date(NOW),
    });

    expect(result.completed).toBe(0);
    expect(result.items[0].errorCode).toBe(RELANCE_ERROR_CODES.mailerMissing);
  });

  it("un job dont la créance appartient à un autre prestataire n'envoie rien", async () => {
    // Le contexte tient son périmètre de la créance ; le job du scanner. Une
    // divergence ne doit jamais aboutir à écrire l'adresse d'un tiers dans un
    // email attribué à un autre tenant.
    const repo = await seedRelance(RELANCE_KINDS[0], {
      creanceId: "creance-1",
      prestataireId: "prestataire-2",
      clientEmail: "client-de-b@exemple.test",
    });
    const mailer = createMemoryRelanceMailer();

    const result = await dispatchRuntimeJobs({
      repository: repo,
      mailer,
      now: () => new Date(NOW),
    });

    expect(mailer.calls).toHaveLength(0);
    expect(result.terminal).toBe(1);
    expect(result.items[0].errorCode).toBe(RELANCE_ERROR_CODES.tenantMismatch);
  });

  it("une créance disparue entre le scan et l'envoi échoue sans réessai", async () => {
    const repo = createMemoryRuntimeJobRepository();
    await seedJob(repo, {
      jobKind: "prevention_notice",
      scannerKind: "prevention",
      idempotencyKey: "prevention_notice:creance-1:2026-08-03",
    });
    const mailer = createMemoryRelanceMailer();

    const result = await dispatchRuntimeJobs({
      repository: repo,
      mailer,
      now: () => new Date(NOW),
    });

    expect(result.terminal).toBe(1);
    expect(result.items[0].errorCode).toBe(RELANCE_ERROR_CODES.contextNotFound);
  });

  it("un client sans adresse n'est pas relancé", async () => {
    const repo = await seedRelance(RELANCE_KINDS[0], {
      creanceId: "creance-1",
      clientEmail: "   ",
    });
    const mailer = createMemoryRelanceMailer();

    const result = await dispatchRuntimeJobs({
      repository: repo,
      mailer,
      now: () => new Date(NOW),
    });

    expect(mailer.calls).toHaveLength(0);
    expect(result.items[0].errorCode).toBe(
      RELANCE_ERROR_CODES.recipientMissing,
    );
  });
});

describe("porte d'honnêteté du canal email", () => {
  it("un fournisseur désactivé est déclaré indisponible", () => {
    expect(
      resolveRelanceMailerStatus({
        enabled: false,
        providerKind: "brevo",
        mode: "disabled",
        httpTimeoutMs: 8_000,
      }),
    ).toEqual({ available: false, errorCode: "email_provider_disabled" });
  });

  it("un fournisseur activé est disponible", () => {
    expect(
      resolveRelanceMailerStatus({
        enabled: true,
        providerKind: "brevo",
        mode: "live",
        apiKey: "clé-de-test",
        fromAddress: "relances@exemple.test",
        httpTimeoutMs: 8_000,
      }),
    ).toEqual({ available: true });
  });
});

describe("libellés français des relances", () => {
  it("formate les montants dans la devise de la créance", () => {
    // Espaces insécables : on compare la structure, pas les octets exacts.
    const eur = formatMontantLabel(125_000, "EUR");
    expect(eur).toContain("1");
    expect(eur).toContain("250,00");
    expect(eur).toContain("€");
    // Une créance en devise étrangère n'est jamais affichée en euros.
    expect(formatMontantLabel(125_000, "CHF")).not.toContain("€");
  });

  it("formate les dates en forme longue française, en UTC", () => {
    expect(formatDateEcheanceLabel("2026-08-03")).toBe("3 août 2026");
    expect(formatDateEcheanceLabel("2026-01-01")).toBe("1 janvier 2026");
    // Une entrée non civile reste lisible plutôt que « Invalid Date ».
    expect(formatDateEcheanceLabel("inconnue")).toBe("inconnue");
  });
});

describe("closeDossierHandler", () => {
  const job = {
    id: "job-1",
    prestataireId: "p1",
    creanceId: "c1",
    dossierSuiviId: null,
    scannerKind: "closure" as const,
    jobKind: "closure_close_dossier" as const,
    policyVersion: "v1",
    idempotencyKey: "k",
    payload: {},
    status: "claimed" as const,
    availableAt: NOW,
    createdAt: NOW,
    leaseToken: "lease",
    leaseExpiresAt: at(120),
    attemptCount: 1,
  };

  it("traduit chaque issue SQL en décision de rejeu explicite", async () => {
    const cases: Array<[string, "completed" | "failed", boolean]> = [
      ["closed", "completed", false],
      ["already_closed", "completed", false],
      ["creance_not_found", "failed", false],
      ["creance_not_terminal", "failed", false],
      ["transition_forbidden", "failed", false],
    ];

    for (const [outcome, expectedStatus, expectedRetryable] of cases) {
      const repo = createMemoryRuntimeJobRepository();
      repo.closeDossierOutcomes.set("c1", outcome as "closed");
      const result = await closeDossierHandler(job, {
        now: NOW,
        repository: repo,
      });
      expect(result.status, outcome).toBe(expectedStatus);
      if (result.status === "failed") {
        // Aucune de ces issues ne se résout en réessayant à l'identique.
        expect(result.retryable, outcome).toBe(expectedRetryable);
      }
    }
  });
});

describe("préférences de notification", () => {
  async function runRelance(
    jobKind: "prevention_notice" | "retry_failed_notify",
    prefs: Partial<{
      notifyReminderBeforeDue: boolean;
      notifyPaymentFailed: boolean;
    }>,
  ) {
    const repo = createMemoryRuntimeJobRepository();
    const mailer = createMemoryRelanceMailer();
    await repo.enqueue({
      prestataireId: "prestataire-1",
      creanceId: "creance-pref",
      dossierSuiviId: null,
      scannerKind: jobKind === "prevention_notice" ? "prevention" : "retries",
      jobKind,
      policyVersion: "2026-07-26.v1",
      idempotencyKey: `${jobKind}-creance-pref-2026-08-03`,
      payload: {},
      now: NOW,
    });
    repo.jobContexts.set(
      "creance-pref",
      buildTestRuntimeJobContext({ creanceId: "creance-pref", ...prefs }),
    );
    const result = await dispatchRuntimeJobs({
      repository: repo,
      mailer,
      now: () => new Date(NOW),
    });
    return { result, mailer, repo };
  }

  it("envoie quand la préférence est active", async () => {
    const { result, mailer } = await runRelance("prevention_notice", {
      notifyReminderBeforeDue: true,
    });
    expect(result.completed).toBe(1);
    expect(mailer.sent).toHaveLength(1);
  });

  it("n'envoie rien quand le prestataire a désactivé la relance", async () => {
    // Un réglage qui n'empêche pas l'envoi est un réglage mensonger.
    const { result, mailer, repo } = await runRelance("prevention_notice", {
      notifyReminderBeforeDue: false,
    });
    expect(mailer.sent).toHaveLength(0);
    expect(result.terminal).toBe(1);
    expect([...repo.jobs.values()][0].lastErrorCode).toBe(
      RELANCE_ERROR_CODES.notificationDisabled,
    );
  });

  it("le refus n'est pas rejoué à chaque passage du cron", async () => {
    const { repo, mailer } = await runRelance("prevention_notice", {
      notifyReminderBeforeDue: false,
    });
    const again = await dispatchRuntimeJobs({
      repository: repo,
      mailer,
      now: () => new Date(at(100_000)),
    });
    expect(again.claimed).toBe(0);
  });

  it("chaque préférence ne gouverne que sa propre relance", async () => {
    // Couper la prévention ne doit pas couper l'alerte d'échec de paiement.
    const { result, mailer } = await runRelance("retry_failed_notify", {
      notifyReminderBeforeDue: false,
      notifyPaymentFailed: true,
    });
    expect(result.completed).toBe(1);
    expect(mailer.sent).toHaveLength(1);

    const off = await runRelance("retry_failed_notify", {
      notifyPaymentFailed: false,
    });
    expect(off.mailer.sent).toHaveLength(0);
    expect(off.result.terminal).toBe(1);
  });
});
