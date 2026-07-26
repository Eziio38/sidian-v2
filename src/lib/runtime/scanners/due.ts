import type { ScannerCandidateSource } from "./candidates";
import { selectDueEligible } from "./eligibility";
import { runScannerBatch, type ScannerRunDeps, type ScannerRunResult } from "./runner";
import { WORKFLOW_POLICY, utcCalendarDate } from "../workflow-policy";

export async function runDueScanner(
  source: ScannerCandidateSource,
  deps: ScannerRunDeps,
): Promise<ScannerRunResult> {
  const policy = deps.policy ?? WORKFLOW_POLICY;
  const today = utcCalendarDate(deps.clock.now());
  const rows = await source.listOpenCreances();
  const eligible = selectDueEligible(rows, today, policy);
  return runScannerBatch({
    scannerKind: "due",
    eligible,
    deps,
  });
}
