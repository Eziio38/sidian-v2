#!/usr/bin/env node
/**
 * SID-OPS-001 — compteurs de budget LLM contre une base réelle.
 *
 * Les tests unitaires de `src/lib/llm/budget.ts` s'appuient sur un double du
 * RPC : ils prouvent que le client parle correctement à la base, pas que la
 * base compte correctement. Ce harnais vérifie l'autre moitié :
 *
 *   - le plafond tient sous concurrence réelle (le point qui manquait avec un
 *     compteur process-local) ;
 *   - anon / authenticated n'atteignent ni la table ni les fonctions ;
 *   - un scope non haché est refusé (aucune donnée personnelle en base) ;
 *   - la purge supprime bien les fenêtres expirées.
 */

import { createClient } from "@supabase/supabase-js";

import {
  assertLocalTestConfig,
  LOCAL_DEMO_ANON_KEY,
  LOCAL_DEMO_SERVICE_ROLE_KEY,
} from "./lib/assert-local-supabase.mjs";
import { withLocalOnlyFetch } from "./lib/local-only-fetch.mjs";

const localConfig = assertLocalTestConfig();

const clientOptions = withLocalOnlyFetch({
  auth: { autoRefreshToken: false, persistSession: false },
});

const admin = createClient(
  localConfig.url,
  LOCAL_DEMO_SERVICE_ROLE_KEY,
  clientOptions,
);
const anon = createClient(localConfig.url, LOCAL_DEMO_ANON_KEY, clientOptions);

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`✓ ${message}`);
}

/** Empreinte SHA-256 identique à `fingerprintBudgetScope` côté application. */
async function fingerprint(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function consume(args) {
  return admin.rpc("llm_budget_consume", {
    p_scope_fingerprint: args.scope ?? null,
    p_estimated_tokens: args.tokens ?? 0,
    p_max_requests_per_minute: args.rpm ?? 100,
    p_max_tokens_per_minute: args.tpm ?? 1_000_000,
    p_max_requests_per_scope_per_hour: args.rph ?? 100,
    p_now: args.now,
  });
}

async function main() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const scope = await fingerprint(`prestataire:${suffix}`);
  const otherScope = await fingerprint(`prestataire:autre:${suffix}`);

  // Base propre : la table n'est pas multi-tenant, on repart de zéro.
  {
    const { error } = await admin
      .from("llm_budget_counter")
      .delete()
      .neq("scope_fingerprint", "");
    if (error) throw new Error(`purge initiale: ${error.message}`);
  }

  // ── Isolation : ni anon ni authenticated n'atteignent les compteurs ──────
  {
    const { data, error } = await anon
      .from("llm_budget_counter")
      .select("scope_fingerprint")
      .limit(1);
    check(
      error !== null || (data?.length ?? 0) === 0,
      "anon ne lit aucune ligne de llm_budget_counter",
    );
  }

  {
    const { error } = await anon.rpc("llm_budget_consume", {
      p_scope_fingerprint: scope,
      p_estimated_tokens: 0,
      p_max_requests_per_minute: 100,
      p_max_tokens_per_minute: 1_000,
      p_max_requests_per_scope_per_hour: 100,
      p_now: null,
    });
    check(error !== null, "anon ne peut pas exécuter llm_budget_consume");
  }

  {
    const { error } = await anon.rpc("llm_budget_record_usage", {
      p_tokens: 10,
      p_now: null,
    });
    check(error !== null, "anon ne peut pas exécuter llm_budget_record_usage");
  }

  {
    const { error } = await anon.rpc("purge_expired_llm_budget_counters", {
      p_batch_size: 10,
      p_now: null,
    });
    check(
      error !== null,
      "anon ne peut pas exécuter purge_expired_llm_budget_counters",
    );
  }

  {
    const { error } = await anon.rpc("schema_migration_head");
    check(error !== null, "anon ne peut pas lire la tête de migration");
  }

  // ── Refus d'un scope non haché : aucune donnée en clair ne peut entrer ───
  {
    const { error } = await consume({
      scope: "prestataire-42",
      now: "2026-08-03T10:00:00.000Z",
    });
    check(
      error !== null && /scope_not_fingerprinted/.test(error.message),
      "un scope non haché est refusé (llm_budget_scope_not_fingerprinted)",
    );
  }

  // ── Plafond requêtes / minute ────────────────────────────────────────────
  {
    const now = "2026-08-03T11:00:00.000Z";
    const first = await consume({ scope, rpm: 2, now });
    const second = await consume({ scope, rpm: 2, now });
    const third = await consume({ scope, rpm: 2, now });

    check(first.data?.allowed === true, "1re requête acceptée");
    check(second.data?.allowed === true, "2e requête acceptée");
    check(
      third.data?.allowed === false &&
        third.data?.reason === "llm_rpm_exceeded",
      "3e requête refusée : llm_rpm_exceeded",
    );

    const next = await consume({
      scope: otherScope,
      rpm: 2,
      now: "2026-08-03T11:01:00.000Z",
    });
    check(
      next.data?.allowed === true,
      "la fenêtre minute suivante repart à zéro",
    );
  }

  // ── Plafond tokens / minute ──────────────────────────────────────────────
  {
    const now = "2026-08-03T12:00:00.000Z";
    const first = await consume({ tokens: 600, tpm: 1_000, now });
    const second = await consume({ tokens: 600, tpm: 1_000, now });
    check(first.data?.allowed === true, "budget tokens : 1er appel accepté");
    check(
      second.data?.allowed === false &&
        second.data?.reason === "llm_tpm_exceeded",
      "budget tokens : dépassement refusé (llm_tpm_exceeded)",
    );
    check(
      first.data?.global_tokens === 600,
      "les tokens réservés sont comptés une seule fois",
    );
  }

  // ── Plafond horaire par scope, indépendant de la fenêtre minute ─────────
  {
    const hourScope = await fingerprint(`scope-horaire:${suffix}`);
    const a = await consume({
      scope: hourScope,
      rph: 2,
      now: "2026-08-03T13:00:00.000Z",
    });
    const b = await consume({
      scope: hourScope,
      rph: 2,
      now: "2026-08-03T13:20:00.000Z",
    });
    const c = await consume({
      scope: hourScope,
      rph: 2,
      now: "2026-08-03T13:40:00.000Z",
    });
    check(a.data?.allowed === true && b.data?.allowed === true, "2 appels du scope acceptés dans l'heure");
    check(
      c.data?.allowed === false &&
        c.data?.reason === "llm_scope_hourly_exceeded",
      "3e appel du scope refusé dans la même heure",
    );

    const nextHour = await consume({
      scope: hourScope,
      rph: 2,
      now: "2026-08-03T14:00:00.000Z",
    });
    check(nextHour.data?.allowed === true, "la fenêtre horaire suivante repart à zéro");

    // Un refus de scope ne doit pas consommer le budget global : la fenêtre
    // minute de 13:40 a été créée par l'appel refusé, elle doit rester à zéro.
    const { data: globalRow, error: globalError } = await admin
      .from("llm_budget_counter")
      .select("request_count")
      .eq("scope_fingerprint", "global")
      .eq("window_kind", "minute")
      .eq("window_start", "2026-08-03T13:40:00.000Z")
      .single();
    if (globalError) throw new Error(globalError.message);
    check(
      globalRow.request_count === 0,
      "un refus de scope n'incrémente pas le compteur global",
    );
  }

  // ── Concurrence : le point que le compteur process-local ne tenait pas ──
  {
    const now = "2026-08-03T15:00:00.000Z";
    const concurrentScope = await fingerprint(`concurrence:${suffix}`);
    const RPM = 5;
    const ATTEMPTS = 25;

    const results = await Promise.all(
      Array.from({ length: ATTEMPTS }, () =>
        consume({ scope: concurrentScope, rpm: RPM, rph: 1_000, now }),
      ),
    );

    const failures = results.filter((r) => r.error !== null);
    check(failures.length === 0, "aucun appel concurrent n'échoue techniquement");

    const allowed = results.filter((r) => r.data?.allowed === true).length;
    check(
      allowed === RPM,
      `${ATTEMPTS} appels concurrents, exactement ${RPM} acceptés (obtenu ${allowed})`,
    );

    const { data: row, error } = await admin
      .from("llm_budget_counter")
      .select("request_count")
      .eq("scope_fingerprint", "global")
      .eq("window_kind", "minute")
      .eq("window_start", now)
      .single();
    if (error) throw new Error(`lecture compteur global: ${error.message}`);
    check(
      row.request_count === RPM,
      `le compteur persisté vaut exactement ${RPM} (obtenu ${row.request_count})`,
    );
  }

  // ── Consommation réelle enregistrée après succès ─────────────────────────
  {
    const now = "2026-08-03T16:00:00.000Z";
    const a = await admin.rpc("llm_budget_record_usage", {
      p_tokens: 400,
      p_now: now,
    });
    const b = await admin.rpc("llm_budget_record_usage", {
      p_tokens: 350,
      p_now: now,
    });
    if (a.error || b.error) {
      throw new Error(`record_usage: ${(a.error ?? b.error).message}`);
    }
    check(Number(b.data) === 750, "les tokens réels s'accumulent dans la fenêtre");

    const negative = await admin.rpc("llm_budget_record_usage", {
      p_tokens: -100,
      p_now: now,
    });
    check(
      Number(negative.data) === 750,
      "une valeur négative n'entame pas le compteur",
    );
  }

  // ── Purge des fenêtres expirées ─────────────────────────────────────────
  {
    const { count: before, error: beforeError } = await admin
      .from("llm_budget_counter")
      .select("scope_fingerprint", { count: "exact", head: true });
    if (beforeError) throw new Error(beforeError.message);
    check(before > 0, "des fenêtres existent avant la purge");

    // Cutoff antérieur à toutes les expirations : rien ne doit disparaître.
    const early = await admin.rpc("purge_expired_llm_budget_counters", {
      p_batch_size: 1_000,
      p_now: "2026-08-03T09:00:00.000Z",
    });
    if (early.error) throw new Error(early.error.message);
    check(early.data === 0, "une purge antérieure au cutoff ne supprime rien");

    const late = await admin.rpc("purge_expired_llm_budget_counters", {
      p_batch_size: 1_000,
      p_now: "2026-08-04T00:00:00.000Z",
    });
    if (late.error) throw new Error(late.error.message);
    check(late.data === before, `la purge supprime les ${before} fenêtres expirées`);

    const { count: after, error: afterError } = await admin
      .from("llm_budget_counter")
      .select("scope_fingerprint", { count: "exact", head: true });
    if (afterError) throw new Error(afterError.message);
    check(after === 0, "plus aucune fenêtre expirée en base");

    const invalid = await admin.rpc("purge_expired_llm_budget_counters", {
      p_batch_size: 0,
      p_now: null,
    });
    check(
      invalid.error !== null &&
        /purge_batch_invalid/.test(invalid.error.message),
      "un lot invalide est refusé",
    );
  }

  // ── Plafonds invalides refusés ──────────────────────────────────────────
  {
    const { error } = await consume({
      scope,
      rpm: 0,
      now: "2026-08-03T17:00:00.000Z",
    });
    check(
      error !== null && /limits_invalid/.test(error.message),
      "des plafonds invalides sont refusés",
    );
  }

  // ── Tête de migration accessible au service_role ────────────────────────
  {
    const { data, error } = await admin.rpc("schema_migration_head");
    if (error) throw new Error(`schema_migration_head: ${error.message}`);
    check(
      typeof data === "string" && /^\d{14}$/.test(data),
      `la tête de migration est exposée au service_role (${data})`,
    );
  }

  console.log(`\n${passed}/${passed} vérifications budget LLM réussies`);
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
});
