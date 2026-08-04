/**
 * Garde structurelle G1-L — anti-contournement Gateway.
 *
 * Vérifie statiquement que les surfaces publiques (`src/app/**`)
 * n’importent pas le Router / la construction TrustedExecutionContext
 * hors du point d’entrée canonique HTTP → Gateway.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../../..");
const APP_ROOT = path.join(ROOT, "src/app");
const CANONICAL_ROUTE = path.join(APP_ROOT, "api/agent/tools/route.ts");
const SERVER_AUTH_CREATE_ROUTER = path.join(
  ROOT,
  "src/lib/agent/server/auth/create-router.ts",
);

const FORBIDDEN_SYMBOLS = [
  "createToolRouter",
  "buildTrustedExecutionContext",
  "toTrustedRouteInput",
  "routeFromGateway",
] as const;

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkTsFiles(full));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

function stripBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripLineComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

function codeWithoutComments(source: string): string {
  return stripLineComments(stripBlockComments(source));
}

describe("G1-L anti-bypass architecture", () => {
  it("src/app n’importe pas createToolRouter / TrustedExecutionContext builders", () => {
    const files = walkTsFiles(APP_ROOT);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const code = codeWithoutComments(readFileSync(file, "utf8"));
      for (const symbol of FORBIDDEN_SYMBOLS) {
        expect(
          code.includes(symbol),
          `${path.relative(ROOT, file)} ne doit pas référencer ${symbol}`,
        ).toBe(false);
      }
      expect(
        code.includes("router.route("),
        `${path.relative(ROOT, file)} ne doit pas appeler router.route(`,
      ).toBe(false);
    }
  });

  it("route canonique POST /api/agent/tools passe par createAgentToolsRouteHandler + server-only", () => {
    const route = readFileSync(CANONICAL_ROUTE, "utf8");
    expect(route).toMatch(/import\s+["']server-only["']/);
    expect(route).toMatch(/createAgentToolsRouteHandler/);
    expect(route).not.toMatch(/createToolRouter/);
    expect(route).not.toMatch(/buildTrustedExecutionContext/);
    expect(route).not.toMatch(/toTrustedRouteInput/);
  });

  it("seul auth/create-router (server-only) câble createToolRouter en production server", () => {
    const createRouter = readFileSync(SERVER_AUTH_CREATE_ROUTER, "utf8");
    expect(createRouter).toMatch(/import\s+["']server-only["']/);
    expect(createRouter).toMatch(/createToolRouter/);

    const serverLibFiles = walkTsFiles(
      path.join(ROOT, "src/lib/agent/server"),
    ).filter(
      (f) =>
        !f.includes(`${path.sep}test-fixtures${path.sep}`) &&
        !f.endsWith(".test.ts"),
    );

    const offenders = serverLibFiles.filter((file) => {
      if (file === SERVER_AUTH_CREATE_ROUTER) {
        return false;
      }
      const code = codeWithoutComments(readFileSync(file, "utf8"));
      return code.includes("createToolRouter");
    });

    expect(
      offenders.map((f) => path.relative(ROOT, f)),
      "createToolRouter hors auth/create-router dans src/lib/agent/server",
    ).toEqual([]);
  });
});
