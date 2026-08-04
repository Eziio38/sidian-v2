#!/usr/bin/env node
/**
 * Détecte la dérive entre `supabase/migrations/**` et
 * `src/types/database.generated.ts`.
 *
 * Le fichier de types est un artefact généré par
 * `supabase gen types typescript --local`, qui exige une base Postgres locale,
 * donc Docker. Quand Docker n'est pas disponible, il est tentant de patcher le
 * fichier à la main — mais le patch serait écrasé à la régénération suivante,
 * et l'écart réel resterait invisible.
 *
 * Ce script rend l'écart mesurable et impossible à oublier.
 *
 * Ce qu'il ne vérifie PAS : la forme exacte des signatures. Il compare des noms
 * de tables, d'enums et de fonctions appelables. C'est volontairement grossier :
 * l'objectif est de détecter « les types n'ont pas été régénérés », pas de
 * réimplémenter le générateur.
 *
 * Usage :
 *   node scripts/check-generated-types.mjs            → rapport, sortie 0
 *   node scripts/check-generated-types.mjs --strict   → sortie 1 si dérive
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const GENERATED = path.join(ROOT, "src", "types", "database.generated.ts");

const strict = process.argv.includes("--strict");

const C = {
  reset: "[0m",
  dim: "[2m",
  bold: "[1m",
  green: "[32m",
  yellow: "[33m",
};

const generated = readFileSync(GENERATED, "utf8");
const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

/**
 * Les fonctions `returns trigger` ne sont jamais émises par le générateur :
 * elles ne sont pas appelables via PostgREST. Les exclure évite un rapport
 * bruyant qui ferait ignorer les vraies dérives.
 */
function isTriggerFunction(sql, startIndex) {
  const window = sql.slice(startIndex, startIndex + 600);
  return /returns\s+trigger/i.test(window);
}

const found = { tables: new Map(), enums: new Map(), functions: new Map() };

/*
 * Les migrations sont parcourues dans l'ordre chronologique et l'état est
 * rejoué : un objet supprimé par une migration ultérieure disparaît de
 * l'inventaire. Sans cela, trois fonctions Stripe créées en juillet puis
 * explicitement `drop function`-ées quelques jours plus tard étaient
 * rapportées comme « absentes des types » — alors qu'elles n'existent
 * simplement plus. Un contrôle qui produit des faux positifs finit ignoré.
 */
for (const file of files) {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");

  for (const m of sql.matchAll(
    /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi,
  )) {
    if (!found.tables.has(m[1])) found.tables.set(m[1], file);
  }
  for (const m of sql.matchAll(
    /drop\s+table\s+(?:if\s+exists\s+)?public\.(\w+)/gi,
  )) {
    found.tables.delete(m[1]);
  }

  for (const m of sql.matchAll(/create\s+type\s+public\.(\w+)\s+as\s+enum/gi)) {
    if (!found.enums.has(m[1])) found.enums.set(m[1], file);
  }
  for (const m of sql.matchAll(
    /drop\s+type\s+(?:if\s+exists\s+)?public\.(\w+)/gi,
  )) {
    found.enums.delete(m[1]);
  }

  for (const m of sql.matchAll(
    /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)/gi,
  )) {
    if (isTriggerFunction(sql, m.index)) continue;
    if (!found.functions.has(m[1])) found.functions.set(m[1], file);
  }
  for (const m of sql.matchAll(
    /drop\s+function\s+(?:if\s+exists\s+)?public\.(\w+)/gi,
  )) {
    found.functions.delete(m[1]);
  }
}

function drift(map) {
  const out = new Map();
  for (const [name, file] of map) {
    // Recherche par frontière de mot : un nom présent quelque part dans le
    // fichier généré est considéré comme couvert.
    if (new RegExp(`\\b${name}\\b`).test(generated)) continue;
    if (!out.has(file)) out.set(file, []);
    out.get(file).push(name);
  }
  return out;
}

const drifts = {
  Tables: drift(found.tables),
  Enums: drift(found.enums),
  Fonctions: drift(found.functions),
};

const affectedMigrations = new Set();
let total = 0;
for (const map of Object.values(drifts)) {
  for (const [file, names] of map) {
    affectedMigrations.add(file);
    total += names.length;
  }
}

if (total === 0) {
  console.log(
    `${C.green}✓${C.reset} Types générés à jour avec les ${files.length} migrations.`,
  );
  process.exit(0);
}

console.log(
  `${C.yellow}${C.bold}Types générés en retard${C.reset} — ${total} objet(s) SQL absent(s) de src/types/database.generated.ts`,
);
console.log(
  `${C.dim}${affectedMigrations.size} migration(s) concernée(s) sur ${files.length}.${C.reset}\n`,
);

for (const [label, map] of Object.entries(drifts)) {
  if (map.size === 0) continue;
  console.log(`${C.bold}${label}${C.reset}`);
  for (const [file, names] of [...map].sort()) {
    console.log(`  ${C.dim}${file}${C.reset}`);
    console.log(`    ${names.sort().join(", ")}`);
  }
  console.log();
}

console.log(`${C.bold}Correction${C.reset}`);
console.log("  1. Démarrer Docker, puis la base locale :");
console.log(`     ${C.dim}npx supabase@2.109.1 start${C.reset}`);
console.log("  2. Appliquer les migrations et régénérer :");
console.log(`     ${C.dim}pnpm supabase:reset && pnpm supabase:types${C.reset}`);
console.log(
  `\n${C.dim}Conséquence tant que ce n'est pas fait : les appels \`supabase.rpc()\` vers ces
fonctions ne sont pas typés. Le code existant contourne cela avec des types
structurels souples (ex. RuntimeJobRpcClient) — ce qui compile, mais ne protège
pas contre une signature erronée.${C.reset}`,
);

process.exit(strict ? 1 : 0);
