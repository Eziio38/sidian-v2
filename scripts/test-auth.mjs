#!/usr/bin/env node
/**
 * Tests Auth et onboarding prestataire — Supabase local.
 * Couvre validation Zod, onboarding idempotent, isolation RLS et garde-fous sécurité.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SERVICE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? LOCAL_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? LOCAL_ANON;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? LOCAL_SERVICE;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE, {
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

async function signInAs(email, password) {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON, {
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

async function ensurePrestataireForUser(client, user) {
  const email = user.email?.trim().toLowerCase();

  if (!email) {
    throw new Error("auth_email_missing");
  }

  const { data: existing } = await client
    .from("prestataire")
    .select("id, nom, email, user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    return existing;
  }

  const agencyName =
    typeof user.user_metadata?.agency_name === "string"
      ? user.user_metadata.agency_name.trim()
      : "Mon activité";

  const { data, error } = await client
    .from("prestataire")
    .insert({
      user_id: user.id,
      email,
      nom: agencyName,
      pricing_version: "early_access_49",
    })
    .select("id, nom, email, user_id")
    .single();

  if (error?.code === "23505") {
    const { data: raced } = await client
      .from("prestataire")
      .select("id, nom, email, user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (raced) {
      return raced;
    }
  }

  if (error || !data) {
    throw error ?? new Error("prestataire_create_failed");
  }

  return data;
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
  const client = createClient(SUPABASE_URL, SUPABASE_ANON, {
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
  const client = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const known = await client.auth.resetPasswordForEmail("known@example.com", {
    redirectTo: "http://localhost:3000/auth/callback?next=/reinitialiser-mot-de-passe",
  });
  const unknown = await client.auth.resetPasswordForEmail("unknown@example.com", {
    redirectTo: "http://localhost:3000/auth/callback?next=/reinitialiser-mot-de-passe",
  });

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

const failed = results.filter((result) => !result.ok);

console.log(`\n${results.length - failed.length}/${results.length} tests réussis`);

if (failed.length > 0) {
  process.exit(1);
}
