import {
  archiveCreanceAction,
  createCreanceAction,
  updateCreanceDraftAction,
} from "@/app/actions/clients-creances";
import { AppShell } from "@/components/app/app-shell";
import { ArchiveButton } from "@/components/app/client-forms";
import { CreanceForm } from "@/components/app/creance-forms";
import { ReceivablePaymentSection } from "@/components/app/receivable-payment-section";
import {
  BusinessList,
  BusinessRow,
  RowAmount,
  RowDetails,
  WorkspacePanel,
  WorkspaceSection,
  WorkspaceSplit,
} from "@/components/app/workspace-blocks";
import { EmptyState, ErrorState } from "@/components/feedback";
import { Badge, ButtonLink } from "@/design-system";
import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { requireConfirmedUser } from "@/lib/auth/session";
import { listActiveClientPayeurs } from "@/lib/clients/client-payeur";
import { listActiveCreances, listPaidAmountsByCreanceIds } from "@/lib/creances/creance";
import { canArchiveReceivable } from "@/lib/receivables/archive-policy";
import { getPrestataireStripeReadiness } from "@/lib/stripe/connect/readiness";
import { createClient } from "@/lib/supabase/server";
import { UX_COPY } from "@/lib/ux/microcopy";

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
    loadError = UX_COPY.errorLoad.description;
  }

  const stripeReadiness = await getPrestataireStripeReadiness(
    supabase,
    prestataire.id,
  );

  const clientNameById = new Map(clients.map((c) => [c.id, c.nom]));

  return (
    <AppShell
      title="Protections"
      description="Prépare, vérifie et suis chaque paiement à recevoir depuis un même endroit."
      userDisplayName={prestataire.nom}
      userEmail={prestataire.email}
      actions={
        <ButtonLink
          href="/app/assistant"
        >
          Créer avec Sidian
        </ButtonLink>
      }
    >
      <WorkspaceSplit>
        <WorkspaceSection
          title="Toutes les protections"
          description="Ouvre une ligne pour voir son détail ou compléter un brouillon."
        >
          {loadError ? (
            <ErrorState
              compact
              title={UX_COPY.errorLoad.title}
              description={loadError}
            />
          ) : null}
          {!loadError && creances.length === 0 ? (
            <EmptyState
              title={UX_COPY.emptyPayments.title}
              description={UX_COPY.emptyPayments.description}
            />
          ) : null}
          {creances.length > 0 ? (
            <BusinessList ariaLabel="Protections">
              {creances.map((creance) => {
                const isDraft = creance.etat === "BROUILLON";
                const clientName =
                  clientNameById.get(creance.client_payeur_id) ?? "Client";
                return (
                  <BusinessRow
                    key={creance.id}
                    title={creance.libelle || "Sans libellé"}
                    description={`${clientName} · échéance ${creance.date_echeance}`}
                    accessory={
                      <>
                        <Badge tone={isDraft ? "neutral" : "success"}>
                          {isDraft ? "Brouillon" : "Active"}
                        </Badge>
                        <RowAmount>
                          {formatMoney(creance.montant, creance.devise)}
                        </RowAmount>
                      </>
                    }
                  >
                    <RowDetails label="Gérer la protection">
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
                      ) : null}
                      <ReceivablePaymentSection
                        creanceId={creance.id}
                        etat={creance.etat}
                        montantTotalCents={creance.montant}
                        montantRegleCents={paidByCreance.get(creance.id) ?? 0}
                        devise={creance.devise}
                        stripeReadiness={stripeReadiness}
                      />
                      {canArchiveReceivable(creance.etat) ? (
                        <ArchiveButton
                          action={archiveCreanceAction}
                          id={creance.id}
                          label="Archiver"
                        />
                      ) : null}
                    </RowDetails>
                  </BusinessRow>
                );
              })}
            </BusinessList>
          ) : null}
        </WorkspaceSection>

        <WorkspacePanel
          title="Préparer manuellement"
          description="Pour les cas où tu connais déjà toutes les informations."
        >
          <RowDetails label="Nouveau brouillon">
            <CreanceForm
              action={createCreanceAction}
              clients={clients.map((c) => ({ id: c.id, nom: c.nom }))}
              submitLabel="Créer le brouillon"
            />
          </RowDetails>
        </WorkspacePanel>
      </WorkspaceSplit>
    </AppShell>
  );
}
