/**
 * Garde-fou loopback strict pour PostgreSQL local (port Supabase DB 54322).
 * Aucune résolution DNS — validation purement locale avant tout client réseau.
 */

export const LOCAL_POSTGRES_PORT = "54322";

export const LOCAL_DEMO_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const ALLOWED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const ALLOWED_RAW_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Extrait l'hôte tel qu'écrit dans l'URL, avant normalisation Node.
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
export function validateLocalPostgresUrl(urlString) {
  if (typeof urlString !== "string" || urlString.trim() === "") {
    return { ok: false, reason: "url_empty" };
  }

  const trimmed = urlString.trim();
  const rawHost = extractRawHost(trimmed);
  if (!rawHost || !ALLOWED_RAW_HOSTS.has(rawHost)) {
    return { ok: false, reason: `hostname_not_loopback:${rawHost ?? "null"}` };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "url_invalid" };
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    return { ok: false, reason: "protocol_not_postgres" };
  }

  // node-postgres peut surcharger host/port via query — aucune query/fragment autorisée
  if (parsed.search !== "" || parsed.hash !== "") {
    return { ok: false, reason: "query_or_fragment_forbidden" };
  }
  // Query vide explicite ("?") parfois normalisée en search="" — refuser aussi le caractère brut
  if (trimmed.includes("?") || trimmed.includes("#")) {
    return { ok: false, reason: "query_or_fragment_forbidden" };
  }

  // Port explicite obligatoire (pas de défaut implicite 5432)
  if (!trimmed.match(/:[0-9]{2,5}(?:\/|$)/)) {
    return { ok: false, reason: "port_missing" };
  }

  if (parsed.port !== LOCAL_POSTGRES_PORT) {
    return {
      ok: false,
      reason: `port_not_local_db:${parsed.port || "default"}`,
    };
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!ALLOWED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: `hostname_not_loopback:${hostname}` };
  }

  // Userinfo trompeur (hôte déguisé en username)
  if (parsed.username.includes(".") || parsed.username.includes("@")) {
    return { ok: false, reason: "userinfo_hostname_like" };
  }
  if (parsed.password.includes("@") || /\.[a-z]{2,}$/i.test(parsed.password)) {
    return { ok: false, reason: "password_hostname_like" };
  }

  // Chemin ne doit pas embarquer d'hôte cloud / URL embarquée
  const path = parsed.pathname;
  if (/supabase\.(co|com)|amazonaws\.com|neon\.tech|host\.docker\.internal/i.test(path)) {
    return { ok: false, reason: "cloud_host_in_path" };
  }
  if (/:\/\//.test(path)) {
    return { ok: false, reason: "embedded_url_in_path" };
  }

  return { ok: true, url: trimmed };
}

/**
 * @param {string} rawUrl
 * @returns {string}
 */
export function assertLocalPostgresUrl(rawUrl) {
  const result = validateLocalPostgresUrl(rawUrl);
  if (!result.ok) {
    throw new Error(`Refuse PostgreSQL non local: ${result.reason}`);
  }
  return result.url;
}

/**
 * Résout l'URL DB de test : surcharge env uniquement si strictement locale.
 * @returns {string}
 */
export function resolveLocalPostgresUrl(
  envUrl = process.env.SIDIAN_TEST_DATABASE_URL,
) {
  if (typeof envUrl === "string" && envUrl.trim() !== "") {
    return assertLocalPostgresUrl(envUrl);
  }
  return LOCAL_DEMO_DATABASE_URL;
}

/**
 * Instancie un client pg uniquement après validation (injectable pour espionnage).
 * @param {string} rawUrl
 * @param {{ Client: new (config: { connectionString: string }) => unknown }} deps
 */
export function createLocalPgClient(rawUrl, deps) {
  if (!deps || typeof deps.Client !== "function") {
    throw new Error("Client PostgreSQL requis");
  }
  const url = assertLocalPostgresUrl(rawUrl);
  return new deps.Client({ connectionString: url });
}
