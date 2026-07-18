/**
 * Fetch local de test : refuse toute redirection HTTP.
 * À injecter dans les clients Supabase des scripts de test.
 */

/**
 * @param {RequestInfo | URL} input
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export async function localOnlyFetch(input, init = {}) {
  return fetch(input, {
    ...init,
    redirect: "error",
  });
}

/**
 * Options Supabase avec fetch localOnly imposé (écrase tout fetch appelant).
 * @param {Record<string, unknown>} [options]
 */
export function withLocalOnlyFetch(options = {}) {
  const globalOptions =
    options.global && typeof options.global === "object" ? options.global : {};

  return {
    ...options,
    global: {
      ...globalOptions,
      fetch: localOnlyFetch,
    },
  };
}
