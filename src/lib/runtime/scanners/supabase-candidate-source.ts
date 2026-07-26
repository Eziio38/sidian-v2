/**
 * Lecture candidats scanners depuis creance / dossier_suivi / regle.
 * Aucun effet de bord — snapshots pour eligibility TS.
 */

import { RuntimeError } from "../errors";
import type {
  FailedTentativeSnapshot,
  OpenCreanceSnapshot,
  ScannerCandidateSource,
  TerminalCreanceSnapshot,
} from "./candidates";

type Row = Record<string, unknown>;

type QueryError = { message?: string } | null;

/**
 * Client minimal compatible PostgREST (admin / service_role).
 * Évite de coupler le scanner au générateur Database tant que les enums
 * runtime ne sont pas régénérés.
 */
export type ScannerCandidateQueryClient = {
  from: (table: string) => {
    select: (columns: string) => {
      in: (column: string, values: readonly string[]) => PromiseLike<{
        data: Row[] | null;
        error: QueryError;
      }> &
        Chain;
      eq: (column: string, value: string | boolean) => PromiseLike<{
        data: Row[] | null;
        error: QueryError;
      }> &
        Chain;
      is: (column: string, value: null) => PromiseLike<{
        data: Row[] | null;
        error: QueryError;
      }> &
        Chain;
    };
  };
};

type Chain = {
  in: (column: string, values: readonly string[]) => PromiseLike<{
    data: Row[] | null;
    error: QueryError;
  }> &
    Chain;
  eq: (column: string, value: string | boolean) => PromiseLike<{
    data: Row[] | null;
    error: QueryError;
  }> &
    Chain;
  is: (column: string, value: null) => PromiseLike<{
    data: Row[] | null;
    error: QueryError;
  }> &
    Chain;
};

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function asString(value: unknown): string {
  return String(value ?? "");
}

function parseGraceDays(valeur: unknown): number | null {
  if (typeof valeur === "number" && Number.isFinite(valeur)) {
    return Math.trunc(valeur);
  }
  if (typeof valeur === "string") {
    const n = Number(valeur);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  if (valeur && typeof valeur === "object") {
    const obj = valeur as Record<string, unknown>;
    if ("days" in obj) return parseGraceDays(obj.days);
    if ("jours" in obj) return parseGraceDays(obj.jours);
    if ("value" in obj) return parseGraceDays(obj.value);
  }
  return null;
}

async function requireRows(
  promise: PromiseLike<{ data: Row[] | null; error: QueryError }>,
  code: string,
): Promise<Row[]> {
  const result = await promise;
  if (result.error) {
    throw new RuntimeError(code, result.error.message ?? code);
  }
  return result.data ?? [];
}

export function createSupabaseScannerCandidateSource(
  client: ScannerCandidateQueryClient,
): ScannerCandidateSource {
  return {
    async listOpenCreances() {
      const creances = await requireRows(
        client
          .from("creance")
          .select(
            "id, prestataire_id, client_payeur_id, date_echeance, etat, montant, archived_at",
          )
          .in("etat", ["OUVERTE", "PARTIELLEMENT_REGLEE"])
          .is("archived_at", null),
        "scanner_candidates_creance_query_failed",
      );

      if (creances.length === 0) return [];

      const creanceIds = creances.map((c) => asString(c.id));

      const [dossiers, paiements, links, auths, regles] = await Promise.all([
        requireRows(
          client
            .from("dossier_suivi")
            .select("id, creance_id, etat, last_client_activity_at")
            .in("creance_id", creanceIds),
          "scanner_candidates_dossier_query_failed",
        ),
        requireRows(
          client
            .from("paiement")
            .select("creance_id, montant")
            .in("creance_id", creanceIds),
          "scanner_candidates_paiement_query_failed",
        ),
        requireRows(
          client
            .from("payment_link")
            .select("creance_id")
            .in("creance_id", creanceIds)
            .eq("status", "active"),
          "scanner_candidates_link_query_failed",
        ),
        requireRows(
          client
            .from("payment_authorization")
            .select("prestataire_id, client_payeur_id")
            .eq("etat", "ACTIVE")
            .eq("is_default", true),
          "scanner_candidates_auth_query_failed",
        ),
        requireRows(
          client
            .from("regle")
            .select("prestataire_id, client_payeur_id, valeur")
            .eq("parametre", "delai_grace")
            .eq("actif", true),
          "scanner_candidates_regle_query_failed",
        ),
      ]);

      const dossierByCreance = new Map(
        dossiers.map((d) => [asString(d.creance_id), d] as const),
      );
      const paidByCreance = new Map<string, number>();
      for (const p of paiements) {
        const id = asString(p.creance_id);
        paidByCreance.set(id, (paidByCreance.get(id) ?? 0) + asNumber(p.montant));
      }
      const linkSet = new Set(links.map((l) => asString(l.creance_id)));
      const authSet = new Set(
        auths.map(
          (a) =>
            `${asString(a.prestataire_id)}::${asString(a.client_payeur_id)}`,
        ),
      );

      const graceClient = new Map<string, number>();
      const gracePrestataire = new Map<string, number>();
      for (const r of regles) {
        const days = parseGraceDays(r.valeur);
        if (days == null) continue;
        const prestataireId = asString(r.prestataire_id);
        if (r.client_payeur_id) {
          graceClient.set(
            `${prestataireId}::${asString(r.client_payeur_id)}`,
            days,
          );
        } else {
          gracePrestataire.set(prestataireId, days);
        }
      }

      const out: OpenCreanceSnapshot[] = [];
      for (const c of creances) {
        const id = asString(c.id);
        const dossier = dossierByCreance.get(id) ?? null;
        const paid = paidByCreance.get(id) ?? 0;
        const solde = asNumber(c.montant) - paid;
        const prestataireId = asString(c.prestataire_id);
        const clientPayeurId = asString(c.client_payeur_id);
        const grace =
          graceClient.get(`${prestataireId}::${clientPayeurId}`) ??
          gracePrestataire.get(prestataireId) ??
          null;
        const dossierEtat = dossier
          ? (asString(dossier.etat) as OpenCreanceSnapshot["dossierEtat"])
          : null;

        out.push({
          creanceId: id,
          prestataireId,
          clientPayeurId,
          dateEcheance: asString(c.date_echeance).slice(0, 10),
          etat: asString(c.etat) as OpenCreanceSnapshot["etat"],
          dossierSuiviId: dossier ? asString(dossier.id) : null,
          dossierEtat,
          lastClientActivityAt: dossier
            ? ((dossier.last_client_activity_at as string | null) ?? null)
            : null,
          paymentLinkShareable: linkSet.has(id),
          hasDefaultActiveAuthorization: authSet.has(
            `${prestataireId}::${clientPayeurId}`,
          ),
          soldeRestantCents: solde,
          isPauseLitige: dossierEtat === "PAUSE_LITIGE",
          silenceGraceDaysFromRegle: grace,
        });
      }
      return out;
    },

    async listTerminalCreances() {
      const creances = await requireRows(
        client
          .from("creance")
          .select(
            "id, prestataire_id, client_payeur_id, date_echeance, etat, montant, archived_at",
          )
          .in("etat", ["REGLEE", "ANNULEE", "IRRECOUVRABLE"])
          .is("archived_at", null),
        "scanner_candidates_terminal_query_failed",
      );

      if (creances.length === 0) return [];

      const dossiers = await requireRows(
        client
          .from("dossier_suivi")
          .select("id, creance_id, etat, last_client_activity_at")
          .in(
            "creance_id",
            creances.map((c) => asString(c.id)),
          ),
        "scanner_candidates_terminal_dossier_query_failed",
      );

      const dossierByCreance = new Map(
        dossiers.map((d) => [asString(d.creance_id), d] as const),
      );

      const out: TerminalCreanceSnapshot[] = [];
      for (const c of creances) {
        const id = asString(c.id);
        const dossier = dossierByCreance.get(id) ?? null;
        const dossierEtat = dossier
          ? (asString(dossier.etat) as TerminalCreanceSnapshot["dossierEtat"])
          : null;
        if (dossierEtat === "CLOS") continue;
        out.push({
          creanceId: id,
          prestataireId: asString(c.prestataire_id),
          dateEcheance: asString(c.date_echeance).slice(0, 10),
          etat: asString(c.etat) as TerminalCreanceSnapshot["etat"],
          dossierSuiviId: dossier ? asString(dossier.id) : null,
          dossierEtat,
        });
      }
      return out;
    },

    async listFailedTentatives() {
      const tentatives = await requireRows(
        client
          .from("tentative_paiement")
          .select("id, creance_id, etat, created_at")
          .eq("etat", "ECHOUEE"),
        "scanner_candidates_tentative_query_failed",
      );

      if (tentatives.length === 0) return [];

      const creanceIds = [
        ...new Set(tentatives.map((t) => asString(t.creance_id))),
      ];
      const [creances, dossiers] = await Promise.all([
        requireRows(
          client
            .from("creance")
            .select(
              "id, prestataire_id, client_payeur_id, date_echeance, etat, montant, archived_at",
            )
            .in("id", creanceIds),
          "scanner_candidates_tentative_creance_query_failed",
        ),
        requireRows(
          client
            .from("dossier_suivi")
            .select("id, creance_id, etat, last_client_activity_at")
            .in("creance_id", creanceIds),
          "scanner_candidates_tentative_dossier_query_failed",
        ),
      ]);

      const creanceById = new Map(
        creances.map((c) => [asString(c.id), c] as const),
      );
      const dossierByCreance = new Map(
        dossiers.map((d) => [asString(d.creance_id), d] as const),
      );

      const out: FailedTentativeSnapshot[] = [];
      for (const t of tentatives) {
        const creanceId = asString(t.creance_id);
        const creance = creanceById.get(creanceId);
        if (!creance || creance.archived_at) continue;
        out.push({
          tentativeId: asString(t.id),
          creanceId,
          prestataireId: asString(creance.prestataire_id),
          dossierSuiviId: dossierByCreance.has(creanceId)
            ? asString(dossierByCreance.get(creanceId)!.id)
            : null,
          etat: "ECHOUEE",
          failedAt: asString(t.created_at),
        });
      }
      return out;
    },
  };
}
