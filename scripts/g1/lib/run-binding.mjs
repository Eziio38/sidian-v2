/**
 * Exécution des bindings d’inventaire G1-A.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * @param {string} cwd
 * @param {string[]} argv
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: boolean, exit_code: number, timed_out: boolean }>}
 */
function runCommand(cwd, argv, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      // Évite le deadlock pipe plein : on hérite pour l’observabilité locale.
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env,
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        exit_code: 1,
        timed_out: false,
        error: error.message,
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const exitCode = timedOut ? 124 : code ?? (signal ? 1 : 0);
      resolve({
        ok: !timedOut && exitCode === 0,
        exit_code: exitCode,
        timed_out: timedOut,
      });
    });
  });
}

/**
 * @param {string} repoRoot
 * @param {{ type: string, command?: string, path?: string, asserts?: string[] }} binding
 */
export async function runBinding(repoRoot, binding) {
  if (!binding || typeof binding !== "object") {
    return {
      ok: false,
      exit_code: 1,
      error: "binding invalide",
    };
  }

  if (binding.type === "pnpm_script") {
    const command = binding.command;
    if (!command) {
      return { ok: false, exit_code: 1, error: "pnpm_script sans command" };
    }
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    );
    if (!pkg.scripts || !pkg.scripts[command]) {
      return {
        ok: false,
        exit_code: 1,
        error: `script pnpm inconnu: ${command}`,
        command,
      };
    }
    const result = await runCommand(repoRoot, ["pnpm", "run", command]);
    return { ...result, type: binding.type, command };
  }

  if (binding.type === "vitest_file") {
    const filePath = binding.path;
    if (!filePath) {
      return { ok: false, exit_code: 1, error: "vitest_file sans path" };
    }
    const absolute = path.join(repoRoot, filePath);
    if (!fs.existsSync(absolute)) {
      return {
        ok: false,
        exit_code: 1,
        error: `fichier Vitest introuvable: ${filePath}`,
        path: filePath,
      };
    }
    const result = await runCommand(repoRoot, [
      "pnpm",
      "exec",
      "vitest",
      "run",
      filePath,
    ]);
    return { ...result, type: binding.type, path: filePath };
  }

  return {
    ok: false,
    exit_code: 1,
    error: `type de binding non supporté: ${binding.type}`,
  };
}
