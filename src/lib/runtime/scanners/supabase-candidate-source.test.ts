/**
 * Projection SQL candidats scanners — snapshots sans effets de bord.
 */

import { describe, expect, it } from "vitest";

import { RuntimeError } from "../errors";
import {
  createSupabaseScannerCandidateSource,
  type ScannerCandidateQueryClient,
} from "./supabase-candidate-source";

type Result = {
  data: Record<string, unknown>[] | null;
  error: { message?: string } | null;
};

function chainable(result: Result): PromiseLike<Result> & {
  in: (...args: unknown[]) => ReturnType<typeof chainable>;
  eq: (...args: unknown[]) => ReturnType<typeof chainable>;
  is: (...args: unknown[]) => ReturnType<typeof chainable>;
} {
  const self = {
    then(
      onfulfilled?: ((value: Result) => unknown) | null | undefined,
      onrejected?: ((reason: unknown) => unknown) | null | undefined,
    ) {
      return Promise.resolve(result).then(
        onfulfilled as ((value: Result) => Result) | null | undefined,
        onrejected,
      );
    },
    in() {
      return self;
    },
    eq() {
      return self;
    },
    is() {
      return self;
    },
  };
  return self as PromiseLike<Result> & {
    in: (...args: unknown[]) => ReturnType<typeof chainable>;
    eq: (...args: unknown[]) => ReturnType<typeof chainable>;
    is: (...args: unknown[]) => ReturnType<typeof chainable>;
  };
}

function clientFor(tableRows: Record<string, Result>): ScannerCandidateQueryClient {
  return {
    from(table: string) {
      return {
        select() {
          const result = tableRows[table] ?? { data: [], error: null };
          return chainable(result);
        },
      };
    },
  };
}

describe("createSupabaseScannerCandidateSource", () => {
  it("projette créances ouvertes + dossier / solde / grace", async () => {
    const source = createSupabaseScannerCandidateSource(
      clientFor({
        creance: {
          data: [
            {
              id: "c1",
              prestataire_id: "p1",
              client_payeur_id: "cli1",
              date_echeance: "2026-08-10T00:00:00.000Z",
              etat: "OUVERTE",
              montant: 15_000,
              archived_at: null,
            },
          ],
          error: null,
        },
        dossier_suivi: {
          data: [
            {
              id: "d1",
              creance_id: "c1",
              etat: "PREVENTION",
              last_client_activity_at: null,
            },
          ],
          error: null,
        },
        paiement: {
          data: [{ creance_id: "c1", montant: 3_000 }],
          error: null,
        },
        payment_link: { data: [{ creance_id: "c1" }], error: null },
        payment_authorization: { data: [], error: null },
        regle: {
          data: [
            {
              prestataire_id: "p1",
              client_payeur_id: null,
              valeur: 14,
            },
          ],
          error: null,
        },
      }),
    );

    await expect(source.listOpenCreances()).resolves.toEqual([
      {
        creanceId: "c1",
        prestataireId: "p1",
        clientPayeurId: "cli1",
        dateEcheance: "2026-08-10",
        etat: "OUVERTE",
        dossierSuiviId: "d1",
        dossierEtat: "PREVENTION",
        lastClientActivityAt: null,
        paymentLinkShareable: true,
        hasDefaultActiveAuthorization: false,
        soldeRestantCents: 12_000,
        isPauseLitige: false,
        silenceGraceDaysFromRegle: 14,
      },
    ]);
  });

  it("ignore dossiers déjà CLOS sur créances terminales", async () => {
    const source = createSupabaseScannerCandidateSource(
      clientFor({
        creance: {
          data: [
            {
              id: "c2",
              prestataire_id: "p1",
              client_payeur_id: "cli1",
              date_echeance: "2026-07-01",
              etat: "REGLEE",
              montant: 1000,
              archived_at: null,
            },
          ],
          error: null,
        },
        dossier_suivi: {
          data: [
            {
              id: "d2",
              creance_id: "c2",
              etat: "CLOS",
              last_client_activity_at: null,
            },
          ],
          error: null,
        },
      }),
    );

    await expect(source.listTerminalCreances()).resolves.toEqual([]);
  });

  it("remonte RuntimeError si la query creance échoue", async () => {
    const source = createSupabaseScannerCandidateSource(
      clientFor({
        creance: {
          data: null,
          error: { message: "boom" },
        },
      }),
    );

    await expect(source.listOpenCreances()).rejects.toBeInstanceOf(RuntimeError);
    await expect(source.listOpenCreances()).rejects.toMatchObject({
      code: "scanner_candidates_creance_query_failed",
    });
  });
});
