import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import {
  cancelPaymentReceivableAction,
  ensureFollowUpCaseAction,
  updateFollowUpCaseAction,
} from "@/app/actions/receivable-workflows";
import { reconcilePaymentReceivableAction } from "@/app/actions/payment-reconciliation";
import { AppShell } from "@/components/app/app-shell";
import { CancelReceivableButton } from "@/components/app/cancel-receivable-button";
import { FollowUpControls } from "@/components/app/follow-up-controls";
import { PaymentReconciliationButton } from "@/components/app/payment-reconciliation-button";
import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { requireConfirmedUser } from "@/lib/auth/session";
import { loadPaymentReceivableDetail } from "@/lib/receivables/detail";
import { createClient } from "@/lib/supabase/server";

type PageProps = {
  params: Promise<{ id: string }>;
};

const STATE_LABELS = {
  BROUILLON: "Brouillon",
  OUVERTE: "Ouvert",
  PARTIELLEMENT_REGLEE: "Partiellement réglé",
  REGLEE: "Réglé",
  EN_LITIGE: "En litige",
  ANNULEE: "Annulé",
  IRRECOUVRABLE: "Clôturé sans règlement",
} as const;

const FOLLOW_UP_LABELS = {
  PREVENTION: "Prévention",
  ECHEANCE: "Échéance",
  SUIVI_AMIABLE: "Suivi amiable",
  PAUSE_LITIGE: "Pause pour litige",
  ATTENTE_CLIENT: "Attente du client",
  ATTENTE_PRESTATAIRE: "Votre réponse est attendue",
  ESCALADE_HUMAINE: "Examen humain",
  CLOS: "Clos",
} as const;

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(
    new Date(`${value}T12:00:00Z`),
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function PaymentReceivableDetailPage({ params }: PageProps) {
  const { id: rawId } = await params;
  const id = z.string().uuid().safeParse(rawId);
  if (!id.success) {
    notFound();
  }

  const user = await requireConfirmedUser();
  const supabase = await createClient();
  const prestataire = await ensurePrestataireForUser(supabase, user);
  const detail = await loadPaymentReceivableDetail(
    supabase,
    prestataire.id,
    id.data,
  );
  if (!detail) {
    notFound();
  }

  return (
    <AppShell
      title={detail.label}
      description={`${detail.clientName} · échéance ${formatDate(detail.dueDate)}`}
      actions={
        <Link
          href="/app/paiements-a-recevoir"
          className="inline-flex min-h-10 items-center justify-center rounded-lg border border-gris-200 bg-white px-4 text-sm font-medium text-nuit transition-colors hover:border-sidian-blue hover:text-sidian-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
        >
          Retour à la liste
        </Link>
      }
    >
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="financial-summary-title">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 id="financial-summary-title" className="text-lg font-semibold text-nuit">
                Situation financière
              </h2>
              <span className="rounded-full bg-gris-100 px-3 py-1 text-sm font-medium text-nuit">
                {STATE_LABELS[detail.state]}
              </span>
            </div>
            <dl className="grid overflow-hidden rounded-xl border border-gris-200 bg-white sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Montant total", detail.totalCents],
                ["Confirmé", detail.confirmedCents],
                ["En traitement", detail.processingCents],
                ["Reste à régler", detail.remainingCents],
              ].map(([label, amount], index) => (
                <div
                  key={label}
                  className={`p-4 ${index > 0 ? "border-t border-gris-100 sm:border-t-0 sm:border-l" : ""}`}
                >
                  <dt className="text-xs text-gris-500">{label}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums text-nuit">
                    {formatMoney(amount as number)}
                  </dd>
                </div>
              ))}
            </dl>
            {detail.processingCents > 0 ? (
              <p className="mt-3 text-sm leading-relaxed text-gris-500">
                Le montant en traitement reste séparé du confirmé et ne réduit
                pas encore le solde.
              </p>
            ) : null}
          </section>

          <section aria-labelledby="timeline-title">
            <h2 id="timeline-title" className="mb-3 text-lg font-semibold text-nuit">
              Historique
            </h2>
            {detail.timeline.length === 0 ? (
              <p className="rounded-xl border border-dashed border-gris-200 bg-white p-6 text-sm text-gris-500">
                Aucun événement de paiement n’est encore enregistré.
              </p>
            ) : (
              <ol className="divide-y divide-gris-100 overflow-hidden rounded-xl border border-gris-200 bg-white">
                {detail.timeline.map((event) => (
                  <li key={event.id} className="flex gap-3 p-4 sm:p-5">
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                        event.tone === "success"
                          ? "bg-emerald-500"
                          : event.tone === "warning"
                            ? "bg-amber-500"
                            : event.tone === "danger"
                              ? "bg-red-500"
                              : "bg-gris-500"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <p className="text-sm font-medium text-nuit">{event.title}</p>
                        <time className="shrink-0 text-xs text-gris-500" dateTime={event.occurredAt}>
                          {formatDateTime(event.occurredAt)}
                        </time>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-gris-500">
                        {event.description}
                      </p>
                      {event.amountCents ? (
                        <p className="mt-1 text-sm font-semibold tabular-nums text-nuit">
                          {formatMoney(event.amountCents)}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="rounded-xl border border-gris-200 bg-white p-5 xl:sticky xl:top-6">
          <h2 className="font-semibold text-nuit">Contexte</h2>
          <dl className="mt-4 divide-y divide-gris-100 text-sm">
            <div className="py-3 first:pt-0">
              <dt className="text-gris-500">Client</dt>
              <dd className="mt-1 font-medium text-nuit">{detail.clientName}</dd>
            </div>
            <div className="py-3">
              <dt className="text-gris-500">Échéance</dt>
              <dd className="mt-1 font-medium text-nuit">{formatDate(detail.dueDate)}</dd>
            </div>
            {detail.reference ? (
              <div className="py-3">
                <dt className="text-gris-500">Référence</dt>
                <dd className="mt-1 break-words font-medium text-nuit">{detail.reference}</dd>
              </div>
            ) : null}
            <div className="py-3 last:pb-0">
              <dt className="text-gris-500">Dossier de suivi</dt>
              <dd className="mt-1 font-medium text-nuit">
                {detail.followUp
                  ? FOLLOW_UP_LABELS[detail.followUp.state]
                  : "Pas encore créé"}
              </dd>
            </div>
          </dl>
          {detail.archived ? (
            <p className="mt-4 rounded-lg bg-gris-50 p-3 text-sm text-gris-500">
              Ce paiement à recevoir est archivé et reste visible uniquement
              pour son historique.
            </p>
          ) : null}

          {detail.state !== "BROUILLON" ? (
            <div className="mt-5 border-t border-gris-100 pt-5">
              <h2 className="mb-2 font-semibold text-nuit">Vérification Stripe</h2>
              <p className="mb-3 text-xs leading-relaxed text-gris-500">
                Sidian relit les objets Stripe dans votre compte connecté. Un
                écart ambigu reste sans effet et demande un examen humain.
              </p>
              <PaymentReconciliationButton
                receivableId={detail.id}
                action={reconcilePaymentReceivableAction}
              />
            </div>
          ) : null}

          {!detail.archived && detail.state !== "BROUILLON" ? (
            <div className="mt-5 border-t border-gris-100 pt-5">
              <h2 className="mb-3 font-semibold text-nuit">Piloter le suivi</h2>
              <FollowUpControls
                receivableId={detail.id}
                receivableState={detail.state}
                followUp={detail.followUp}
                ensureAction={ensureFollowUpCaseAction}
                updateAction={updateFollowUpCaseAction}
              />
            </div>
          ) : null}

          {!detail.archived &&
          detail.confirmedCents === 0 &&
          (detail.state === "OUVERTE" || detail.state === "EN_LITIGE") ? (
            <div className="mt-5 border-t border-gris-100 pt-5">
              <CancelReceivableButton
                receivableId={detail.id}
                action={cancelPaymentReceivableAction}
              />
              <p className="mt-2 text-xs leading-relaxed text-gris-500">
                L’annulation est refusée si Stripe traite encore une tentative.
                Aucun paiement confirmé n’est supprimé.
              </p>
            </div>
          ) : null}
        </aside>
      </div>
    </AppShell>
  );
}
