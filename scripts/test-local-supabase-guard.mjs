#!/usr/bin/env node
/**
 * Tests table-driven du garde-fou loopback + localOnlyFetch — aucun réseau distant.
 */

import http from "node:http";

import {
  LOCAL_DEMO_ANON_KEY,
  LOCAL_DEMO_SERVICE_ROLE_KEY,
  LOCAL_DEMO_URL,
  validateLocalSupabaseTarget,
  validateLocalSupabaseUrl,
  resolveLocalTestConfig,
} from "./lib/assert-local-supabase.mjs";
import {
  localOnlyFetch,
  withLocalOnlyFetch,
} from "./lib/local-only-fetch.mjs";

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

function runTest(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      throw new Error("utiliser runTestAsync pour les tests async");
    }
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

async function runTestAsync(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

const acceptCases = [
  ["http://localhost:54321", "accepter http://localhost:54321"],
  ["http://127.0.0.1:54321", "accepter http://127.0.0.1:54321"],
  ["http://[::1]:54321", "accepter IPv6 loopback"],
];

for (const [url, label] of acceptCases) {
  runTest(label, () => {
    const result = validateLocalSupabaseUrl(url);
    if (!result.ok) {
      throw new Error(result.reason);
    }
  });
}

const rejectCases = [
  ["https://127.0.0.1:54321", "refuser HTTPS"],
  ["ftp://127.0.0.1:54321", "refuser FTP"],
  ["http://user:pass@127.0.0.1:54321", "refuser userinfo"],
  ["http://localhost.evil.test:54321", "refuser sous-domaine localhost.evil.test"],
  ["http://evil.localhost:54321", "refuser sous-domaine evil.localhost"],
  ["http://127.1:54321", "refuser 127.1"],
  ["http://2130706433:54321", "refuser IPv4 décimal"],
  ["http://0x7f000001:54321", "refuser IPv4 hex"],
  ["http://0177.0.0.1:54321", "refuser IPv4 octal-like"],
  ["http://127.0.0.1:54322", "refuser port incorrect"],
  ["http://127.0.0.1", "refuser port HTTP par défaut"],
  ["http://127.0.0.1:54321/rest/v1", "refuser pathname"],
  ["http://example.com:54321", "refuser hôte distant"],
];

for (const [url, label] of rejectCases) {
  runTest(label, () => {
    const result = validateLocalSupabaseUrl(url);
    if (result.ok) {
      throw new Error("aurait dû être refusé");
    }
  });
}

runTest("refuser clé service non locale", () => {
  const result = validateLocalSupabaseTarget({
    url: LOCAL_DEMO_URL,
    anonKey: LOCAL_DEMO_ANON_KEY,
    serviceRoleKey: "cloud-service-role-key",
  });
  if (result.ok) {
    throw new Error("clé cloud acceptée");
  }
});

runTest("refuser clé anon non locale", () => {
  const result = validateLocalSupabaseTarget({
    url: LOCAL_DEMO_URL,
    anonKey: "cloud-anon-key",
    serviceRoleKey: LOCAL_DEMO_SERVICE_ROLE_KEY,
  });
  if (result.ok) {
    throw new Error("anon cloud acceptée");
  }
});

runTest("refuser variables cloud héritées (sans réseau)", () => {
  const result = resolveLocalTestConfig({
    SIDIAN_TEST_SUPABASE_URL: "https://abcdefgh.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "eyJ-cloud-not-local",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: LOCAL_DEMO_ANON_KEY,
  });
  if (result.ok) {
    throw new Error("config cloud acceptée");
  }
});

runTest("ignorer NEXT_PUBLIC_SUPABASE_URL cloud (forcer local)", () => {
  const result = resolveLocalTestConfig({
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co",
  });
  if (!result.ok) {
    throw new Error(result.reason);
  }
  if (!result.url.includes("127.0.0.1") && !result.url.includes("localhost")) {
    throw new Error("URL non locale");
  }
});

runTest("accepter config démo locale complète", () => {
  const result = validateLocalSupabaseTarget({
    url: LOCAL_DEMO_URL,
    anonKey: LOCAL_DEMO_ANON_KEY,
    serviceRoleKey: LOCAL_DEMO_SERVICE_ROLE_KEY,
  });
  if (!result.ok) {
    throw new Error(result.reason);
  }
});

await runTestAsync("localOnlyFetch force toujours redirect:error", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init = {}) => {
    calls.push(init);
    return new Response("ok");
  };

  try {
    await localOnlyFetch("http://127.0.0.1:9/probe", {
      method: "POST",
      headers: { "x-test": "1" },
      body: "payload",
      redirect: "follow",
    });

    if (calls.length !== 1) {
      throw new Error("fetch non appelé");
    }

    if (calls[0].redirect !== "error") {
      throw new Error(`redirect=${calls[0].redirect}`);
    }

    if (calls[0].method !== "POST") {
      throw new Error("method perdue");
    }

    if (calls[0].body !== "payload") {
      throw new Error("body perdu");
    }

    if (calls[0].headers?.["x-test"] !== "1") {
      throw new Error("headers perdus");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await runTestAsync(
  "localOnlyFetch écrase redirect:follow fourni par l'appelant",
  async () => {
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init = {}) => {
      calls.push(init);
      return new Response("ok");
    };

    try {
      await localOnlyFetch("http://127.0.0.1:9/probe", { redirect: "follow" });
      if (calls[0].redirect !== "error") {
        throw new Error("redirect follow non écrasé");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);

runTest("withLocalOnlyFetch impose localOnlyFetch", () => {
  const options = withLocalOnlyFetch({
    auth: { persistSession: false },
    global: {
      headers: { Authorization: "Bearer x" },
      fetch: async () => new Response("hijack"),
    },
  });

  if (options.global.fetch !== localOnlyFetch) {
    throw new Error("fetch appelant non remplacé");
  }

  if (options.global.headers?.Authorization !== "Bearer x") {
    throw new Error("headers globaux perdus");
  }

  if (options.auth?.persistSession !== false) {
    throw new Error("autres options perdues");
  }
});

await runTestAsync(
  "localOnlyFetch n'atteint jamais la cible d'une 307 locale",
  async () => {
    let targetHits = 0;
    const target = http.createServer((_req, res) => {
      targetHits += 1;
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("landed");
    });

    const redirector = http.createServer((_req, res) => {
      const { port } = target.address();
      res.writeHead(307, {
        Location: `http://127.0.0.1:${port}/landed`,
      });
      res.end();
    });

    await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
    await new Promise((resolve) => redirector.listen(0, "127.0.0.1", resolve));

    const redirectPort = redirector.address().port;

    try {
      let rejected = false;

      try {
        await localOnlyFetch(`http://127.0.0.1:${redirectPort}/start`);
      } catch {
        rejected = true;
      }

      if (!rejected) {
        throw new Error("redirection 307 suivie");
      }

      if (targetHits !== 0) {
        throw new Error(`cible contactée ${targetHits} fois`);
      }
    } finally {
      await new Promise((resolve) => redirector.close(resolve));
      await new Promise((resolve) => target.close(resolve));
    }
  },
);

await runTestAsync(
  "localOnlyFetch n'atteint jamais la cible d'une 308 locale",
  async () => {
    let targetHits = 0;
    const target = http.createServer((_req, res) => {
      targetHits += 1;
      res.writeHead(200);
      res.end("landed");
    });

    const redirector = http.createServer((_req, res) => {
      const { port } = target.address();
      res.writeHead(308, {
        Location: `http://127.0.0.1:${port}/landed`,
      });
      res.end();
    });

    await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
    await new Promise((resolve) => redirector.listen(0, "127.0.0.1", resolve));

    const redirectPort = redirector.address().port;

    try {
      let rejected = false;

      try {
        await localOnlyFetch(`http://127.0.0.1:${redirectPort}/start`);
      } catch {
        rejected = true;
      }

      if (!rejected) {
        throw new Error("redirection 308 suivie");
      }

      if (targetHits !== 0) {
        throw new Error(`cible contactée ${targetHits} fois`);
      }
    } finally {
      await new Promise((resolve) => redirector.close(resolve));
      await new Promise((resolve) => target.close(resolve));
    }
  },
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} tests loopback réussis`);

if (failed.length > 0) {
  process.exit(1);
}
