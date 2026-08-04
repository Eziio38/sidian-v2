/**
 * Lecture créance tenant-scopée pour invoice.get / brouillons notification.
 */

import type { CreanceLookup, CreanceSnapshot } from "./types";

export type CreanceLookupPostgrestError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

/**
 * Chaîne fluent PostgREST volontairement large (comme outbound WhatsApp).
 */
export type CreanceLookupQueryBuilder = {
  select(columns?: string): CreanceLookupQueryBuilder;
  eq(column: string, value: unknown): CreanceLookupQueryBuilder;
  maybeSingle(): PromiseLike<{
    data: unknown;
    error: CreanceLookupPostgrestError | null;
  }>;
};

export type CreanceLookupClient = {
  from(table: string): CreanceLookupQueryBuilder;
};

type CreanceRow = {
  id: string;
  prestataire_id: string;
  montant: number;
  devise: string;
  etat: string;
  date_echeance: string;
  libelle: string | null;
  client_payeur: { nom: string } | { nom: string }[] | null;
};

function clientNameFromJoin(
  join: { nom: string } | { nom: string }[] | null | undefined,
): string | null {
  if (!join) return null;
  if (Array.isArray(join)) {
    return join[0]?.nom?.trim() || null;
  }
  return join.nom?.trim() || null;
}

function asCreanceRow(data: unknown): CreanceRow | null {
  if (data === null || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.prestataire_id !== "string" ||
    typeof row.montant !== "number" ||
    typeof row.devise !== "string" ||
    typeof row.etat !== "string" ||
    typeof row.date_echeance !== "string"
  ) {
    return null;
  }
  return {
    id: row.id,
    prestataire_id: row.prestataire_id,
    montant: row.montant,
    devise: row.devise,
    etat: row.etat,
    date_echeance: row.date_echeance,
    libelle: typeof row.libelle === "string" ? row.libelle : null,
    client_payeur: (row.client_payeur as CreanceRow["client_payeur"]) ?? null,
  };
}

/**
 * Lookup service_role / admin — filtre `prestataire_id` obligatoire
 * (TrustedExecutionContext.tenant_id uniquement).
 */
export function createSupabaseCreanceLookup(
  client: CreanceLookupClient,
): CreanceLookup {
  return {
    async findById(tenantId, creanceId) {
      if (!tenantId.trim() || !creanceId.trim()) {
        return null;
      }

      const { data, error } = await client
        .from("creance")
        .select(
          "id, prestataire_id, montant, devise, etat, date_echeance, libelle, client_payeur(nom)",
        )
        .eq("id", creanceId)
        .eq("prestataire_id", tenantId)
        .maybeSingle();

      if (error) {
        throw new Error("creance_lookup_failed");
      }
      const row = asCreanceRow(data);
      if (!row) return null;
      if (row.devise !== "EUR") {
        throw new Error("creance_unsupported_currency");
      }
      if (!Number.isSafeInteger(row.montant) || row.montant < 0) {
        throw new Error("creance_invalid_amount");
      }

      const snapshot: CreanceSnapshot = {
        id: row.id,
        tenantId: row.prestataire_id,
        amountCents: row.montant,
        currency: "EUR",
        status: row.etat,
        dueDate: row.date_echeance,
        clientName: clientNameFromJoin(row.client_payeur),
        libelle: row.libelle,
      };
      return snapshot;
    },
  };
}

/** Mémoire pour tests — isolation tenant stricte. */
export function createMemoryCreanceLookup(
  seed: CreanceSnapshot[] = [],
): CreanceLookup & { _rows: Map<string, CreanceSnapshot> } {
  const rows = new Map(seed.map((row) => [`${row.tenantId}:${row.id}`, row]));
  return {
    _rows: rows,
    async findById(tenantId, creanceId) {
      return rows.get(`${tenantId}:${creanceId}`) ?? null;
    },
  };
}
