#!/usr/bin/env node
/**
 * SIDIAN G1-A — harness d’inventaire et d’exécution des preuves déterministes.
 *
 * - catalogue YAML = index d’exécution non normatif
 * - EVAL-* / REQ-* extraits depuis les documents 09 + matrice
 * - rapports JSON → artifacts/g1/ (gitignorés)
 * - ne réécrit pas docs/implementation/SID_GATE_G1A_EVIDENCE.md
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { parse as parseYaml } from "yaml";

import { extractNormativeIds } from "./g1/lib/extract-ids.mjs";
import { runBinding } from "./g1/lib/run-binding.mjs";
import {
  decideVerdict,
  summarizeVerdicts,
  VERDICTS,
} from "./g1/lib/verdicts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CATALOG_PATH = path.join(REPO_ROOT, "scripts/g1/catalog.yaml");
const SCHEMA_PATH = path.join(REPO_ROOT, "scripts/g1/schema.catalog.json");
const ARTIFACTS_DIR = path.join(REPO_ROOT, "artifacts/g1");

function parseArgs(argv) {
  const options = {
    strictInventory: false,
    skipBindings: false,
  };
  for (const arg of argv) {
    if (arg === "--") continue;
    if (arg === "--strict-inventory") options.strictInventory = true;
    else if (arg === "--skip-bindings") options.skipBindings = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/test-g1-harness.mjs [--strict-inventory] [--skip-bindings]

  --strict-inventory  Échoue si un EVAL-* du périmètre (préfixes catalogue)
                      est absent du catalogue.
  --skip-bindings     N’exécute pas les bindings (validation catalogue seule).
`);
      process.exit(0);
    } else {
      throw new Error(`Argument inconnu: ${arg}`);
    }
  }
  return options;
}

function loadCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) {
    throw new Error(`Catalogue introuvable: ${CATALOG_PATH}`);
  }
  if (!fs.existsSync(SCHEMA_PATH)) {
    throw new Error(`Schéma catalogue introuvable: ${SCHEMA_PATH}`);
  }

  const raw = fs.readFileSync(CATALOG_PATH, "utf8");
  let catalog;
  try {
    catalog = parseYaml(raw);
  } catch (error) {
    throw new Error(
      `Échec de parse YAML du catalogue: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (catalog?.normative === true) {
    throw new Error(
      "Le catalogue se déclare normative: true — interdit (index d’exécution non normatif uniquement).",
    );
  }

  validateAgainstSchema(catalog, JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8")));
  return catalog;
}

/**
 * Validation JSON Schema minimale (sous-ensemble requis par G1-A).
 * Évite une dépendance Ajv ; échoue explicitement sur écart de structure.
 */
function validateAgainstSchema(data, schema) {
  const errors = [];
  checkNode(data, schema, "$", errors);
  if (errors.length > 0) {
    throw new Error(
      `Catalogue invalide selon scripts/g1/schema.catalog.json:\n- ${errors.slice(0, 20).join("\n- ")}` +
        (errors.length > 20 ? `\n- … (${errors.length - 20} autres)` : ""),
    );
  }
}

function checkNode(value, schema, pointer, errors) {
  if (!schema || typeof schema !== "object") return;

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${pointer}: attendu const ${JSON.stringify(schema.const)}`);
    return;
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = types.some((t) => {
      if (t === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
      if (t === "array") return Array.isArray(value);
      if (t === "string") return typeof value === "string";
      if (t === "boolean") return typeof value === "boolean";
      if (t === "number") return typeof value === "number";
      return false;
    });
    if (!ok) {
      errors.push(`${pointer}: type invalide (attendu ${types.join("|")})`);
      return;
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${pointer}: valeur hors enum`);
  }
  if (schema.pattern && typeof value === "string") {
    if (!new RegExp(schema.pattern).test(value)) {
      errors.push(`${pointer}: ne respecte pas pattern ${schema.pattern}`);
    }
  }
  if (schema.minLength !== undefined && typeof value === "string" && value.length < schema.minLength) {
    errors.push(`${pointer}: minLength ${schema.minLength}`);
  }
  if (schema.minItems !== undefined && Array.isArray(value) && value.length < schema.minItems) {
    errors.push(`${pointer}: minItems ${schema.minItems}`);
  }
  if (schema.uniqueItems && Array.isArray(value)) {
    if (new Set(value.map((v) => JSON.stringify(v))).size !== value.length) {
      errors.push(`${pointer}: uniqueItems violé`);
    }
  }
  if (schema.required && typeof value === "object" && value !== null) {
    for (const key of schema.required) {
      if (!(key in value)) errors.push(`${pointer}: propriété requise manquante « ${key} »`);
    }
  }
  if (schema.additionalProperties === false && value && typeof value === "object" && !Array.isArray(value)) {
    const allowed = new Set(Object.keys(schema.properties || {}));
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) errors.push(`${pointer}: propriété additionnelle interdite « ${key} »`);
    }
  }
  if (schema.properties && value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (key in value) checkNode(value[key], childSchema, `${pointer}.${key}`, errors);
    }
  }
  if (schema.items && Array.isArray(value)) {
    value.forEach((item, index) => {
      checkNode(item, schema.items, `${pointer}[${index}]`, errors);
    });
  }
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      if (sub.if && sub.then) {
        const ifErrors = [];
        checkNode(value, sub.if, pointer, ifErrors);
        if (ifErrors.length === 0) {
          checkNode(value, sub.then, pointer, errors);
        }
      } else {
        checkNode(value, sub, pointer, errors);
      }
    }
  }
}

function gitCommit(repoRoot) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function resolveSpecPaths(catalog) {
  const evaluationsPath = path.join(REPO_ROOT, catalog.spec_documents.evaluations.path);
  const matrixPath = path.join(
    REPO_ROOT,
    catalog.spec_documents.requirements_matrix.path,
  );
  return { evaluationsPath, matrixPath };
}

function assertCatalogIds(catalog, normative) {
  const seen = new Set();
  for (const entry of catalog.entries) {
    if (seen.has(entry.evaluation_id)) {
      throw new Error(`evaluation_id dupliqué dans le catalogue: ${entry.evaluation_id}`);
    }
    seen.add(entry.evaluation_id);

    if (!normative.evaluationIds.has(entry.evaluation_id)) {
      throw new Error(
        `evaluation_id absent de 09: ${entry.evaluation_id}`,
      );
    }

    for (const pillar of entry.g1_pillars) {
      if (!catalog.g1_pillars.includes(pillar)) {
        throw new Error(
          `${entry.evaluation_id}: g1_pillar « ${pillar} » hors liste catalogue.g1_pillars`,
        );
      }
    }

    for (const req of entry.requirements || []) {
      if (!normative.requirementIds.has(req)) {
        throw new Error(
          `${entry.evaluation_id}: requirement absent de la matrice: ${req}`,
        );
      }
    }

    if (entry.coverage.kind === "exact" && (!entry.bindings || entry.bindings.length === 0)) {
      throw new Error(`${entry.evaluation_id}: exact sans bindings`);
    }
    if (entry.coverage.kind === "none" && entry.bindings?.length > 0) {
      throw new Error(`${entry.evaluation_id}: none avec bindings — incohérent`);
    }
    if (
      entry.coverage.kind === "not_applicable" &&
      !entry.coverage.na_justification
    ) {
      throw new Error(`${entry.evaluation_id}: not_applicable sans na_justification`);
    }

    for (const binding of entry.bindings || []) {
      if (binding.type === "pnpm_script" && !binding.command) {
        throw new Error(`${entry.evaluation_id}: pnpm_script sans command`);
      }
      if (binding.type === "vitest_file" && !binding.path) {
        throw new Error(`${entry.evaluation_id}: vitest_file sans path`);
      }
    }

    // Séparation des couches: requirements ne doit contenir que REQ-*
    for (const req of entry.requirements || []) {
      if (!/^REQ-[A-Z]+-\d+$/.test(req)) {
        throw new Error(
          `${entry.evaluation_id}: requirements mélange des identifiants non REQ-*: ${req}`,
        );
      }
    }
    if (entry.source_decisions) {
      for (const [bucket, ids] of Object.entries(entry.source_decisions)) {
        for (const id of ids) {
          if (/^(REQ|EVAL)-/.test(id)) {
            throw new Error(
              `${entry.evaluation_id}: source_decisions.${bucket} contient ${id} — séparer REQ/EVAL des décisions source.`,
            );
          }
        }
      }
    }
  }
}

function assertStrictInventory(catalog, normative) {
  const prefixes = catalog.strict_inventory?.id_prefixes || [];
  if (prefixes.length === 0) {
    throw new Error("strict_inventory.id_prefixes vide — inventaire strict impossible.");
  }

  const catalogIds = new Set(catalog.entries.map((e) => e.evaluation_id));
  const missing = [];
  for (const evaluationId of normative.evaluationIds) {
    if (prefixes.some((prefix) => evaluationId.startsWith(prefix))) {
      if (!catalogIds.has(evaluationId)) missing.push(evaluationId);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Inventaire strict incomplet (${missing.length} EVAL manquant(s) pour préfixes ${prefixes.join(", ")}):\n` +
        missing.slice(0, 30).join(", ") +
        (missing.length > 30 ? `, … (+${missing.length - 30})` : ""),
    );
  }

  const coveredPillars = new Set();
  for (const entry of catalog.entries) {
    for (const pillar of entry.g1_pillars) coveredPillars.add(pillar);
  }
  const missingPillars = catalog.g1_pillars.filter((p) => !coveredPillars.has(p));
  if (missingPillars.length > 0) {
    throw new Error(
      `Inventaire strict: piliers G1 sans aucune entrée catalogue: ${missingPillars.join(", ")}`,
    );
  }
}

async function evaluateEntries(catalog, options) {
  const results = [];
  /** @type {Map<string, { ok: boolean, exit_code?: number, error?: string }>} */
  const bindingCache = new Map();

  for (const entry of catalog.entries) {
    const bindingResults = [];
    if (!options.skipBindings && entry.coverage.kind !== "not_applicable") {
      for (const binding of entry.bindings || []) {
        const cacheKey = JSON.stringify(binding);
        if (!bindingCache.has(cacheKey)) {
          process.stderr.write(
            `→ binding ${binding.type} ${binding.command || binding.path}\n`,
          );
          bindingCache.set(cacheKey, await runBinding(REPO_ROOT, binding));
        }
        const observed = bindingCache.get(cacheKey);
        bindingResults.push({
          ...binding,
          ...observed,
        });
      }
    }

    const decision = decideVerdict({
      coverageKind: entry.coverage.kind,
      bindingResults: options.skipBindings ? [] : bindingResults,
      naJustification: entry.coverage.na_justification,
    });

    // skip-bindings: exact cannot PASS without running
    let verdict = decision.verdict;
    let detail = decision.detail;
    let guard = decision.false_pass_guard;
    if (options.skipBindings && entry.coverage.kind === "exact") {
      verdict = VERDICTS.BLOCKED;
      detail = "Bindings non exécutés (--skip-bindings).";
      guard = "skip_bindings";
    } else if (
      options.skipBindings &&
      (entry.coverage.kind === "partial" ||
        entry.coverage.kind === "analog" ||
        entry.coverage.kind === "none")
    ) {
      verdict = VERDICTS.BLOCKED;
      guard = decision.false_pass_guard;
    }

    results.push({
      evaluation_id: entry.evaluation_id,
      requirements: entry.requirements || [],
      source_decisions: entry.source_decisions || null,
      g1_pillars: entry.g1_pillars,
      coverage_kind: entry.coverage.kind,
      coverage_rationale: entry.coverage.rationale,
      verdict,
      false_pass_guard: guard,
      detail,
      bindings_observed: bindingResults,
    });
  }

  return results;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const catalog = loadCatalog();
  const { evaluationsPath, matrixPath } = resolveSpecPaths(catalog);
  const normative = extractNormativeIds(evaluationsPath, matrixPath);

  assertCatalogIds(catalog, normative);
  if (options.strictInventory) {
    assertStrictInventory(catalog, normative);
  }

  // Vérifie que chaque requirement listé est bien relié à l’EVAL dans la matrice
  // (le catalogue reste un index; la matrice reste la source de vérité REQ↔EVAL).
  for (const entry of catalog.entries) {
    const linked = normative.evalToRequirements.get(entry.evaluation_id) || new Set();
    for (const req of entry.requirements || []) {
      if (!linked.has(req)) {
        throw new Error(
          `${entry.evaluation_id}: requirement ${req} listé dans le catalogue ` +
            `mais non relié à cet EVAL dans REQUIREMENTS_MATRIX.md.`,
        );
      }
    }
  }

  const entryResults = await evaluateEntries(catalog, options);
  const summary = summarizeVerdicts(entryResults);
  const failedBindings = entryResults.flatMap((e) =>
    (e.bindings_observed || [])
      .filter((b) => !b.ok)
      .map((b) => ({
        evaluation_id: e.evaluation_id,
        binding: b.command || b.path,
        exit_code: b.exit_code,
        error: b.error || null,
      })),
  );

  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(ARTIFACTS_DIR, `g1a-${timestamp}.json`);
  const report = {
    gate: "G1",
    lot: catalog.lot,
    catalog_version: catalog.catalog_version,
    normative: false,
    git_commit: gitCommit(REPO_ROOT),
    generated_at: new Date().toISOString(),
    options,
    extracted: {
      evaluation_count: normative.evaluationIds.size,
      requirement_count: normative.requirementIds.size,
      declared_evaluation_count: normative.declaredEvalCount,
      declared_requirement_count: normative.declaredReqCount,
    },
    summary,
    failed_bindings: failedBindings,
    note:
      "G1-A = inventaire. Un Gate G1 global PASS exige 0 BLOCKED/FAIL sur le périmètre Blocking G1.",
    entries: entryResults,
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log("\n=== SIDIAN G1-A harness ===");
  console.log(`Catalogue: ${path.relative(REPO_ROOT, CATALOG_PATH)}`);
  console.log(
    `EVAL extraits: ${normative.evaluationIds.size} | REQ extraits: ${normative.requirementIds.size}`,
  );
  console.log(
    `Entrées catalogue: ${catalog.entries.length} | Rapport: ${path.relative(REPO_ROOT, reportPath)}`,
  );
  console.log(
    `PASS=${summary.pass} FAIL=${summary.fail} BLOCKED=${summary.blocked} NOT_APPLICABLE=${summary.not_applicable}`,
  );
  if (failedBindings.length > 0) {
    console.log("\nBindings en échec:");
    for (const failure of failedBindings) {
      console.log(
        `  ✗ ${failure.evaluation_id} → ${failure.binding} (exit ${failure.exit_code})${
          failure.error ? ` — ${failure.error}` : ""
        }`,
      );
    }
  }

  // G1-A réussit si le harness est cohérent et qu’aucun binding n’échoue.
  // Des BLOCKED sont attendus et n’échouent pas le lot A.
  if (summary.fail > 0 || failedBindings.length > 0) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = 0;
}

main().catch((error) => {
  console.error(`\n✗ G1-A harness: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
