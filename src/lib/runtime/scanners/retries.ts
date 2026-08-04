import type { ScannerCandidateSource } from "./candidates";
import { selectRetriesEligible } from "./eligibility";
import { runScannerBatch, type ScannerRunDeps, type ScannerRunResult } from "./runner";
import { WORKFLOW_POLICY } from "../workflow-policy";

/**
 * Scanner retries séparé.
 * MVP : `retry_policy = none` → enqueue notification / bascule lien manuel
 * uniquement. Jamais de replay Stripe (03 §3.3 / §6.6).
 */
export async function runRetriesScanner(
  source: ScannerCandidateSource,
  deps: ScannerRunDeps,
): Promise<ScannerRunResult> {
  const policy = deps.policy ?? WORKFLOW_POLICY;
  const rows = await source.listFailedTentatives();
  const eligible = selectRetriesEligible(rows, policy);
  return runScannerBatch({
    scannerKind: "retries",
    eligible,
    deps,
  });
}
