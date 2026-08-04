import { describe, expect, it } from "vitest";

import { createFixedClock } from "../clock";
import { createMemoryRuntimeJobRepository } from "../jobs/memory-repository";
import type {
  FailedTentativeSnapshot,
  OpenCreanceSnapshot,
  ScannerCandidateSource,
  TerminalCreanceSnapshot,
} from "./candidates";
import {
  selectAutoPayEligible,
  selectClosureEligible,
  selectDueEligible,
  selectPreventionEligible,
  selectRetriesEligible,
  selectSilenceEligible,
} from "./eligibility";
import { createMemoryScanLeaseRepository } from "./memory-lease-repository";
import { runAutoPayScanner } from "./auto-pay";
import { runClosureScanner } from "./closure";
import { runDueScanner } from "./due";
import { runPreventionScanner } from "./prevention";
import { runRetriesScanner } from "./retries";
import { runSilenceScanner } from "./silence";

const BASE_OPEN: OpenCreanceSnapshot = {
  creanceId: "11111111-1111-4111-8111-111111111111",
  prestataireId: "22222222-2222-4222-8222-222222222222",
  clientPayeurId: "33333333-3333-4333-8333-333333333333",
  dateEcheance: "2026-08-10",
  etat: "OUVERTE",
  dossierSuiviId: "44444444-4444-4444-8444-444444444444",
  dossierEtat: "PREVENTION",
  lastClientActivityAt: null,
  paymentLinkShareable: true,
  hasDefaultActiveAuthorization: false,
  soldeRestantCents: 12_000,
  isPauseLitige: false,
  silenceGraceDaysFromRegle: null,
};

function memorySource(input: {
  open?: OpenCreanceSnapshot[];
  terminal?: TerminalCreanceSnapshot[];
  failed?: FailedTentativeSnapshot[];
}): ScannerCandidateSource {
  return {
    async listOpenCreances() {
      return input.open ?? [];
    },
    async listTerminalCreances() {
      return input.terminal ?? [];
    },
    async listFailedTentatives() {
      return input.failed ?? [];
    },
  };
}

function deps(nowIso: string) {
  return {
    clock: createFixedClock(nowIso),
    leases: createMemoryScanLeaseRepository(),
    jobs: createMemoryRuntimeJobRepository(),
    batchSize: 50,
    leaseSeconds: 120,
  };
}

describe("scanner eligibility + enqueue", () => {
  it("prevention: J-5 window enqueues prevention_notice once", async () => {
    const d = deps("2026-08-05T10:00:00.000Z");
    const source = memorySource({ open: [BASE_OPEN] });
    const eligible = selectPreventionEligible(
      [BASE_OPEN],
      "2026-08-05",
    );
    expect(eligible).toHaveLength(1);

    const first = await runPreventionScanner(source, d);
    expect(first.enqueuedCount).toBe(1);
    expect(first.jobIds).toHaveLength(1);
    expect([...d.jobs.jobs.values()][0]?.jobKind).toBe("prevention_notice");

    // Reclaim blocked by completed lease + idempotent job
    const second = await runPreventionScanner(source, d);
    expect(second.claimedCount).toBe(0);
    expect(second.enqueuedCount).toBe(0);
    expect(d.jobs.jobs.size).toBe(1);
  });

  it("due: on day J enqueues due_send_link without calling transports", async () => {
    const d = deps("2026-08-10T08:00:00.000Z");
    expect(selectDueEligible([BASE_OPEN], "2026-08-10")).toHaveLength(1);
    const result = await runDueScanner(memorySource({ open: [BASE_OPEN] }), d);
    expect(result.enqueuedCount).toBe(1);
    const job = [...d.jobs.jobs.values()][0]!;
    expect(job.jobKind).toBe("due_send_link");
    expect(job.payload.require_shareable).toBe(true);
  });

  it("silence: grace after due → silence_escalate, never IRRECOUVRABLE", async () => {
    const d = deps("2026-08-24T12:00:00.000Z");
    const row = {
      ...BASE_OPEN,
      dossierEtat: "SUIVI_AMIABLE" as const,
    };
    expect(selectSilenceEligible([row], "2026-08-24")).toHaveLength(1);
    const result = await runSilenceScanner(memorySource({ open: [row] }), d);
    expect(result.enqueuedCount).toBe(1);
    const job = [...d.jobs.jobs.values()][0]!;
    expect(job.jobKind).toBe("silence_escalate");
    expect(job.payload.never_irrecouvrable_automatic).toBe(true);
    expect(job.payload.target_dossier_etat).toBe("ESCALADE_HUMAINE");
  });

  it("silence: recent client activity delays escalation", () => {
    const row = {
      ...BASE_OPEN,
      dossierEtat: "SUIVI_AMIABLE" as const,
      lastClientActivityAt: "2026-08-20T15:00:00.000Z",
    };
    // grace 14 depuis activité 20 → seuil 03/09
    expect(selectSilenceEligible([row], "2026-08-24")).toHaveLength(0);
    expect(selectSilenceEligible([row], "2026-09-03")).toHaveLength(1);
  });

  it("closure: terminal creance → closure_close_dossier", async () => {
    const d = deps("2026-08-15T12:00:00.000Z");
    const terminal: TerminalCreanceSnapshot = {
      creanceId: BASE_OPEN.creanceId,
      prestataireId: BASE_OPEN.prestataireId,
      dateEcheance: BASE_OPEN.dateEcheance,
      etat: "REGLEE",
      dossierSuiviId: BASE_OPEN.dossierSuiviId,
      dossierEtat: "ECHEANCE",
    };
    expect(selectClosureEligible([terminal])).toHaveLength(1);
    const result = await runClosureScanner(
      memorySource({ terminal: [terminal] }),
      d,
    );
    expect(result.enqueuedCount).toBe(1);
    expect([...d.jobs.jobs.values()][0]?.jobKind).toBe(
      "closure_close_dossier",
    );
  });

  it("auto-pay: due + auth default → autopay_intent only", async () => {
    const d = deps("2026-08-10T09:00:00.000Z");
    const row = {
      ...BASE_OPEN,
      hasDefaultActiveAuthorization: true,
    };
    expect(selectAutoPayEligible([row], "2026-08-10")).toHaveLength(1);
    const result = await runAutoPayScanner(memorySource({ open: [row] }), d);
    expect(result.enqueuedCount).toBe(1);
    const job = [...d.jobs.jobs.values()][0]!;
    expect(job.jobKind).toBe("autopay_intent");
    expect(job.payload.create_tentative_intent).toBe(true);
    expect(job.payload.source).toBe("prelevement_auto");
  });

  it("auto-pay: skips pause litige and missing authorization", () => {
    expect(
      selectAutoPayEligible(
        [
          {
            ...BASE_OPEN,
            hasDefaultActiveAuthorization: true,
            isPauseLitige: true,
          },
        ],
        "2026-08-10",
      ),
    ).toHaveLength(0);
    expect(
      selectAutoPayEligible(
        [{ ...BASE_OPEN, hasDefaultActiveAuthorization: false }],
        "2026-08-10",
      ),
    ).toHaveLength(0);
  });

  it("retries: policy none enqueues notify fallback, never stripe replay", async () => {
    const d = deps("2026-08-11T10:00:00.000Z");
    const failed: FailedTentativeSnapshot = {
      tentativeId: "55555555-5555-4555-8555-555555555555",
      creanceId: BASE_OPEN.creanceId,
      prestataireId: BASE_OPEN.prestataireId,
      dossierSuiviId: BASE_OPEN.dossierSuiviId,
      etat: "ECHOUEE",
      failedAt: "2026-08-10T18:00:00.000Z",
    };
    expect(selectRetriesEligible([failed])).toHaveLength(1);
    const result = await runRetriesScanner(
      memorySource({ failed: [failed] }),
      d,
    );
    expect(result.enqueuedCount).toBe(1);
    const job = [...d.jobs.jobs.values()][0]!;
    expect(job.jobKind).toBe("retry_failed_notify");
    expect(job.payload.retry_policy).toBe("none");
    expect(job.payload.never_replay_ambiguous_stripe).toBe(true);
    expect(job.payload.action).toBe(
      "notify_prestataire_manual_link_fallback",
    );
  });

  it("crash recovery: expired lease can be reclaimed and job stays idempotent", async () => {
    const leases = createMemoryScanLeaseRepository();
    const jobs = createMemoryRuntimeJobRepository();
    const source = memorySource({ open: [BASE_OPEN] });

    const first = await runPreventionScanner(source, {
      clock: createFixedClock("2026-08-05T10:00:00.000Z"),
      leases,
      jobs,
    });
    expect(first.enqueuedCount).toBe(1);

    // Simulate crash before complete: reopen claim by expiring lease manually
    const key = [...leases.rows.keys()][0]!;
    const row = leases.rows.get(key)!;
    row.status = "claimed";
    row.leaseToken = "00000000-0000-4000-8000-000000000099";
    row.leaseExpiresAt = "2026-08-05T09:00:00.000Z"; // expired

    const second = await runPreventionScanner(source, {
      clock: createFixedClock("2026-08-05T11:00:00.000Z"),
      leases,
      jobs,
    });
    expect(second.claimedCount).toBe(1);
    expect(second.enqueuedCount).toBe(0);
    expect(second.duplicateCount).toBe(1);
    expect(jobs.jobs.size).toBe(1);
  });

  it("bounded batch respects batchSize", async () => {
    const open = Array.from({ length: 5 }, (_, i) => ({
      ...BASE_OPEN,
      creanceId: `11111111-1111-4111-8111-11111111111${i}`,
    }));
    const d = {
      ...deps("2026-08-05T10:00:00.000Z"),
      batchSize: 2,
    };
    const result = await runPreventionScanner(memorySource({ open }), d);
    expect(result.candidateCount).toBe(5);
    expect(result.claimedCount).toBe(2);
    expect(result.enqueuedCount).toBe(2);
  });

  it("double worker: concurrent claim does not double-enqueue", async () => {
    const leases = createMemoryScanLeaseRepository();
    const jobs = createMemoryRuntimeJobRepository();
    const source = memorySource({ open: [BASE_OPEN] });
    const shared = {
      clock: createFixedClock("2026-08-05T10:00:00.000Z"),
      leases,
      jobs,
      batchSize: 50,
      leaseSeconds: 120,
    };

    const [a, b] = await Promise.all([
      runPreventionScanner(source, shared),
      runPreventionScanner(source, shared),
    ]);

    expect(a.claimedCount + b.claimedCount).toBeLessThanOrEqual(2);
    expect(a.enqueuedCount + b.enqueuedCount).toBe(1);
    expect(jobs.jobs.size).toBe(1);
  });

  it("non-eligible creance ignored (outside prevention window)", () => {
    expect(selectPreventionEligible([BASE_OPEN], "2026-08-01")).toHaveLength(0);
    expect(selectPreventionEligible([BASE_OPEN], "2026-08-10")).toHaveLength(0);
  });
});
