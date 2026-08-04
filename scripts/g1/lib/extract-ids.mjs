/**
 * Extraction des identifiants EVAL-* / REQ-* depuis les documents normatifs.
 * Aucune liste manuelle embarquée : échec explicite si le parse est peu fiable.
 */

import fs from "node:fs";

const EVAL_ROW_RE = /^\| `(EVAL-[A-Z]+-\d+)` \|/gm;
const REQ_ROW_RE = /^\| `(REQ-[A-Z]+-\d+)` \|/gm;
const EVAL_ANY_RE = /`(EVAL-[A-Z]+-\d+)`/g;

/**
 * @param {string} evaluationsPath
 * @param {string} matrixPath
 */
export function extractNormativeIds(evaluationsPath, matrixPath) {
  if (!fs.existsSync(evaluationsPath)) {
    throw new Error(
      `Document d’évaluations introuvable: ${evaluationsPath}. Impossible d’extraire les EVAL-*.`,
    );
  }
  if (!fs.existsSync(matrixPath)) {
    throw new Error(
      `Matrice d’exigences introuvable: ${matrixPath}. Impossible d’extraire les REQ-*.`,
    );
  }

  const evaluationsDoc = fs.readFileSync(evaluationsPath, "utf8");
  const matrixDoc = fs.readFileSync(matrixPath, "utf8");

  const evaluationIds = uniqueMatches(evaluationsDoc, EVAL_ROW_RE);
  const requirementIds = uniqueMatches(matrixDoc, REQ_ROW_RE);

  if (evaluationIds.size === 0) {
    throw new Error(
      `Aucun EVAL-* extractible depuis ${evaluationsPath}. ` +
        `Format attendu: lignes de tableau markdown "| \`EVAL-…\` |".`,
    );
  }
  if (requirementIds.size === 0) {
    throw new Error(
      `Aucun REQ-* extractible depuis ${matrixPath}. ` +
        `Format attendu: lignes de tableau markdown "| \`REQ-…\` |".`,
    );
  }

  const declaredEvalCount = readDeclaredCount(
    matrixDoc,
    /cas d['’]évaluation\s*:\s*\*\*(\d+)\*\*/i,
    "cas d'évaluation",
  );
  const declaredReqCount = readDeclaredCount(
    matrixDoc,
    /exigences normalisées\s*:\s*\*\*(\d+)\*\*/i,
    "exigences normalisées",
  );

  if (evaluationIds.size !== declaredEvalCount) {
    throw new Error(
      `Parse EVAL peu fiable: ${evaluationIds.size} identifiants extraits de 09, ` +
        `mais la matrice déclare ${declaredEvalCount} cas d'évaluation. ` +
        `Vérifier le format des tableaux dans docs/agent/09_AGENT_EVALUATIONS.md.`,
    );
  }
  if (requirementIds.size !== declaredReqCount) {
    throw new Error(
      `Parse REQ peu fiable: ${requirementIds.size} identifiants extraits de la matrice, ` +
        `mais la matrice déclare ${declaredReqCount} exigences normalisées. ` +
        `Vérifier le format du tableau dans docs/agent/governance/REQUIREMENTS_MATRIX.md.`,
    );
  }

  const matrixEvalIds = uniqueMatches(matrixDoc, EVAL_ANY_RE);
  if (matrixEvalIds.size !== evaluationIds.size) {
    throw new Error(
      `Incohérence EVAL matrice↔09: matrice référence ${matrixEvalIds.size} EVAL-*, ` +
        `09 en catalogue ${evaluationIds.size}. Parse rejeté.`,
    );
  }
  for (const id of matrixEvalIds) {
    if (!evaluationIds.has(id)) {
      throw new Error(
        `EVAL référencé dans la matrice absent de 09: ${id}. Parse rejeté.`,
      );
    }
  }

  /** @type {Map<string, Set<string>>} */
  const evalToRequirements = new Map();
  for (const line of matrixDoc.split("\n")) {
    const reqMatch = line.match(/^\| `(REQ-[A-Z]+-\d+)` \|/);
    if (!reqMatch) continue;
    const reqId = reqMatch[1];
    const evalMatches = [...line.matchAll(EVAL_ANY_RE)].map((m) => m[1]);
    for (const evaluationId of evalMatches) {
      if (!evalToRequirements.has(evaluationId)) {
        evalToRequirements.set(evaluationId, new Set());
      }
      evalToRequirements.get(evaluationId).add(reqId);
    }
  }

  return {
    evaluationIds,
    requirementIds,
    evalToRequirements,
    declaredEvalCount,
    declaredReqCount,
  };
}

/**
 * @param {string} text
 * @param {RegExp} re
 */
function uniqueMatches(text, re) {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  const out = new Set();
  for (const match of text.matchAll(global)) {
    out.add(match[1]);
  }
  return out;
}

/**
 * @param {string} text
 * @param {RegExp} re
 * @param {string} label
 */
function readDeclaredCount(text, re, label) {
  const match = text.match(re);
  if (!match) {
    throw new Error(
      `Impossible de lire le compte déclaré « ${label} » dans la matrice. ` +
        `Format attendu du type: "${label} : **N**".`,
    );
  }
  return Number(match[1]);
}
