import { decideApprovalAction } from "@/app/actions/approvals";
import { ApprovalDecision } from "@/components/app/approval-decision";
import { AppShell } from "@/components/app/app-shell";
import {
  listApprovalRequests,
  presentApprovalRequest,
} from "@/lib/approvals/approvals";
import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { requireConfirmedUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const STATUS_LABELS = {
  pending: "À décider",
  approved: "Validée",
  rejected: "Refusée",
  expired: "Expirée",
} as const;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function ApprobationsPage() {
  const user = await requireConfirmedUser();
  const supabase = await createClient();
  await ensurePrestataireForUser(supabase, user);

  let requests: Awaited<ReturnType<typeof listApprovalRequests>> = [];
  let loadError = false;
  try {
    requests = await listApprovalRequests(supabase);
  } catch {
    loadError = true;
  }

  const pending = requests.filter((request) => request.status === "pending");
  const history = requests.filter((request) => request.status !== "pending");

  return (
    <AppShell
      title="Approbations"
      description="Les décisions qui dépassent le cadre automatique restent sous votre contrôle explicite."
    >
      <div className="max-w-5xl space-y-8">
        {loadError ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Impossible de charger les approbations pour le moment.
          </p>
        ) : null}

        {!loadError && pending.length === 0 ? (
          <section className="rounded-xl border border-dashed border-gris-200 bg-white p-8">
            <h2 className="font-semibold text-nuit">Aucune décision en attente</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gris-500">
              Sidian vous sollicitera ici lorsqu’une règle, une situation de
              paiement ou une action formelle exige votre accord.
            </p>
          </section>
        ) : null}

        {pending.length > 0 ? (
          <section aria-labelledby="pending-approvals-title">
            <h2 id="pending-approvals-title" className="mb-3 text-lg font-semibold text-nuit">
              À décider
            </h2>
            <ul className="divide-y divide-gris-100 overflow-hidden rounded-xl border border-gris-200 bg-white">
              {pending.map((request) => {
                const presentation = presentApprovalRequest(request);
                return (
                  <li key={request.id} className="space-y-4 p-5 sm:p-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="max-w-2xl">
                        <h3 className="font-semibold text-nuit">{presentation.title}</h3>
                        <p className="mt-1 text-sm leading-relaxed text-gris-500">
                          {presentation.description}
                        </p>
                      </div>
                      {presentation.amount ? (
                        <p className="shrink-0 font-semibold tabular-nums text-nuit">
                          {presentation.amount}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-3 border-t border-gris-100 pt-4 sm:flex-row sm:items-end sm:justify-between">
                      <p className="text-xs text-gris-500">
                        Créée le {formatDate(request.created_at)}
                        {request.expires_at
                          ? ` · expire le ${formatDate(request.expires_at)}`
                          : ""}
                      </p>
                      <ApprovalDecision id={request.id} action={decideApprovalAction} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {history.length > 0 ? (
          <section aria-labelledby="approval-history-title">
            <h2 id="approval-history-title" className="mb-3 text-lg font-semibold text-nuit">
              Historique
            </h2>
            <ul className="divide-y divide-gris-100 overflow-hidden rounded-xl border border-gris-200 bg-white">
              {history.slice(0, 20).map((request) => {
                const presentation = presentApprovalRequest(request);
                return (
                  <li key={request.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium text-nuit">{presentation.title}</p>
                      <p className="mt-1 text-xs text-gris-500">{formatDate(request.created_at)}</p>
                    </div>
                    <span className="text-sm font-medium text-gris-500">
                      {STATUS_LABELS[request.status]}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
