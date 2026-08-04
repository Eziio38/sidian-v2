import type { ScannerCandidateSource } from "./candidates";
import { selectClosureEligible } from "./eligibility";
import { runScannerBatch, type ScannerRunDeps, type ScannerRunResult } from "./runner";

export async function runClosureScanner(
  source: ScannerCandidateSource,
  deps: ScannerRunDeps,
): Promise<ScannerRunResult> {
  const rows = await source.listTerminalCreances();
  const eligible = selectClosureEligible(rows);
  return runScannerBatch({
    scannerKind: "closure",
    eligible,
    deps,
  });
}
