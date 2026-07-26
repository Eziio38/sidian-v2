/**
 * Journal d’appels déterministe — vérifie l’ordre des contrôles (validation → permission → exécuteur).
 */

export type CallLogEntry =
  | { phase: "permission"; at: number }
  | { phase: "executor"; at: number; tool_id: string; tool_version: string }
  | { phase: "audit"; at: number };

export type CallLog = {
  entries: CallLogEntry[];
  nextSeq: () => number;
  recordPermission: () => void;
  recordExecutor: (toolId: string, toolVersion: string) => void;
  recordAudit: () => void;
  phases: () => Array<CallLogEntry["phase"]>;
  reset: () => void;
};

export function createCallLog(): CallLog {
  let seq = 0;
  const entries: CallLogEntry[] = [];

  return {
    entries,
    nextSeq: () => {
      seq += 1;
      return seq;
    },
    recordPermission: () => {
      seq += 1;
      entries.push({ phase: "permission", at: seq });
    },
    recordExecutor: (toolId, toolVersion) => {
      seq += 1;
      entries.push({
        phase: "executor",
        at: seq,
        tool_id: toolId,
        tool_version: toolVersion,
      });
    },
    recordAudit: () => {
      seq += 1;
      entries.push({ phase: "audit", at: seq });
    },
    phases: () => entries.map((e) => e.phase),
    reset: () => {
      seq = 0;
      entries.length = 0;
    },
  };
}
