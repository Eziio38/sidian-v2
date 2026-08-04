#!/usr/bin/env node
/**
 * `pnpm validate:release` — porte de qualité avant déploiement.
 *
 * Principe directeur : un contrôle qui ne peut pas s'exécuter faute de secret
 * ou de dépendance locale est rapporté **NON CONFIGURÉ**, jamais **ÉCHEC**.
 * Seul un contrôle qui s'exécute réellement et échoue fait échouer la release.
 *
 * Aucune valeur secrète n'est lue ni affichée par ce script.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const C = {
  reset: "[0m",
  dim: "[2m",
  bold: "[1m",
  green: "[32m",
  yellow: "[33m",
  red: "[31m",
  blue: "[36m",
};

const args = new Set(process.argv.slice(2));
const includeSql = args.has("--with-sql");

/** Docker est requis par la base Supabase locale, elle-même requise par les suites SQL. */
function dockerAvailable() {
  const r = spawnSync("docker", ["info"], { stdio: "ignore" });
  return r.status === 0;
}

const results = [];

/**
 * Contrôle informatif : signale un problème réel sans bloquer la release.
 * Réservé aux écarts que l'on ne peut pas corriger sur cette machine — typiquement
 * la régénération des types, qui exige Docker.
 */
function runAdvisory({ name, command, cmdArgs }) {
  const r = spawnSync(command, cmdArgs, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    shell: false,
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.trimEnd();
  // Le script sort en 0 même en cas de dérive : on détecte l'écart au contenu.
  const clean = /Types générés à jour/.test(output);
  if (clean) {
    console.log(`${C.green}✓${C.reset} ${name}`);
    results.push({ name, status: "PASS" });
    return;
  }
  console.log(`${C.yellow}!${C.reset} ${name} ${C.dim}— avertissement${C.reset}`);
  results.push({ name, status: "WARN", output });
}

function run({ name, command, cmdArgs, skipReason }) {
  if (skipReason) {
    results.push({ name, status: "NOT_CONFIGURED", reason: skipReason });
    console.log(
      `${C.dim}○${C.reset} ${name} ${C.dim}— NON CONFIGURÉ : ${skipReason}${C.reset}`,
    );
    return;
  }

  process.stdout.write(`${C.blue}⋯${C.reset} ${name}…`);
  const started = Date.now();
  const r = spawnSync(command, cmdArgs, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    shell: false,
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (r.status === 0) {
    console.log(`\r${C.green}✓${C.reset} ${name} ${C.dim}(${seconds}s)${C.reset}      `);
    results.push({ name, status: "PASS" });
    return;
  }

  console.log(`\r${C.red}✗${C.reset} ${name} ${C.dim}(${seconds}s)${C.reset}      `);
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.trimEnd();
  const tail = output.split("\n").slice(-25).join("\n");
  results.push({ name, status: "FAIL", output: tail });
}

console.log(`${C.bold}${C.blue}Sidian — validation de release${C.reset}\n`);

run({ name: "TypeScript", command: "pnpm", cmdArgs: ["exec", "tsc", "--noEmit"] });
run({ name: "ESLint", command: "pnpm", cmdArgs: ["lint"] });
run({ name: "Design system", command: "pnpm", cmdArgs: ["design-system:check"] });
runAdvisory({
  name: "Types Supabase générés",
  command: "node",
  cmdArgs: [path.join(ROOT, "scripts", "check-generated-types.mjs")],
});
run({
  name: "Tests unitaires et composants (vitest)",
  command: "pnpm",
  cmdArgs: ["exec", "vitest", "run"],
});
run({ name: "Build de production", command: "pnpm", cmdArgs: ["build"] });

// Les suites SQL exigent une base Supabase locale, donc Docker.
const sqlSkip = !includeSql
  ? "non demandé (relancer avec --with-sql)"
  : !dockerAvailable()
    ? "Docker n'est pas démarré — la base Supabase locale est indisponible"
    : null;
run({
  name: "Suites SQL, RLS et isolation multi-utilisateurs",
  command: "pnpm",
  cmdArgs: ["test:sql"],
  skipReason: sqlSkip,
});

// `git diff --check` : espaces en fin de ligne, marqueurs de conflit.
run({
  name: "git diff --check",
  command: "git",
  cmdArgs: ["diff", "--check"],
  skipReason: existsSync(path.join(ROOT, ".git")) ? null : "hors dépôt git",
});

// Diagnostic de configuration — informatif, jamais bloquant ici : `doctor`
// dépend de l'environnement de la machine, pas de la qualité du code.
console.log();
const doctor = spawnSync("node", [path.join(ROOT, "scripts", "doctor.mjs")], {
  cwd: ROOT,
  stdio: ["ignore", "pipe", "pipe"],
  encoding: "utf8",
});
const doctorBlocking = doctor.status !== 0;

// ── Rapport ───────────────────────────────────────────────────────────────
const warned = results.filter((r) => r.status === "WARN")
const failed = results.filter((r) => r.status === "FAIL");
const skipped = results.filter((r) => r.status === "NOT_CONFIGURED");
const passed = results.filter((r) => r.status === "PASS");

for (const f of failed) {
  console.log(`\n${C.red}${C.bold}── ${f.name} ──${C.reset}`);
  console.log(f.output);
}

console.log(
  `\n${C.bold}Résultat${C.reset} : ${C.green}${passed.length} réussi(s)${C.reset}` +
    `, ${C.red}${failed.length} échec(s)${C.reset}` +
    `, ${C.yellow}${warned.length} avertissement(s)${C.reset}` +
    `, ${C.dim}${skipped.length} non configuré(s)${C.reset}`,
);

for (const w of warned) {
  console.log(`\n${C.yellow}${C.bold}── ${w.name} ──${C.reset}`);
  console.log(w.output);
}

if (skipped.length > 0) {
  console.log(`\n${C.bold}Non configurés — à exécuter avant la mise en production${C.reset}`);
  for (const s of skipped) console.log(`  ${C.dim}○${C.reset} ${s.name} — ${s.reason}`);
}

if (doctorBlocking) {
  console.log(
    `\n${C.yellow}Configuration :${C.reset} \`pnpm doctor\` signale au moins un problème bloquant pour cet environnement.`,
  );
}

if (failed.length > 0) {
  console.log(`\n${C.red}${C.bold}FIXES_REQUIRED${C.reset}`);
  process.exit(1);
}

console.log(
  `\n${C.green}${C.bold}PASS${C.reset} ${C.dim}— tous les contrôles exécutables ont réussi.${C.reset}`,
);
if (skipped.length > 0) {
  console.log(
    `${C.dim}Cette validation ne couvre pas les contrôles listés « non configurés » ci-dessus.${C.reset}`,
  );
}
process.exit(0);
