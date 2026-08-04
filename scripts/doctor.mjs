#!/usr/bin/env node
/**
 * `pnpm doctor` — état de configuration de l'environnement courant.
 *
 * Règle absolue : ce script n'affiche JAMAIS la valeur d'un secret.
 * Il n'affiche que « défini » / « absent », et pour quelques variables non
 * sensibles (mode, modèle, environnement) la valeur elle-même.
 *
 * Il ne se connecte à aucun service : il ne peut donc pas prétendre qu'une clé
 * est valide, seulement qu'elle est présente. Une capacité non configurée est
 * signalée NON CONFIGURÉ, jamais EN ÉCHEC.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Charge .env.local sans dépendance externe, uniquement pour le diagnostic local.
function loadLocalEnv() {
  const file = path.join(ROOT, ".env.local");
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}

const C = {
  reset: "[0m",
  dim: "[2m",
  bold: "[1m",
  green: "[32m",
  yellow: "[33m",
  red: "[31m",
  blue: "[36m",
};

const present = (name) => {
  const v = process.env[name];
  return typeof v === "string" && v.trim() !== "";
};
const value = (name, fallback = "—") =>
  present(name) ? process.env[name].trim() : fallback;

const blocking = [];
const todo = [];

function line(status, label, detail = "") {
  const badge =
    status === "ok"
      ? `${C.green}●${C.reset}`
      : status === "warn"
        ? `${C.yellow}●${C.reset}`
        : status === "off"
          ? `${C.dim}○${C.reset}`
          : `${C.red}●${C.reset}`;
  console.log(`  ${badge} ${label}${detail ? ` ${C.dim}${detail}${C.reset}` : ""}`);
}

function section(title) {
  console.log(`\n${C.bold}${title}${C.reset}`);
}

/**
 * Diagnostic d'un fournisseur à trois modes (disabled | stub | live).
 * Le contrat est le même pour l'IA, l'email et WhatsApp.
 */
function provider({ label, enabledVar, modeVar, secrets, publicVars = [] }) {
  const enabled = value(enabledVar, "false") === "true";
  const mode = value(modeVar, "disabled");

  if (!enabled) {
    line("off", label, `désactivé (${enabledVar}=false) — NON CONFIGURÉ`);
    todo.push(`${label} : fournir les secrets puis passer ${enabledVar}=true`);
    return;
  }

  const missing = secrets.filter((s) => !present(s));
  if (mode === "live" && missing.length > 0) {
    line("err", label, `mode live mais ${missing.length} secret(s) absent(s)`);
    blocking.push(
      `${label} : ${enabledVar}=true en mode live, mais ${missing.join(", ")} absent(s).`,
    );
    return;
  }
  if (mode === "stub") {
    line("warn", label, "mode stub — aucun envoi réel (local uniquement)");
    return;
  }
  line("ok", label, `mode ${mode}${publicVars.length ? ` · ${publicVars.map((v) => value(v)).join(" · ")}` : ""}`);
}

loadLocalEnv();

console.log(`${C.bold}${C.blue}Sidian — diagnostic de configuration${C.reset}`);
console.log(
  `${C.dim}Aucune valeur secrète n'est affichée. Aucun service n'est contacté.${C.reset}`,
);

// ── Environnement ─────────────────────────────────────────────────────────
section("Environnement");
const sidianEnv = value("SIDIAN_ENVIRONMENT", "local");
const onVercel = present("VERCEL_ENV");
line(
  sidianEnv === "local" && !onVercel ? "ok" : sidianEnv !== "local" ? "ok" : "warn",
  "SIDIAN_ENVIRONMENT",
  sidianEnv,
);
if (onVercel) line("ok", "VERCEL_ENV", value("VERCEL_ENV"));

const appUrl = value("NEXT_PUBLIC_APP_URL", "");
if (!appUrl) {
  line("err", "NEXT_PUBLIC_APP_URL", "absent — retombe sur http://localhost:3000");
  blocking.push(
    "NEXT_PUBLIC_APP_URL absent : cette URL est intégrée aux liens de paiement envoyés aux clients.",
  );
} else if (sidianEnv !== "local" && appUrl.includes("localhost")) {
  line("err", "NEXT_PUBLIC_APP_URL", `${appUrl} — localhost hors environnement local`);
  blocking.push(
    `NEXT_PUBLIC_APP_URL vaut ${appUrl} alors que SIDIAN_ENVIRONMENT=${sidianEnv}.`,
  );
} else {
  line("ok", "NEXT_PUBLIC_APP_URL", appUrl);
}

// ── Supabase ──────────────────────────────────────────────────────────────
section("Supabase");
for (const [name, required] of [
  ["NEXT_PUBLIC_SUPABASE_URL", true],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", true],
  ["SUPABASE_SERVICE_ROLE_KEY", true],
]) {
  if (present(name)) line("ok", name, "défini");
  else {
    line(required ? "err" : "warn", name, "absent");
    if (required) blocking.push(`${name} absent — l'application ne peut pas démarrer.`);
  }
}
for (const name of [
  "SIDIAN_SUPABASE_PROJECT_REF",
  "SUPABASE_ENVIRONMENT_ATTESTATION_JWT",
]) {
  if (present(name)) line("ok", name, "défini");
  else if (onVercel) {
    line("err", name, "absent — obligatoire sur Vercel");
    blocking.push(`${name} absent alors que le déploiement est sur Vercel.`);
  } else line("off", name, "absent — requis uniquement sur Vercel");
}

// ── Migrations ────────────────────────────────────────────────────────────
section("Migrations");
const migrationsDir = path.join(ROOT, "supabase", "migrations");
const migrations = existsSync(migrationsDir)
  ? readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()
  : [];
line("ok", `${migrations.length} migration(s) dans le dépôt`);
if (migrations.length > 0) {
  console.log(`    ${C.dim}dernière : ${migrations[migrations.length - 1]}${C.reset}`);
}
console.log(
  `    ${C.dim}Ce script ne peut pas savoir lesquelles sont appliquées — vérifier côté Supabase.${C.reset}`,
);

// ── Stripe ────────────────────────────────────────────────────────────────
section("Stripe (paiements clients — Connect)");
const stripeEnabled = value("NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED", "false") === "true";
if (!stripeEnabled) {
  line("off", "Stripe", "désactivé (NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED=false) — NON CONFIGURÉ");
  todo.push("Stripe : créer le compte, activer Connect, renseigner les clés.");
} else {
  const stripeMode = value("STRIPE_MODE", "test");
  line("ok", "Mode", stripeMode);
  for (const name of [
    "STRIPE_SECRET_KEY",
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    "STRIPE_CONNECT_WEBHOOK_SECRET",
  ]) {
    if (present(name)) line("ok", name, "défini");
    else {
      line("err", name, "absent");
      blocking.push(`${name} absent alors que les paiements Stripe sont activés.`);
    }
  }
  // Cohérence mode / préfixe de clé, sans révéler la clé.
  const secret = value("STRIPE_SECRET_KEY", "");
  if (secret.startsWith("sk_live_") && sidianEnv !== "production") {
    blocking.push("Clé Stripe live détectée hors production.");
    line("err", "Cohérence clé/environnement", "clé live hors production");
  } else if (secret.startsWith("sk_test_") && sidianEnv === "production") {
    blocking.push("Clé Stripe de test détectée en production.");
    line("err", "Cohérence clé/environnement", "clé test en production");
  }
}
line(
  "off",
  "Stripe Billing (abonnement Sidian)",
  "non implémenté — voir USER_ACTIONS_REQUIRED.md §7.1",
);

// ── Fournisseurs ──────────────────────────────────────────────────────────
section("Fournisseurs");
provider({
  label: "IA (LLM)",
  enabledVar: "SIDIAN_LLM_PROVIDER_ENABLED",
  modeVar: "SIDIAN_LLM_TRANSPORT_MODE",
  secrets: ["SIDIAN_LLM_API_KEY"],
  publicVars: ["SIDIAN_LLM_MODEL"],
});
provider({
  label: "Email (Resend)",
  enabledVar: "SIDIAN_EMAIL_PROVIDER_ENABLED",
  modeVar: "SIDIAN_EMAIL_TRANSPORT_MODE",
  secrets: ["SIDIAN_EMAIL_API_KEY", "SIDIAN_EMAIL_FROM_ADDRESS"],
});
provider({
  label: "WhatsApp (Meta Cloud)",
  enabledVar: "SIDIAN_WHATSAPP_PROVIDER_ENABLED",
  modeVar: "SIDIAN_WHATSAPP_TRANSPORT_MODE",
  secrets: [
    "SIDIAN_WHATSAPP_ACCESS_TOKEN",
    "SIDIAN_WHATSAPP_APP_SECRET",
    "SIDIAN_WHATSAPP_WEBHOOK_VERIFY_TOKEN",
    "SIDIAN_WHATSAPP_PHONE_NUMBER_ID",
    "SIDIAN_WHATSAPP_GUIDE_RECIPIENT_TECHNICAL_ID",
  ],
});

// ── Tâches planifiées ─────────────────────────────────────────────────────
section("Tâches planifiées");
if (present("CRON_SECRET")) {
  const len = process.env.CRON_SECRET.trim().length;
  if (len < 16) {
    line("err", "CRON_SECRET", `trop court (${len} caractères, minimum 16)`);
    blocking.push("CRON_SECRET trop court (minimum 16 caractères, 32 recommandés).");
  } else line("ok", "CRON_SECRET", `défini (${len} caractères)`);
} else if (sidianEnv === "local" && !onVercel) {
  // En local, aucune plateforme ne déclenche les crons : l'absence du secret
  // n'est pas un blocage, seulement une action restante avant déploiement.
  line("off", "CRON_SECRET", "absent — sans effet en local, obligatoire au déploiement");
  todo.push(
    "CRON_SECRET : générer une valeur ≥ 32 caractères avant tout déploiement.",
  );
} else {
  line("err", "CRON_SECRET", "absent — les deux crons répondront 503 en silence");
  blocking.push(
    "CRON_SECRET absent : /api/cron/scanners et /api/cron/drains renverront 503 sans alerte.",
  );
}
if (present("SIDIAN_PAYMENT_AUTHORIZATION_TOKEN_SECRET")) {
  line("ok", "SIDIAN_PAYMENT_AUTHORIZATION_TOKEN_SECRET", "défini");
} else {
  line("err", "SIDIAN_PAYMENT_AUTHORIZATION_TOKEN_SECRET", "absent");
  blocking.push(
    "SIDIAN_PAYMENT_AUTHORIZATION_TOKEN_SECRET absent — dépendance dure des autorisations de paiement.",
  );
}

// ── Limites connues ───────────────────────────────────────────────────────
section("Limites connues du produit (indépendantes de la configuration)");
line(
  "warn",
  "Chaîne d'automatisation",
  "consommateur runtime_job en place ; 4 des 6 types de jobs câblés",
);
line(
  "warn",
  "Relances automatiques",
  "prévention et échec de paiement câblés ; échéance et escalade bloquées (USER_ACTIONS_REQUIRED §7.3 bis)",
);
line(
  "warn",
  "Abonnement Sidian",
  "facturation Stripe implémentée — reste le produit/prix Stripe et STRIPE_BILLING_*",
);
line(
  "warn",
  "Documents",
  "stockage branché ; aucune extraction de contenu (OCR, PDF, audio)",
);
line("warn", "CGU / confidentialité", "exigées à l'inscription mais inexistantes");
console.log(`    ${C.dim}Détail : docs/FINAL_TECHNICAL_AUDIT.md${C.reset}`);

// ── Conclusion ────────────────────────────────────────────────────────────
console.log();
if (blocking.length > 0) {
  console.log(`${C.red}${C.bold}${blocking.length} problème(s) bloquant(s)${C.reset}`);
  for (const b of blocking) console.log(`  ${C.red}·${C.reset} ${b}`);
} else {
  console.log(`${C.green}${C.bold}Aucun problème bloquant pour cet environnement.${C.reset}`);
}

if (todo.length > 0) {
  console.log(`\n${C.bold}Prochaines actions manuelles${C.reset}`);
  for (const t of todo) console.log(`  ${C.yellow}·${C.reset} ${t}`);
}
console.log(`\n${C.dim}Détail complet : docs/USER_ACTIONS_REQUIRED.md${C.reset}`);

// Sortie non nulle uniquement en cas de blocage réel, jamais pour un
// fournisseur simplement non configuré.
process.exit(blocking.length > 0 ? 1 : 0);
