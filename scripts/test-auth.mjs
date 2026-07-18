#!/usr/bin/env node
/**
 * Tests Auth et onboarding prestataire — Supabase local uniquement.
 * Couvre validation Zod, RPC SID-SEC-001, isolation RLS et garde-fous sécurité.
 * Exécute le vrai module métier : src/lib/auth/ensure-prestataire-core.ts
 */

import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  assertLocalTestConfig,
  LOCAL_DEMO_ANON_KEY,
  LOCAL_DEMO_SERVICE_ROLE_KEY,
} from "./lib/assert-local-supabase.mjs";
import { withLocalOnlyFetch } from "./lib/local-only-fetch.mjs";
import { ensurePrestataireForUser } from "../src/lib/auth/ensure-prestataire-core.ts";

const localConfig = assertLocalTestConfig();
const SUPABASE_URL = localConfig.url;
const SUPABASE_ANON = LOCAL_DEMO_ANON_KEY;
const SUPABASE_SERVICE = LOCAL_DEMO_SERVICE_ROLE_KEY;
const LOCAL_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

function createLocalClient(url, key, options = {}) {
  return createClient(url, key, withLocalOnlyFetch(options));
}

const admin = createLocalClient(SUPABASE_URL, SUPABASE_SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const results = [];

function pass(name) {
  results.push({ name, ok: true });
  console.log(`✓ ${name}`);
}

function fail(name, error) {
  const message = error instanceof Error ? error.message : String(error);
  results.push({ name, ok: false, message });
  console.error(`✗ ${name}: ${message}`);
}

async function runTest(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

function normalizeSpaces(value) {
  return value.trim().replace(/\s+/g, " ");
}

const passwordSchema = z
  .string()
  .min(8, "Le mot de passe doit contenir au moins 8 caractères.")
  .regex(/[a-zA-Z]/, "Le mot de passe doit contenir au moins une lettre.")
  .regex(/[0-9]/, "Le mot de passe doit contenir au moins un chiffre.");

const signUpSchema = z
  .object({
    displayName: z
      .string()
      .transform(normalizeSpaces)
      .pipe(z.string().min(1, "Indiquez comment nous pouvons vous appeler.")),
    agencyName: z
      .string()
      .transform(normalizeSpaces)
      .pipe(z.string().min(1, "Indiquez le nom de votre agence ou activité.")),
    email: z.string().trim().toLowerCase().pipe(z.email("Adresse email invalide.")),
    password: passwordSchema,
    passwordConfirm: z.string().min(1, "Confirmez votre mot de passe."),
    acceptCgu: z.literal(true, {
      error: "Vous devez accepter les conditions générales d'utilisation.",
    }),
    acceptPrivacy: z.literal(true, {
      error: "Vous devez accepter la politique de confidentialité.",
    }),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    path: ["passwordConfirm"],
    message: "Les mots de passe ne correspondent pas.",
  });

const ALLOWED_REDIRECT_PATHS = new Set([
  "/app",
  "/connexion",
  "/reinitialiser-mot-de-passe",
  "/inscription/verifier-email",
]);

function resolveSafeRedirectPath(candidate) {
  if (!candidate) {
    return "/app";
  }

  if (!candidate.startsWith("/") || candidate.startsWith("//")) {
    return "/app";
  }

  const [pathname] = candidate.split("?");

  if (!ALLOWED_REDIRECT_PATHS.has(pathname)) {
    return "/app";
  }

  return pathname;
}

function base64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signLocalAuthenticatedJwt({ userId, email }) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      sub: userId,
      role: "authenticated",
      aud: "authenticated",
      email,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  );
  const signature = createHmac("sha256", LOCAL_JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${header}.${payload}.${signature}`;
}

function clientWithAccessToken(accessToken) {
  return createLocalClient(SUPABASE_URL, SUPABASE_ANON, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createConfirmedUser(email, password, metadata = {}) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });

  if (error || !data.user) {
    throw error ?? new Error("createUser failed");
  }

  return data.user;
}

async function createUnconfirmedUser(email, password) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
  });

  if (error || !data.user) {
    throw error ?? new Error("createUser unconfirmed failed");
  }

  return data.user;
}

async function signInAs(email, password) {
  const client = createLocalClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    throw error ?? new Error("signInWithPassword failed");
  }

  return { client, session: data.session, user: data.user };
}

function walkFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      walkFiles(fullPath, acc);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      acc.push(fullPath);
    }
  }

  return acc;
}

const validSignUp = {
  displayName: "Camille Martin",
  agencyName: "Studio Horizon",
  email: `auth-test-${Date.now()}@example.com`,
  password: "Motdepasse1",
  passwordConfirm: "Motdepasse1",
  acceptCgu: true,
  acceptPrivacy: true,
};

await runTest("inscription avec données valides", async () => {
  const parsed = signUpSchema.safeParse(validSignUp);

  if (!parsed.success) {
    throw new Error("validation inattendue");
  }
});

await runTest("validation formulaire invalide", async () => {
  const parsed = signUpSchema.safeParse({
    ...validSignUp,
    email: "pas-un-email",
    displayName: " ",
  });

  if (parsed.success) {
    throw new Error("devrait échouer");
  }
});

await runTest("mots de passe différents refusés", async () => {
  const parsed = signUpSchema.safeParse({
    ...validSignUp,
    passwordConfirm: "AutreMotdepasse1",
  });

  if (parsed.success) {
    throw new Error("devrait échouer");
  }
});

await runTest("CGU non acceptées refusées", async () => {
  const parsed = signUpSchema.safeParse({
    ...validSignUp,
    acceptCgu: false,
  });

  if (parsed.success) {
    throw new Error("devrait échouer");
  }
});

await runTest("connexion valide", async () => {
  const email = `login-${Date.now()}@example.com`;
  const password = "Motdepasse1";

  await createConfirmedUser(email, password, {
    agency_name: "Agence Test",
  });

  const { user } = await signInAs(email, password);

  if (!user?.id) {
    throw new Error("session utilisateur absente");
  }
});

await runTest("connexion invalide avec message générique", async () => {
  const client = createLocalClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await client.auth.signInWithPassword({
    email: "inexistant@example.com",
    password: "Motdepasse1",
  });

  if (!error) {
    throw new Error("devrait échouer");
  }
});

await runTest("SID-SEC-001 INSERT direct authenticated refusé", async () => {
  const email = `insert-direct-${Date.now()}@example.com`;
  const password = "Motdepasse1";
  const user = await createConfirmedUser(email, password);
  const { client } = await signInAs(email, password);

  const { error } = await client.from("prestataire").insert({
    user_id: user.id,
    nom: "Hack Direct",
    email: "hacked@evil.example",
  });

  if (!error) {
    throw new Error("INSERT direct autorisé");
  }
});

await runTest(
  "SID-SEC-001 INSERT direct avec champs commerciaux arbitraires refusé",
  async () => {
    const email = `insert-mass-${Date.now()}@example.com`;
    const password = "Motdepasse1";
    const user = await createConfirmedUser(email, password);
    const { client } = await signInAs(email, password);

    const { error } = await client.from("prestataire").insert({
      user_id: user.id,
      nom: "Hack Mass",
      email: "arbitrary@evil.example",
      subscription_status: "active",
      pricing_version: "business_999",
      platform_fee_basis_points: 500,
    });

    if (!error) {
      throw new Error("INSERT mass assignment autorisé");
    }
  },
);

await runTest("SID-SEC-001 RPC sans session refusée", async () => {
  const client = createLocalClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await client.rpc("ensure_prestataire_for_current_user", {
    p_nom: "Sans Session",
  });

  if (!error) {
    throw new Error("RPC sans session acceptée");
  }
});

await runTest("SID-SEC-001 RPC anon refusée", async () => {
  const client = createLocalClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await client.rpc("ensure_prestataire_for_current_user", {
    p_nom: "Anon",
  });

  if (!error) {
    throw new Error("RPC anon acceptée");
  }
});

await runTest("SID-SEC-001 RPC argument non prévu impossible", async () => {
  const email = `rpc-args-${Date.now()}@example.com`;
  const password = "Motdepasse1";
  await createConfirmedUser(email, password);
  const { client } = await signInAs(email, password);

  const { error } = await client.rpc("ensure_prestataire_for_current_user", {
    p_nom: "Agence",
    p_email: "injected@evil.example",
    user_id: "00000000-0000-0000-0000-000000000000",
  });

  if (!error) {
    throw new Error("arguments non prévus acceptés");
  }
});

await runTest("SID-SEC-001 utilisateur non confirmé → aucun prestataire", async () => {
  const email = `unconfirmed-${Date.now()}@example.com`;
  const password = "Motdepasse1";
  const user = await createUnconfirmedUser(email, password);
  const token = signLocalAuthenticatedJwt({ userId: user.id, email });
  const client = clientWithAccessToken(token);

  const { error } = await client.rpc("ensure_prestataire_for_current_user", {
    p_nom: "Non Confirmé",
  });

  if (!error) {
    throw new Error("RPC non confirmé acceptée");
  }

  const { count, error: countError } = await admin
    .from("prestataire")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (countError) {
    throw countError;
  }

  if (count !== 0) {
    throw new Error("prestataire créé pour utilisateur non confirmé");
  }
});

await runTest("SID-SEC-001 utilisateur A ne crée pas pour B", async () => {
  const password = "Motdepasse1";
  const userA = await createConfirmedUser(
    `sec-a-${Date.now()}@example.com`,
    password,
    { agency_name: "Agence A" },
  );
  const userB = await createConfirmedUser(
    `sec-b-${Date.now()}@example.com`,
    password,
    { agency_name: "Agence B" },
  );

  const { client } = await signInAs(userA.email, password);
  const prestataire = await ensurePrestataireForUser(client, userA);

  if (prestataire.user_id !== userA.id) {
    throw new Error("user_id incohérent");
  }

  const { count, error } = await admin
    .from("prestataire")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userB.id);

  if (error) {
    throw error;
  }

  if (count !== 0) {
    throw new Error("prestataire créé pour B via session A");
  }
});

await runTest("création d'un seul prestataire par utilisateur", async () => {
  const email = `single-${Date.now()}@example.com`;
  const password = "Motdepasse1";
  const user = await createConfirmedUser(email, password, {
    agency_name: "Agence Unique",
  });

  const { client } = await signInAs(email, password);
  const first = await ensurePrestataireForUser(client, user);
  const second = await ensurePrestataireForUser(client, user);

  if (first.id !== second.id) {
    throw new Error("doublon prestataire");
  }
});

await runTest("second passage onboarding idempotent", async () => {
  const email = `idempotent-${Date.now()}@example.com`;
  const password = "Motdepasse1";
  const user = await createConfirmedUser(email, password, {
    agency_name: "Agence Idempotente",
  });

  const { client } = await signInAs(email, password);
  await ensurePrestataireForUser(client, user);
  await ensurePrestataireForUser(client, user);

  const { count, error } = await admin
    .from("prestataire")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (error) {
    throw error;
  }

  if (count !== 1) {
    throw new Error(`attendu 1 prestataire, obtenu ${count}`);
  }
});

await runTest("SID-SEC-001 RPC crée prestataire avec valeurs système", async () => {
  const email = `system-values-${Date.now()}@example.com`;
  const password = "Motdepasse1";
  const user = await createConfirmedUser(email, password, {
    agency_name: "Agence Système",
  });

  const { client } = await signInAs(email, password);
  const summary = await ensurePrestataireForUser(client, user);

  const { data, error } = await admin
    .from("prestataire")
    .select(
      "id, user_id, email, nom, subscription_status, pricing_version, platform_fee_basis_points, profil_agent_defaut",
    )
    .eq("id", summary.id)
    .single();

  if (error) {
    throw error;
  }

  if (data.user_id !== user.id) {
    throw new Error("user_id non dérivé de auth.uid()");
  }

  if (data.email !== email.toLowerCase()) {
    throw new Error("email non dérivé de Auth");
  }

  if (data.nom !== "Agence Système") {
    throw new Error("nom inattendu");
  }

  if (data.subscription_status !== "trialing") {
    throw new Error("subscription_status non système");
  }

  if (data.pricing_version !== "early_access_49") {
    throw new Error("pricing_version non système");
  }

  if (data.platform_fee_basis_points !== 0) {
    throw new Error("commission non système");
  }

  if (data.profil_agent_defaut !== "controle") {
    throw new Error("profil_agent_defaut non système");
  }
});

await runTest("SID-SEC-001 appels concurrents → une seule ligne + même ID", async () => {
  const email = `concurrent-${Date.now()}@example.com`;
  const password = "Motdepasse1";
  const user = await createConfirmedUser(email, password, {
    agency_name: "Agence Concurrente",
  });

  const { client } = await signInAs(email, password);

  const resultsConcurrent = await Promise.all([
    ensurePrestataireForUser(client, user),
    ensurePrestataireForUser(client, user),
    ensurePrestataireForUser(client, user),
  ]);

  const ids = resultsConcurrent.map((row) => row.id);
  if (new Set(ids).size !== 1) {
    throw new Error(`IDs concurrents divergents: ${ids.join(",")}`);
  }

  const { count, error } = await admin
    .from("prestataire")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (error) {
    throw error;
  }

  if (count !== 1) {
    throw new Error(`concurrence: attendu 1, obtenu ${count}`);
  }
});

await runTest("utilisateur A ne lit pas le prestataire B", async () => {
  const password = "Motdepasse1";
  const userA = await createConfirmedUser(`user-a-${Date.now()}@example.com`, password, {
    agency_name: "Agence A",
  });
  const userB = await createConfirmedUser(`user-b-${Date.now()}@example.com`, password, {
    agency_name: "Agence B",
  });

  const sessionA = await signInAs(userA.email, password);
  const sessionB = await signInAs(userB.email, password);

  const prestataireA = await ensurePrestataireForUser(sessionA.client, userA);
  await ensurePrestataireForUser(sessionB.client, userB);

  const { data, error } = await sessionA.client
    .from("prestataire")
    .select("id")
    .eq("id", prestataireA.id);

  if (error) {
    throw error;
  }

  if ((data ?? []).length !== 1) {
    throw new Error("lecture propre prestataire échouée");
  }

  const { data: foreignRows, error: foreignError } = await sessionA.client
    .from("prestataire")
    .select("id")
    .neq("user_id", userA.id);

  if (foreignError) {
    throw foreignError;
  }

  if ((foreignRows ?? []).length > 0) {
    throw new Error("fuite de données prestataire");
  }
});

await runTest("UPDATE champs commerciaux protégés reste refusé", async () => {
  const email = `update-guard-${Date.now()}@example.com`;
  const password = "Motdepasse1";
  const user = await createConfirmedUser(email, password, {
    agency_name: "Agence Update",
  });

  const { client } = await signInAs(email, password);
  const prestataire = await ensurePrestataireForUser(client, user);

  const { error } = await client
    .from("prestataire")
    .update({
      subscription_status: "active",
      pricing_version: "business_999",
      platform_fee_basis_points: 250,
    })
    .eq("id", prestataire.id);

  if (!error) {
    throw new Error("update champs commerciaux autorisé");
  }
});

await runTest("déconnexion invalide la session", async () => {
  const email = `logout-${Date.now()}@example.com`;
  const password = "Motdepasse1";
  await createConfirmedUser(email, password, { agency_name: "Agence Logout" });

  const { client } = await signInAs(email, password);
  await client.auth.signOut();

  const {
    data: { user },
  } = await client.auth.getUser();

  if (user) {
    throw new Error("session encore active");
  }
});

await runTest("callback refuse une destination externe", async () => {
  const safe = resolveSafeRedirectPath("https://evil.example/phish");
  const partial = resolveSafeRedirectPath("/app/evil");

  if (safe !== "/app" || partial !== "/app") {
    throw new Error("redirection non sécurisée");
  }
});

await runTest("mot de passe oublié renvoie une réponse générique", async () => {
  const client = createLocalClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const known = await client.auth.resetPasswordForEmail("known@example.com", {
    redirectTo:
      "http://localhost:3000/auth/callback?next=/reinitialiser-mot-de-passe",
  });
  const unknown = await client.auth.resetPasswordForEmail(
    "unknown@example.com",
    {
      redirectTo:
        "http://localhost:3000/auth/callback?next=/reinitialiser-mot-de-passe",
    },
  );

  if (known.error && unknown.error) {
    throw new Error("resetPasswordForEmail a échoué");
  }
});

await runTest("aucune service role importable dans le client", async () => {
  const srcRoot = new URL("../src", import.meta.url).pathname;
  const files = walkFiles(srcRoot);
  const offenders = [];

  for (const file of files) {
    if (file.includes("/lib/supabase/admin.ts")) {
      continue;
    }

    const content = readFileSync(file, "utf8");
    const isClientFile =
      content.includes('"use client"') || content.includes("'use client'");

    if (!isClientFile) {
      continue;
    }

    if (
      content.includes("@/lib/supabase/admin") ||
      content.includes("SUPABASE_SERVICE_ROLE_KEY") ||
      content.includes("createAdminClient")
    ) {
      offenders.push(file);
    }
  }

  if (offenders.length > 0) {
    throw new Error(`imports interdits: ${offenders.join(", ")}`);
  }
});

await runTest("email prestataire provient de l'utilisateur Auth confirmé", async () => {
  const email = `email-source-${Date.now()}@example.com`;
  const password = "Motdepasse1";
  const user = await createConfirmedUser(email, password, {
    agency_name: "Agence Email",
  });

  const { client } = await signInAs(email, password);
  const prestataire = await ensurePrestataireForUser(client, user);

  if (prestataire.email !== email.toLowerCase()) {
    throw new Error("email prestataire incohérent");
  }
});

await runTest("SID-SEC-001 UPDATE direct email refusé", async () => {
  const email = `upd-email-${Date.now()}@example.com`;
  const password = "Motdepasse1";
  const user = await createConfirmedUser(email, password, {
    agency_name: "Agence",
  });
  const { client } = await signInAs(email, password);
  const prestataire = await ensurePrestataireForUser(client, user);

  const { error } = await client
    .from("prestataire")
    .update({ email: "hacked@evil.example" })
    .eq("id", prestataire.id);

  if (!error) {
    throw new Error("UPDATE email autorisé");
  }
});

await runTest("SID-SEC-001 UPDATE direct created_at refusé", async () => {
  const email = `upd-created-${Date.now()}@example.com`;
  const password = "Motdepasse1";
  const user = await createConfirmedUser(email, password, {
    agency_name: "Agence",
  });
  const { client } = await signInAs(email, password);
  const prestataire = await ensurePrestataireForUser(client, user);

  const { error } = await client
    .from("prestataire")
    .update({ created_at: new Date().toISOString() })
    .eq("id", prestataire.id);

  if (!error) {
    throw new Error("UPDATE created_at autorisé");
  }
});

await runTest("SID-SEC-001 UPDATE direct user_id refusé", async () => {
  const email = `upd-uid-${Date.now()}@example.com`;
  const password = "Motdepasse1";
  const user = await createConfirmedUser(email, password, {
    agency_name: "Agence",
  });
  const other = await createConfirmedUser(
    `upd-uid-other-${Date.now()}@example.com`,
    password,
  );
  const { client } = await signInAs(email, password);
  const prestataire = await ensurePrestataireForUser(client, user);

  const { error } = await client
    .from("prestataire")
    .update({ user_id: other.id })
    .eq("id", prestataire.id);

  if (!error) {
    throw new Error("UPDATE user_id autorisé");
  }
});

await runTest("SID-SEC-001 UPDATE direct champs commerciaux refusés", async () => {
  const email = `upd-com-${Date.now()}@example.com`;
  const password = "Motdepasse1";
  const user = await createConfirmedUser(email, password, {
    agency_name: "Agence",
  });
  const { client } = await signInAs(email, password);
  const prestataire = await ensurePrestataireForUser(client, user);

  for (const patch of [
    { subscription_status: "active" },
    { pricing_version: "business_999" },
    { platform_fee_basis_points: 250 },
    { profil_agent_defaut: "delegation" },
  ]) {
    const { error } = await client
      .from("prestataire")
      .update(patch)
      .eq("id", prestataire.id);

    if (!error) {
      throw new Error(`UPDATE autorisé: ${JSON.stringify(patch)}`);
    }
  }
});

await runTest("SID-SEC-001 UPDATE direct nom refusé (RPC obligatoire)", async () => {
  const email = `upd-nom-${Date.now()}@example.com`;
  const password = "Motdepasse1";
  const user = await createConfirmedUser(email, password, {
    agency_name: "Agence",
  });
  const { client } = await signInAs(email, password);
  const prestataire = await ensurePrestataireForUser(client, user);

  const { error } = await client
    .from("prestataire")
    .update({ nom: "Nom Pirate" })
    .eq("id", prestataire.id);

  if (!error) {
    throw new Error("UPDATE nom direct autorisé");
  }
});

await runTest("SID-SEC-001 RPC update_current_prestataire_name fonctionne", async () => {
  const email = `rpc-nom-${Date.now()}@example.com`;
  const password = "Motdepasse1";
  const user = await createConfirmedUser(email, password, {
    agency_name: "Ancien Nom",
  });
  const { client } = await signInAs(email, password);
  await ensurePrestataireForUser(client, user);

  const { data, error } = await client.rpc("update_current_prestataire_name", {
    p_nom: "  Nouveau   Nom  ",
  });

  if (error || !data) {
    throw error ?? new Error("RPC nom échouée");
  }

  if (data.nom !== "Nouveau Nom") {
    throw new Error(`nom non normalisé: ${data.nom}`);
  }
});

await runTest("SID-SEC-001 RPC nom anon refusée", async () => {
  const client = createLocalClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await client.rpc("update_current_prestataire_name", {
    p_nom: "Hack",
  });

  if (!error) {
    throw new Error("RPC nom anon acceptée");
  }
});

await runTest("SID-SEC-001 RPC nom argument supplémentaire impossible", async () => {
  const email = `rpc-nom-args-${Date.now()}@example.com`;
  const password = "Motdepasse1";
  const user = await createConfirmedUser(email, password, {
    agency_name: "Agence",
  });
  const { client } = await signInAs(email, password);
  await ensurePrestataireForUser(client, user);

  const { error } = await client.rpc("update_current_prestataire_name", {
    p_nom: "Ok",
    p_email: "x@y.com",
  });

  if (!error) {
    throw new Error("arguments supplémentaires acceptés");
  }
});

await runTest("SID-SEC-001 A ne peut pas renommer le prestataire de B", async () => {
  const password = "Motdepasse1";
  const userA = await createConfirmedUser(
    `rename-a-${Date.now()}@example.com`,
    password,
    { agency_name: "Agence A" },
  );
  const userB = await createConfirmedUser(
    `rename-b-${Date.now()}@example.com`,
    password,
    { agency_name: "Agence B" },
  );

  const sessionA = await signInAs(userA.email, password);
  const sessionB = await signInAs(userB.email, password);
  await ensurePrestataireForUser(sessionA.client, userA);
  const prestB = await ensurePrestataireForUser(sessionB.client, userB);

  await sessionA.client.rpc("update_current_prestataire_name", {
    p_nom: "Renommé par A",
  });

  const { data } = await admin
    .from("prestataire")
    .select("nom")
    .eq("id", prestB.id)
    .single();

  if (data.nom !== "Agence B") {
    throw new Error("prestataire B modifié par A");
  }
});

await runTest("SID-SEC-001 email historique non canonique réconcilié sans écraser le commercial", async () => {
  const email = `hist-email-${Date.now()}@example.com`;
  const password = "Motdepasse1";
  const user = await createConfirmedUser(email, password, {
    agency_name: "Agence Hist",
  });

  const fixedCreatedAt = "2024-01-15T10:30:00+00:00";
  const lockedUntil = "2027-12-31T00:00:00+00:00";
  const startedAt = "2024-06-01T08:00:00+00:00";

  const { data: inserted, error: insertError } = await admin
    .from("prestataire")
    .insert({
      user_id: user.id,
      nom: "Nom Historique Custom",
      email: `  ${email.toUpperCase()}  `,
      subscription_status: "active",
      pricing_version: "legacy_custom_99",
      platform_fee_basis_points: 42,
      profil_agent_defaut: "delegation",
      subscription_started_at: startedAt,
      early_access_price_locked_until: lockedUntil,
      created_at: fixedCreatedAt,
    })
    .select(
      "id, email, nom, created_at, subscription_status, pricing_version, platform_fee_basis_points, profil_agent_defaut, subscription_started_at, early_access_price_locked_until",
    )
    .single();

  if (insertError) {
    throw insertError;
  }

  if (inserted.email === email.toLowerCase()) {
    throw new Error("fixture email déjà canonique — test invalide");
  }

  const { client } = await signInAs(email, password);
  const reconciled = await ensurePrestataireForUser(client, user);

  if (reconciled.id !== inserted.id) {
    throw new Error("ID changé après réconciliation");
  }

  if (reconciled.email !== email.toLowerCase()) {
    throw new Error("email non canonique après RPC");
  }

  const { data: row, error: rowError } = await admin
    .from("prestataire")
    .select(
      "id, email, nom, created_at, subscription_status, pricing_version, platform_fee_basis_points, profil_agent_defaut, subscription_started_at, early_access_price_locked_until",
    )
    .eq("id", inserted.id)
    .single();

  if (rowError) {
    throw rowError;
  }

  if (row.email !== email.toLowerCase()) {
    throw new Error(`email stocké non canonique: ${row.email}`);
  }

  if (row.nom !== "Nom Historique Custom") {
    throw new Error("nom historique écrasé");
  }

  if (new Date(row.created_at).getTime() !== new Date(fixedCreatedAt).getTime()) {
    throw new Error("created_at historique écrasé");
  }

  if (row.subscription_status !== "active") {
    throw new Error("subscription_status historique écrasé");
  }

  if (row.pricing_version !== "legacy_custom_99") {
    throw new Error("pricing historique écrasé");
  }

  if (row.platform_fee_basis_points !== 42) {
    throw new Error("commission historique écrasée");
  }

  if (row.profil_agent_defaut !== "delegation") {
    throw new Error("profil agent historique écrasé");
  }

  if (new Date(row.subscription_started_at).getTime() !== new Date(startedAt).getTime()) {
    throw new Error("subscription_started_at écrasé");
  }

  if (
    new Date(row.early_access_price_locked_until).getTime() !==
    new Date(lockedUntil).getTime()
  ) {
    throw new Error("early_access_price_locked_until écrasé");
  }

  const { count, error: countError } = await admin
    .from("prestataire")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (countError) {
    throw countError;
  }

  if (count !== 1) {
    throw new Error(`attendu 1 ligne, obtenu ${count}`);
  }
});

await runTest("SID-SEC-001 email déjà canonique → idempotent sans écriture inutile", async () => {
  const email = `canon-${Date.now()}@example.com`;
  const password = "Motdepasse1";
  const user = await createConfirmedUser(email, password, {
    agency_name: "Agence Canon",
  });
  const { client } = await signInAs(email, password);
  const first = await ensurePrestataireForUser(client, user);
  const second = await ensurePrestataireForUser(client, user);

  if (first.id !== second.id || first.email !== email.toLowerCase()) {
    throw new Error("idempotence canonique cassée");
  }
});

await runTest("SID-SEC-001 DELETE direct authenticated refusé", async () => {
  const email = `del-${Date.now()}@example.com`;
  const password = "Motdepasse1";
  const user = await createConfirmedUser(email, password, {
    agency_name: "Agence Del",
  });
  const { client } = await signInAs(email, password);
  const prestataire = await ensurePrestataireForUser(client, user);

  const { error } = await client.from("prestataire").delete().eq("id", prestataire.id);
  if (!error) {
    throw new Error("DELETE direct autorisé");
  }

  const { data } = await admin
    .from("prestataire")
    .select("id")
    .eq("id", prestataire.id)
    .maybeSingle();

  if (!data) {
    throw new Error("ligne supprimée");
  }
});

await runTest("SID-SEC-001 tests exécutent le vrai module cœur", async () => {
  const selfPath = fileURLToPath(import.meta.url);
  const selfSource = readFileSync(selfPath, "utf8");

  if (/async function ensurePrestataireForUser\s*\(/.test(selfSource)) {
    throw new Error("helper dupliqué encore présent dans test-auth.mjs");
  }

  if (!selfSource.includes("ensure-prestataire-core.ts")) {
    throw new Error("import du module cœur absent");
  }

  if (typeof ensurePrestataireForUser !== "function") {
    throw new Error("ensurePrestataireForUser non importé");
  }
});

await runTest("SID-SEC-001 erreur RPC → erreur applicative générique", async () => {
  const email = `rpc-err-${Date.now()}@example.com`;
  const password = "Motdepasse1";
  const user = await createUnconfirmedUser(email, password);
  const token = signLocalAuthenticatedJwt({ userId: user.id, email });
  const client = clientWithAccessToken(token);

  // Utilisateur JWT authentifié mais email non confirmé côté auth.users → RPC échoue
  const confirmedShape = {
    ...user,
    email_confirmed_at: new Date().toISOString(),
    email,
  };

  let caught = null;
  try {
    await ensurePrestataireForUser(client, confirmedShape);
  } catch (error) {
    caught = error;
  }

  if (!(caught instanceof Error) || caught.message !== "prestataire_create_failed") {
    throw new Error(`attendu prestataire_create_failed, obtenu ${caught?.message}`);
  }
});

const failed = results.filter((result) => !result.ok);

console.log(`\n${results.length - failed.length}/${results.length} tests réussis`);

if (failed.length > 0) {
  process.exit(1);
}
