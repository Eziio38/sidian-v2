#!/usr/bin/env node
/**
 * Sauvegarde complète de la base Supabase hébergée.
 *
 * Pourquoi ce script existe : le projet est en plan Free, donc SANS PITR.
 * Une migration ratée ou une corruption n'a aucun chemin de retour tant que
 * personne n'a pris de dump. C'est le seul filet disponible.
 *
 * Trois volets, comme le préconise Supabase — les trois sont nécessaires,
 * un dump de données seul ne se restaure pas :
 *   1. rôles   (--role-only)   : les rôles du cluster
 *   2. schéma  (par défaut)    : tables, contraintes, fonctions, politiques RLS
 *   3. données (--data-only)   : le contenu, en COPY (plus rapide et plus sûr
 *                                que des INSERT pour de gros volumes)
 *
 * Usage :
 *   SUPABASE_DB_URL="postgresql://…" node scripts/backup-supabase.mjs
 *
 * La chaîne de connexion se récupère dans Supabase → Settings → Database →
 * Connection string → URI. Elle contient le mot de passe : ne la colle jamais
 * dans un chat, un ticket ou un commit. Ce script ne l'affiche nulle part et
 * ne l'écrit dans aucun fichier.
 *
 * Sortie : backups/<horodatage>/{roles,schema,data}.sql
 * Le répertoire backups/ est ignoré par git — ces fichiers contiennent des
 * données personnelles de débiteurs.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const DB_URL = process.env.SUPABASE_DB_URL;
const OUT_ROOT = process.env.SIDIAN_BACKUP_DIR ?? "backups";
const CLI = "node_modules/.bin/supabase";

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

if (!DB_URL || DB_URL.trim().length === 0) {
  fail(
    [
      "SUPABASE_DB_URL est absente.",
      "",
      "  SUPABASE_DB_URL=\"postgresql://…\" node scripts/backup-supabase.mjs",
      "",
      "Supabase → Settings → Database → Connection string → URI.",
      "Ne colle jamais cette chaîne dans un chat : elle contient le mot de passe.",
    ].join("\n"),
  );
}

if (!existsSync(CLI)) {
  fail(`CLI Supabase introuvable à ${CLI}. Lance d'abord "pnpm install".`);
}

// Horodatage UTC triable, sans caractère interdit sur les systèmes de fichiers.
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "Z");
const outDir = resolve(OUT_ROOT, stamp);
mkdirSync(outDir, { recursive: true });

/** Un volet de la sauvegarde. L'ordre compte à la restauration. */
const PARTS = [
  {
    name: "roles",
    file: "roles.sql",
    args: ["--role-only"],
    label: "rôles du cluster",
  },
  {
    name: "schema",
    file: "schema.sql",
    args: [],
    label: "schéma (tables, contraintes, fonctions, RLS)",
  },
  {
    name: "data",
    file: "data.sql",
    args: ["--data-only", "--use-copy"],
    label: "données",
  },
];

console.log(`\nSauvegarde vers ${outDir}\n`);

for (const part of PARTS) {
  const target = join(outDir, part.file);
  process.stdout.write(`  ${part.name.padEnd(7)} ${part.label} … `);

  const result = spawnSync(
    CLI,
    ["db", "dump", "--db-url", DB_URL, "-f", target, ...part.args],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
  );

  if (result.error) {
    console.log("échec");
    fail(`Impossible de lancer le CLI : ${result.error.message}`);
  }

  if (result.status !== 0) {
    console.log("échec");
    // stderr du CLI peut contenir la chaîne de connexion : on la masque.
    const stderr = String(result.stderr ?? "").replaceAll(DB_URL, "<DB_URL>");
    fail(`Volet "${part.name}" en échec (code ${result.status}) :\n${stderr}`);
  }

  const bytes = existsSync(target) ? statSync(target).size : 0;
  if (bytes === 0) {
    console.log("échec");
    fail(
      `Volet "${part.name}" a produit un fichier vide. Une sauvegarde vide n'est pas une sauvegarde — on s'arrête ici.`,
    );
  }

  console.log(`${(bytes / 1024).toFixed(0)} Ko`);
}

console.log(
  [
    "",
    "✓ Sauvegarde complète.",
    "",
    `  ${outDir}`,
    "",
    "Rappels :",
    "  · ces fichiers contiennent des données personnelles — ne les versionne pas,",
    "    ne les mets pas dans un dossier synchronisé public ;",
    "  · une sauvegarde jamais restaurée n'est pas une sauvegarde. La procédure",
    "    de restauration est dans docs/operations/RUNBOOK_SAUVEGARDE.md ;",
    "  · prends-en une AVANT chaque `supabase db push`.",
    "",
  ].join("\n"),
);
