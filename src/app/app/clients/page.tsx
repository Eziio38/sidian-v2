import {
  archiveClientPayeurAction,
  createClientPayeurAction,
  updateClientPayeurAction,
} from "@/app/actions/clients-creances";
import { AppShell } from "@/components/app/app-shell";
import { ArchiveButton, ClientForm } from "@/components/app/client-forms";
import {
  BusinessList,
  BusinessRow,
  RowAvatar,
  RowDetails,
  WorkspacePanel,
  WorkspaceSection,
  WorkspaceSplit,
} from "@/components/app/workspace-blocks";
import { EmptyState, ErrorState } from "@/components/feedback";
import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { requireConfirmedUser } from "@/lib/auth/session";
import { listActiveClientPayeurs } from "@/lib/clients/client-payeur";
import { createClient } from "@/lib/supabase/server";
import { UX_COPY } from "@/lib/ux/microcopy";

type ClientsPageProps = {
  searchParams: Promise<{ conversation?: string }>;
};

export default async function ClientsPage({ searchParams }: ClientsPageProps) {
  const user = await requireConfirmedUser();
  const supabase = await createClient();
  const prestataire = await ensurePrestataireForUser(supabase, user);
  const params = await searchParams;
  const conversationId = params.conversation;

  let clients: Awaited<ReturnType<typeof listActiveClientPayeurs>> = [];
  let loadError: string | null = null;

  try {
    clients = await listActiveClientPayeurs(supabase);
  } catch {
    clients = [];
    loadError = UX_COPY.errorLoad.description;
  }

  return (
    <AppShell
      title="Clients"
      description="Retrouve un client, vois la prochaine action, prépare un suivi."
      userDisplayName={prestataire.nom}
      userEmail={prestataire.email}
    >
      <WorkspaceSplit>
        <WorkspaceSection
          title="Répertoire"
          description="Les contacts actifs et leur suivi."
        >
          {loadError ? (
            <ErrorState
              compact
              title={UX_COPY.errorLoad.title}
              description={loadError}
            />
          ) : null}
          {!loadError && clients.length === 0 ? (
            <EmptyState
              title={UX_COPY.emptyClients.title}
              description={UX_COPY.emptyClients.description}
            />
          ) : null}
          {clients.length > 0 ? (
            <BusinessList ariaLabel="Clients">
              {clients.map((client) => (
                <BusinessRow
                  key={client.id}
                  title={client.nom}
                  description={client.email}
                  leading={<RowAvatar name={client.nom} />}
                >
                  <RowDetails label="Modifier le client">
                    <ClientForm
                      action={updateClientPayeurAction}
                      initial={{
                        id: client.id,
                        nom: client.nom,
                        email: client.email,
                      }}
                      submitLabel="Enregistrer"
                    />
                    <ArchiveButton
                      action={archiveClientPayeurAction}
                      id={client.id}
                      label="Archiver"
                    />
                  </RowDetails>
                </BusinessRow>
              ))}
            </BusinessList>
          ) : null}
        </WorkspaceSection>

        <WorkspacePanel
          title="Nouveau client"
          description="Ajoute seulement les informations utiles au suivi."
        >
          <RowDetails label="Ajouter un client">
            <ClientForm
              action={createClientPayeurAction}
              submitLabel="Créer le client"
              conversationId={conversationId}
            />
          </RowDetails>
        </WorkspacePanel>
      </WorkspaceSplit>
    </AppShell>
  );
}
