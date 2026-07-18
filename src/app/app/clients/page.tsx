import {
  archiveClientPayeurAction,
  createClientPayeurAction,
  updateClientPayeurAction,
} from "@/app/actions/clients-creances";
import { AppShell } from "@/components/app/app-shell";
import { ArchiveButton, ClientForm } from "@/components/app/client-forms";
import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { requireConfirmedUser } from "@/lib/auth/session";
import { listActiveClientPayeurs } from "@/lib/clients/client-payeur";
import { createClient } from "@/lib/supabase/server";

export default async function ClientsPage() {
  const user = await requireConfirmedUser();
  const supabase = await createClient();
  await ensurePrestataireForUser(supabase, user);

  let clients: Awaited<ReturnType<typeof listActiveClientPayeurs>> = [];
  let loadError: string | null = null;

  try {
    clients = await listActiveClientPayeurs(supabase);
  } catch {
    clients = [];
    loadError = "Impossible de charger les clients pour le moment.";
  }

  return (
    <AppShell
      title="Clients"
      description="Clients payeurs rattachés à votre activité. Les données sont isolées à votre compte."
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="space-y-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gris-500">
            Liste
          </h2>
          {loadError ? (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {loadError}
            </p>
          ) : null}
          {!loadError && clients.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gris-200 bg-white p-8 text-sm text-gris-500">
              Aucun client pour l&apos;instant. Créez le premier à droite.
            </p>
          ) : null}
          <ul className="divide-y divide-gris-100 overflow-hidden rounded-xl border border-gris-200 bg-white">
            {clients.map((client) => (
              <li key={client.id} className="space-y-4 p-5">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-nuit">{client.nom}</p>
                    <p className="text-sm text-gris-500">{client.email}</p>
                  </div>
                  <ArchiveButton
                    action={archiveClientPayeurAction}
                    id={client.id}
                    label="Archiver"
                  />
                </div>
                <ClientForm
                  action={updateClientPayeurAction}
                  initial={{
                    id: client.id,
                    nom: client.nom,
                    email: client.email,
                  }}
                  submitLabel="Enregistrer"
                />
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gris-500">
            Nouveau client
          </h2>
          <ClientForm
            action={createClientPayeurAction}
            submitLabel="Créer le client"
          />
        </section>
      </div>
    </AppShell>
  );
}
