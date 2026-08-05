#!/usr/bin/env node
/**
 * Génère le JWT d'attestation d'environnement (SUPABASE_ENVIRONMENT_ATTESTATION_JWT)
 * ou le JWT d'écriture des liaisons Stripe (SUPABASE_STRIPE_BINDING_WRITER_JWT).
 *
 * À lancer EN LOCAL uniquement. La clé JWT du projet Supabase ne doit jamais
 * quitter ta machine ni être collée dans un chat — ce script la lit depuis une
 * variable d'environnement le temps de l'exécution, ne l'écrit nulle part, et
 * n'affiche jamais que le JWT final.
 *
 * La clé JWT du projet (à distinguer de l'anon key et de la service role key) :
 * Supabase → ton projet → Settings → API → JWT Settings → « JWT Secret ».
 *
 * Usage :
 *   SUPABASE_JWT_SECRET="…" node scripts/sign-attestation-jwt.mjs \
 *     --role sidian_environment_attestor \
 *     --environment production \
 *     --project-ref hujufkcnrkgwvsyjcenk \
 *     --days 365
 *
 *   SUPABASE_JWT_SECRET="…" node scripts/sign-attestation-jwt.mjs \
 *     --role stripe_customer_binding_writer \
 *     --environment production \
 *     --days 365
 */

import { createHmac } from "node:crypto";

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      out[key] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const secret = process.env.SUPABASE_JWT_SECRET;

if (!secret) {
  console.error(
    "Erreur : SUPABASE_JWT_SECRET absent.\n" +
      "Exemple : SUPABASE_JWT_SECRET=\"…\" node scripts/sign-attestation-jwt.mjs --role sidian_environment_attestor --environment production --project-ref hujufkcnrkgwvsyjcenk",
  );
  process.exit(1);
}

const role = args.role;
const environment = args.environment;
const days = Number(args.days ?? 365);

if (role !== "sidian_environment_attestor" && role !== "stripe_customer_binding_writer") {
  console.error("--role doit valoir sidian_environment_attestor ou stripe_customer_binding_writer");
  process.exit(1);
}
if (!["local", "staging", "production"].includes(environment)) {
  console.error("--environment doit valoir local, staging ou production");
  process.exit(1);
}
if (role === "sidian_environment_attestor" && !/^[a-z0-9]{8,64}$/.test(args["project-ref"] ?? "")) {
  console.error("--project-ref requis pour sidian_environment_attestor (8 à 64 caractères a-z0-9)");
  process.exit(1);
}
if (!Number.isFinite(days) || days <= 0 || days > 3650) {
  console.error("--days doit être un nombre de jours entre 1 et 3650");
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const exp = now + days * 24 * 60 * 60;

const header = { alg: "HS256", typ: "JWT" };
const payload = {
  role,
  iat: now,
  exp,
  ...(role === "sidian_environment_attestor"
    ? { sidian_environment: environment, sidian_project_ref: args["project-ref"] }
    : { sidian_environment: environment }),
};

const encodedHeader = base64url(JSON.stringify(header));
const encodedPayload = base64url(JSON.stringify(payload));
const signingInput = `${encodedHeader}.${encodedPayload}`;
const signature = createHmac("sha256", secret)
  .update(signingInput)
  .digest("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "");

const jwt = `${signingInput}.${signature}`;

console.log(`\nClaims : ${JSON.stringify(payload, null, 2)}`);
console.log(`\nExpire le : ${new Date(exp * 1000).toISOString()}`);
console.log(`\nJWT (à coller dans Vercel, jamais dans un chat) :\n`);
console.log(jwt);
console.log("");
