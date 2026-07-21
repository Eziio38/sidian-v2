import {
  archiveCreanceAction,
  createCreanceAction,
  updateCreanceDraftAction,
} from "@/app/actions/clients-creances";
import { AppShell } from "@/components/app/app-shell";
import { ArchiveButton } from "@/components/app/client-forms";
import { CreanceForm } from "@/components/app/creance-forms";
import { ReceivablePaymentSection } from "@/components/app/receivable-payment-section";
import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { requireConfirmedUser } from "@/lib/auth/session";
import { listActiveClientPayeurs } from "@/lib/clients/client-payeur";
import { listActiveCreances, listPaidAmountsByCreanceIds } from "@/lib/creances/creance";
import { getPrestataireStripeReadiness } from "@/lib/stripe/connect/readiness";
import { createClient } from "@/lib/supabase/server";

function centsToEurosInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

function formatMoney(cents: number, devise: string): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: devise,
  }).format(cents / 100);
}

export default async function PaiementsARecevoirPage() {
  const user = await requireConfirmedUser();
  const supabase = await createClient();
  const prestataire = await ensurePrestataireForUser(supabase, user);

  let clients: Awaited<ReturnType<typeof listActiveClientPayeurs>> = [];
  let creances: Awaited<ReturnType<typeof listActiveCreances>> = [];
  let paidByCreance = new Map<string, number>();
  let loadError: string | null = null;

  try {
    [clients, creances] = await Promise.all([
      listActiveClientPayeurs(supabase),
      listActiveCreances(supabase),
    ]);
    paidByCreance = await listPaidAmountsByCreanceIds(
      supabase,
      creances.map((c) => c.id),
    );
  } catch {
    loadError = "Impossible de charger les paiements à recevoir pour le moment.";
  }

  const stripeReadiness = await getPrestataireStripeReadiness(
    supabase,
    prestataire.id,
  );

  const clientNameById = new Map(clients.map((c) => [c.id, c.nom]));

  return (
    <AppShell
      title="Paiements à recevoir"
      description="Paiements à recevoir. Les brouillons restent modifiables ; l’archivage est logique."
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="space-y-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gris-500">
            Liste
          </h2>
          {loadError ? (
            <p
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            >
              {loadError}
            </p>
          ) : null}
          {!loadError && creances.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gris-200 bg-white p-8 text-sm text-gris-500">
              Aucun paiement à recevoir. Créez un brouillon à droite.
            </p>
          ) : null}
          <ul className="space-y-4">
            {creances.map((creance) => {
              const isDraft = creance.etat === "BROUILLON";
              return (
                <li
                  key={creance.id}
                  className="space-y-4 rounded-xl border border-gris-200 bg-white p-5"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-medium text-nuit">
                        {creance.libelle || "Sans libellé"}
                      </p>
                      <p className="mt-1 text-sm text-gris-500">
                        {clientNameById.get(creance.client_payeur_id) ??
                          "Client"}{" "}
                        · {formatMoney(creance.montant, creance.devise)} ·
                        échéance {creance.date_echeance}
                      </p>
                      {creance.reference_externe ? (
                        <p className="mt-1 text-xs text-gris-500">
                          Réf. {creance.reference_externe}
                        </p>
                      ) : null}
                    </div>
                    <ArchiveButton
                      action={archiveCreanceAction}
                      id={creance.id}
                      label="Archiver"
                    />
                  </div>
                  {isDraft ? (
                    <CreanceForm
                      action={updateCreanceDraftAction}
                      clients={clients.map((c) => ({ id: c.id, nom: c.nom }))}
                      initial={{
                        id: creance.id,
                        clientPayeurId: creance.client_payeur_id,
                        clientNom:
                          clientNameById.get(creance.client_payeur_id) ??
                          undefined,
                        montantEuros: centsToEurosInput(creance.montant),
                        devise: creance.devise,
                        dateEcheance: creance.date_echeance,
                        libelle: creance.libelle ?? "",
                        referenceExterne: creance.reference_externe ?? "",
                      }}
                      submitLabel="Enregistrer le brouillon"
                    />
                  ) : (
                    <p className="text-sm text-gris-500">
                      Seuls les brouillons sont modifiables ici.
                    </p>
                  )}
                  <div className="border-t border-gris-100 pt-4">
                    <ReceivablePaymentSection
                      creanceId={creance.id}
                      etat={creance.etat}
                      montantTotalCents={creance.montant}
                      montantRegleCents={paidByCreance.get(creance.id) ?? 0}
                      devise={creance.devise}
                      stripeReadiness={stripeReadiness}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gris-500">
            Nouveau brouillon
          </h2>
          <CreanceForm
            action={createCreanceAction}
            clients={clients.map((c) => ({ id: c.id, nom: c.nom }))}
            submitLabel="Créer le brouillon"
          />
        </section>
      </div>
    </AppShell>
  );
}
