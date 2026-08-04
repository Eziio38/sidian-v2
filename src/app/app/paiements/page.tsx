import { AppShell } from "@/components/app/app-shell";
import {
  BusinessList,
  BusinessRow,
  FilterBar,
  FilterLink,
  RowAmount,
} from "@/components/app/workspace-blocks";
import { EmptyState, ErrorState } from "@/components/feedback";
import { Badge, ButtonLink, type BadgeTone } from "@/design-system";
import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { requireConfirmedUser } from "@/lib/auth/session";
import { listActiveClientPayeurs } from "@/lib/clients/client-payeur";
import { listActiveCreances, listPaidAmountsByCreanceIds } from "@/lib/creances/creance";
import { createClient } from "@/lib/supabase/server";
import { UX_COPY } from "@/lib/ux/microcopy";
import type { Database } from "@/types/database.generated";

function formatMoney(cents: number, devise: string): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: devise,
  }).format(cents / 100);
}

function formatDate(iso: string | null): string {
  if (!iso) return "À préciser";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return "À préciser";
  }
}

type CreanceEtat = Database["public"]["Enums"]["creance_etat"];

/**
 * Libellés des états réels de `creance_etat`.
 *
 * Le vocabulaire est celui d'un freelance, pas celui de la base : « Réglé »
 * plutôt que REGLEE, « Partiellement réglé » plutôt que PARTIELLEMENT_REGLEE.
 * L'objet est typé sur l'enum, donc l'ajout d'un état en base casse la
 * compilation au lieu de retomber silencieusement sur un libellé générique.
 */
const STATUS_LABELS: Record<CreanceEtat, string> = {
  BROUILLON: "Brouillon",
  OUVERTE: "En attente",
  PARTIELLEMENT_REGLEE: "Partiellement réglé",
  REGLEE: "Réglé",
  EN_LITIGE: "En litige",
  ANNULEE: "Annulé",
  IRRECOUVRABLE: "Irrécouvrable",
};

const STATUS_TONES: Record<CreanceEtat, BadgeTone> = {
  BROUILLON: "outline",
  OUVERTE: "info",
  PARTIELLEMENT_REGLEE: "warning",
  REGLEE: "success",
  EN_LITIGE: "danger",
  ANNULEE: "neutral",
  IRRECOUVRABLE: "danger",
};

/** États pour lesquels plus rien n'est attendu du client. */
const SETTLED_ETATS: readonly CreanceEtat[] = [
  "REGLEE",
  "ANNULEE",
  "IRRECOUVRABLE",
];

/** Une créance « en cours » attend encore un règlement. */
function isEnCours(etat: CreanceEtat): boolean {
  return etat !== "BROUILLON" && !SETTLED_ETATS.includes(etat);
}

/** Le retard se déduit de l'échéance : aucun état d'enum ne le porte. */
function isEnRetard(etat: CreanceEtat, dateEcheance: string | null): boolean {
  if (!isEnCours(etat) || !dateEcheance) return false;
  const due = new Date(dateEcheance);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due.getTime() < today.getTime();
}

type PaiementsPageProps = {
  searchParams: Promise<{ filtre?: string }>;
};

export default async function PaiementsPage({ searchParams }: PaiementsPageProps) {
  const user = await requireConfirmedUser();
  const supabase = await createClient();
  const prestataire = await ensurePrestataireForUser(supabase, user);
  const params = await searchParams;
  const filtre = params.filtre ?? "tous";

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

  const clientNameById = new Map(clients.map((c) => [c.id, c.nom]));

  const filtered = creances.filter((creance) => {
    if (filtre === "brouillon") return creance.etat === "BROUILLON";
    // « En cours » = un règlement est encore attendu. Les créances réglées,
    // annulées ou irrécouvrables en sont exclues : les inclure faisait passer
    // pour « à suivre » des dossiers définitivement clos.
    if (filtre === "actifs") return isEnCours(creance.etat);
    if (filtre === "regles") return SETTLED_ETATS.includes(creance.etat);
    return true;
  });

  const filters = [
    { id: "tous", label: "Tous", href: "/app/paiements" },
    { id: "actifs", label: "En cours", href: "/app/paiements?filtre=actifs" },
    { id: "regles", label: "Clôturés", href: "/app/paiements?filtre=regles" },
    {
      id: "brouillon",
      label: "Brouillons",
      href: "/app/paiements?filtre=brouillon",
    },
  ] as const;

  // Un filtre qui ne renvoie rien n'est pas un premier usage : l'utilisateur a
  // déjà des paiements, il vient seulement de restreindre la vue.
  const hasAnyCreance = creances.length > 0;
  const isNoResults = hasAnyCreance && filtered.length === 0;

  return (
    <AppShell
      title="Paiements"
      description="Montants, clients et échéances — ce qui est attendu et ce qui est en cours."
      userDisplayName={prestataire.nom}
      userEmail={prestataire.email}
      actions={
        <ButtonLink
          href="/app/assistant?action=create_protection"
        >
          Créer une protection
        </ButtonLink>
      }
    >
      <FilterBar>
        {filters.map((item) => {
          const active = filtre === item.id;
          return (
            <FilterLink
              key={item.id}
              href={item.href}
              active={active}
            >
              {item.label}
            </FilterLink>
          );
        })}
      </FilterBar>

      {loadError ? (
        <ErrorState
          compact
          title={UX_COPY.errorLoad.title}
          description={loadError}
        />
      ) : null}

      {!loadError && isNoResults ? (
        <EmptyState
          title="Aucun paiement dans cette vue"
          description="Aucun paiement ne correspond à ce filtre. Change de filtre pour retrouver tes autres dossiers."
          action={{ label: "Voir tous les paiements", href: "/app/paiements" }}
        />
      ) : null}

      {!loadError && !hasAnyCreance ? (
        <EmptyState
          title={UX_COPY.emptyPayments.title}
          description={UX_COPY.emptyPayments.description}
          action={{
            label: UX_COPY.emptyPayments.actionLabel ?? "Créer un paiement",
            href: "/app/assistant",
          }}
        />
      ) : null}

      {!loadError && filtered.length > 0 ? (
        <BusinessList ariaLabel="Paiements">
          {filtered.map((creance) => {
            const paid = paidByCreance.get(creance.id) ?? 0;
            const outstanding = Math.max(0, creance.montant - paid);
            const clientName =
              clientNameById.get(creance.client_payeur_id) ?? "Client";
            return (
              <BusinessRow
                key={creance.id}
                href={`/app/paiements-a-recevoir/${creance.id}`}
                title={creance.libelle || "Sans libellé"}
                description={`${clientName} · Échéance ${formatDate(creance.date_echeance)}`}
                accessory={
                  <>
                    {isEnRetard(creance.etat, creance.date_echeance) ? (
                      <Badge tone="danger">En retard</Badge>
                    ) : (
                      <Badge tone={STATUS_TONES[creance.etat]}>
                        {STATUS_LABELS[creance.etat]}
                      </Badge>
                    )}
                    <RowAmount>
                      {formatMoney(outstanding, creance.devise)}
                    </RowAmount>
                  </>
                }
              />
            );
          })}
        </BusinessList>
      ) : null}
    </AppShell>
  );
}
