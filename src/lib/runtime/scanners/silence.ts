import type { ScannerCandidateSource } from "./candidates";
import { selectSilenceEligible } from "./eligibility";
import { runScannerBatch, type ScannerRunDeps, type ScannerRunResult } from "./runner";
import { WORKFLOW_POLICY, utcCalendarDate } from "../workflow-policy";

export async function runSilenceScanner(
  source: ScannerCandidateSource,
  deps: ScannerRunDeps,
): Promise<ScannerRunResult> {
  const policy = deps.policy ?? WORKFLOW_POLICY;
  const today = utcCalendarDate(deps.clock.now());
  const rows = await source.listOpenCreances();
  const eligible = selectSilenceEligible(rows, today, policy);
  return runScannerBatch({
    scannerKind: "silence",
    eligible,
    deps,
  });
}
