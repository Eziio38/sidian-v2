/**
 * Garde-fou loopback strict pour les scripts de test Supabase.
 * Aucune requête réseau — validation purement locale.
 */

export const LOCAL_SUPABASE_API_PORT = 54321;

export const LOCAL_DEMO_URL = "http://127.0.0.1:54321";

/** Clés démo locales Supabase CLI (publiques, non secrètes hors Docker local). */
export const LOCAL_DEMO_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

export const LOCAL_DEMO_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const ALLOWED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const ALLOWED_RAW_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Extrait l'hôte tel qu'écrit dans l'URL, avant normalisation Node
 * (évite d'accepter 127.1 / 2130706433 / 0x7f000001 résolus en 127.0.0.1).
 * @param {string} urlString
 */
function extractRawHost(urlString) {
  const match = urlString.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]*)/);
  if (!match) {
    return null;
  }

  let authority = match[1];
  const at = authority.lastIndexOf("@");
  if (at !== -1) {
    authority = authority.slice(at + 1);
  }

  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");
    if (end === -1) {
      return null;
    }
    return authority.slice(0, end + 1).toLowerCase();
  }

  const colon = authority.indexOf(":");
  return (colon === -1 ? authority : authority.slice(0, colon)).toLowerCase();
}

/**
 * @param {string} urlString
 * @returns {{ ok: true, url: string } | { ok: false, reason: string }}
 */
export function validateLocalSupabaseUrl(urlString) {
  if (typeof urlString !== "string" || urlString.trim() === "") {
    return { ok: false, reason: "url_empty" };
  }

  const rawHost = extractRawHost(urlString);
  if (!rawHost || !ALLOWED_RAW_HOSTS.has(rawHost)) {
    return { ok: false, reason: `hostname_not_loopback:${rawHost ?? "null"}` };
  }

  let parsed;

  try {
    parsed = new URL(urlString);
  } catch {
    return { ok: false, reason: "url_invalid" };
  }

  if (parsed.protocol !== "http:") {
    return { ok: false, reason: "protocol_not_http" };
  }

  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, reason: "userinfo_forbidden" };
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  if (!ALLOWED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: `hostname_not_loopback:${hostname}` };
  }

  if (hostname.includes("..") || hostname.endsWith(".")) {
    return { ok: false, reason: "hostname_malformed" };
  }

  const port =
    parsed.port === ""
      ? parsed.protocol === "http:"
        ? "80"
        : "443"
      : parsed.port;

  if (port !== String(LOCAL_SUPABASE_API_PORT)) {
    return { ok: false, reason: `port_invalid:${port}` };
  }

  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return { ok: false, reason: "pathname_not_root" };
  }

  if (parsed.search !== "" || parsed.hash !== "") {
    return { ok: false, reason: "query_or_hash_forbidden" };
  }

  const canonical = `http://${hostname === "::1" ? "[::1]" : hostname}:${LOCAL_SUPABASE_API_PORT}`;

  return { ok: true, url: canonical };
}

/**
 * @param {{ url?: string, anonKey?: string, serviceRoleKey?: string }} input
 * @returns {{ ok: true, url: string, anonKey: string, serviceRoleKey: string } | { ok: false, reason: string }}
 */
export function validateLocalSupabaseTarget(input = {}) {
  const urlCandidate = input.url ?? LOCAL_DEMO_URL;
  const urlResult = validateLocalSupabaseUrl(urlCandidate);

  if (!urlResult.ok) {
    return urlResult;
  }

  const anonKey = input.anonKey ?? LOCAL_DEMO_ANON_KEY;
  const serviceRoleKey = input.serviceRoleKey ?? LOCAL_DEMO_SERVICE_ROLE_KEY;

  if (anonKey !== LOCAL_DEMO_ANON_KEY) {
    return { ok: false, reason: "anon_key_not_local_demo" };
  }

  if (serviceRoleKey !== LOCAL_DEMO_SERVICE_ROLE_KEY) {
    return { ok: false, reason: "service_role_key_not_local_demo" };
  }

  return {
    ok: true,
    url: urlResult.url,
    anonKey: LOCAL_DEMO_ANON_KEY,
    serviceRoleKey: LOCAL_DEMO_SERVICE_ROLE_KEY,
  };
}

/**
 * Résout la config de test : ignore les clés cloud héritées ; force les clés démo locales.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveLocalTestConfig(env = process.env) {
  // URL forcée locale : seul SIDIAN_TEST_SUPABASE_URL peut surcharger (puis validé).
  // NEXT_PUBLIC_SUPABASE_URL (souvent staging) est volontairement ignoré.
  const urlFromEnv = env.SIDIAN_TEST_SUPABASE_URL ?? LOCAL_DEMO_URL;

  // Si une clé non locale est injectée via l'environnement, refuser avant toute requête.
  if (
    env.SUPABASE_SERVICE_ROLE_KEY &&
    env.SUPABASE_SERVICE_ROLE_KEY !== LOCAL_DEMO_SERVICE_ROLE_KEY
  ) {
    return {
      ok: false,
      reason: "env_service_role_key_not_local_demo",
    };
  }

  if (
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY !== LOCAL_DEMO_ANON_KEY
  ) {
    return {
      ok: false,
      reason: "env_anon_key_not_local_demo",
    };
  }

  return validateLocalSupabaseTarget({
    url: urlFromEnv,
    anonKey: LOCAL_DEMO_ANON_KEY,
    serviceRoleKey: LOCAL_DEMO_SERVICE_ROLE_KEY,
  });
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function assertLocalTestConfig(env = process.env) {
  const result = resolveLocalTestConfig(env);

  if (!result.ok) {
    throw new Error(
      `Refuse les tests admin hors cible locale stricte (${result.reason}).`,
    );
  }

  return result;
}
