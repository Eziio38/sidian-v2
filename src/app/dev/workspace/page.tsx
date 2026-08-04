import { notFound } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import {
  BusinessList,
  BusinessRow,
  EventMarker,
  EventTime,
  FilterBar,
  FilterLink,
  RowAmount,
  RowAvatar,
  RowDetails,
  SettingsStack,
  WorkspacePanel,
  WorkspaceSection,
  WorkspaceSplit,
} from "@/components/app/workspace-blocks";
import { EmptyState, ErrorState } from "@/components/feedback";
import {
  Badge,
  Button,
  ButtonLink,
  Input,
  PageLoading,
  SuccessCard,
} from "@/design-system";
import { UX_COPY } from "@/lib/ux/microcopy";

export const dynamic = "force-dynamic";

type DevWorkspacePreviewProps = {
  searchParams: Promise<{ page?: string; state?: string; nav?: string }>;
};

function isPreviewAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.SIDIAN_ALLOW_DEV_ASSISTANT_PREVIEW === "1";
}

const PREVIEW_META: Record<
  string,
  { title: string; description: string; active: string }
> = {
  paiements: {
    title: "Paiements",
    description:
      "Montants, clients et échéances — ce qui est attendu et ce qui est en cours.",
    active: "paiements",
  },
  clients: {
    title: "Clients",
    description:
      "Retrouve un client, vois la prochaine action, prépare un suivi.",
    active: "clients",
  },
  activite: {
    title: "Activité",
    description: "Les événements récents sur tes protections et paiements.",
    active: "activite",
  },
  parametres: {
    title: "Paramètres",
    description:
      "Les infos essentielles de ton activité, et l’état réel de tes canaux.",
    active: "parametres",
  },
  protections: {
    title: "Protections",
    description:
      "Prépare, vérifie et suis chaque paiement à recevoir au même endroit.",
    active: "protections",
  },
  erreur: {
    title: "Paiements",
    description: "Montants, clients et échéances.",
    active: "paiements",
  },
  empty: {
    title: "Clients",
    description: "Retrouve un client, vois la prochaine action.",
    active: "clients",
  },
  loading: {
    title: "Paiements",
    description: "Montants, clients et échéances.",
    active: "paiements",
  },
};

const PAYMENTS = [
  {
    title: "Identité visuelle — solde",
    client: "Atelier Nord",
    due: "2 août 2026",
    status: "En cours",
    tone: "info" as const,
    amount: "1 280,00 €",
  },
  {
    title: "Acompte juillet",
    client: "Maison Claire",
    due: "10 août 2026",
    status: "Brouillon",
    tone: "neutral" as const,
    amount: "640,00 €",
  },
  {
    title: "Mission conseil — juin",
    client: "Studio Lemaire",
    due: "28 juillet 2026",
    status: "À vérifier",
    tone: "warning" as const,
    amount: "2 450,00 €",
  },
] as const;

export default async function DevWorkspacePreviewPage({
  searchParams,
}: DevWorkspacePreviewProps) {
  if (!isPreviewAllowed()) notFound();

  const params = await searchParams;
  const page = params.page ?? "paiements";
  const state = params.state ?? "list";
  const meta = PREVIEW_META[page] ?? PREVIEW_META.paiements;

  return (
    <AppShell
      title={meta.title}
      description={meta.description}
      userDisplayName="Lucie Martin"
      userEmail="lucie.martin@sidian.fr"
      userPlan="Early Access"
      defaultMobileNavOpen={params.nav === "open"}
      previewActiveNavId={meta.active}
      actions={
        page === "paiements" || page === "protections" ? (
          <ButtonLink href="/dev/assistant?demo=A">
            Créer une protection
          </ButtonLink>
        ) : null
      }
    >
      {page === "loading" || state === "loading" ? <PageLoading /> : null}

      {page === "erreur" || state === "error" ? (
        <ErrorState
          title={UX_COPY.requestSaveFailed.title}
          description={UX_COPY.requestSaveFailed.description}
          action={{
            label: UX_COPY.requestSaveFailed.actionLabel ?? "Réessayer",
            href: "/dev/workspace?page=paiements",
          }}
        />
      ) : null}

      {page === "empty" || state === "empty" ? (
        <EmptyState
          title={UX_COPY.emptyClients.title}
          description={UX_COPY.emptyClients.description}
          action={{
            label: UX_COPY.emptyClients.actionLabel ?? "Ajouter un client",
            href: "/dev/assistant?demo=A",
          }}
        />
      ) : null}

      {page === "paiements" && state === "list" ? (
        <>
          <FilterBar>
            <FilterLink href="/dev/workspace?page=paiements" active>
              Tous
            </FilterLink>
            <FilterLink href="/dev/workspace?page=paiements&state=list">
              En cours
            </FilterLink>
            <FilterLink href="/dev/workspace?page=paiements&state=list">
              Brouillons
            </FilterLink>
          </FilterBar>
          <WorkspaceSection
            title="À recevoir"
            description="Les montants attendus, classés par prochaine échéance."
          >
            <BusinessList ariaLabel="Paiements">
              {PAYMENTS.map((item) => (
                <BusinessRow
                  key={item.title}
                  title={item.title}
                  description={`${item.client} · Échéance ${item.due}`}
                  accessory={
                    <>
                      <Badge tone={item.tone}>{item.status}</Badge>
                      <RowAmount>{item.amount}</RowAmount>
                    </>
                  }
                />
              ))}
            </BusinessList>
          </WorkspaceSection>
        </>
      ) : null}

      {page === "clients" && state === "list" ? (
        <WorkspaceSplit>
          <WorkspaceSection
            title="Répertoire"
            description="Les contacts actifs et leur prochaine action."
          >
            <BusinessList ariaLabel="Clients">
              {[
                ["Atelier Nord", "contact@ateliernord.fr", "2 protections"],
                ["Maison Claire", "finance@maisonclaire.fr", "1 brouillon"],
                ["Studio Lemaire", "hello@lemaire.studio", "À relancer"],
              ].map(([name, email, activity]) => (
                <BusinessRow
                  key={name}
                  title={name}
                  description={email}
                  leading={<RowAvatar name={name} />}
                  accessory={<Badge tone="neutral">{activity}</Badge>}
                />
              ))}
            </BusinessList>
          </WorkspaceSection>
          <WorkspacePanel
            title="Nouveau client"
            description="Ajoute seulement les informations utiles au suivi."
          >
            <RowDetails label="Ajouter un client">
              <form>
                <Input id="preview-client-name" label="Nom" defaultValue="" />
                <Input
                  id="preview-client-email"
                  label="Email"
                  type="email"
                  defaultValue=""
                />
                <Button type="button">Créer le client</Button>
              </form>
            </RowDetails>
          </WorkspacePanel>
        </WorkspaceSplit>
      ) : null}

      {page === "activite" && state === "list" ? (
        <WorkspaceSection
          title="Derniers événements"
          description="Ce qui a changé, dans l’ordre."
        >
          <BusinessList ordered ariaLabel="Activité récente">
            {[
              {
                title: "Paiement confirmé",
                desc: "Atelier Nord — 1 280 €",
                when: "Hier, 16:42",
                tone: "success" as const,
              },
              {
                title: "Protection créée",
                desc: "Maison Claire — échéance 10 août",
                when: "Lundi, 09:15",
                tone: "neutral" as const,
              },
              {
                title: "Action demandée",
                desc: "Studio Lemaire — vérifier le règlement",
                when: "Vendredi, 14:08",
                tone: "warning" as const,
              },
            ].map((event) => (
              <BusinessRow
                key={event.title}
                title={event.title}
                description={event.desc}
                leading={<EventMarker tone={event.tone} />}
                accessory={<EventTime>{event.when}</EventTime>}
              />
            ))}
          </BusinessList>
        </WorkspaceSection>
      ) : null}

      {page === "parametres" && state === "list" ? (
        <SettingsStack>
          <WorkspacePanel
            title="Entreprise"
            description="Les informations présentées à tes clients."
          >
            <SuccessCard
              density="compact"
              title="Lucie Martin — Studio indépendant"
              description="lucie@exemple.fr"
            />
          </WorkspacePanel>
          <WorkspacePanel
            title="Intégrations"
            description="Les canaux nécessaires au suivi de tes paiements."
          >
            <BusinessList ariaLabel="Intégrations">
              <BusinessRow
                title="Stripe"
                description="Encaissement et vérification des paiements"
                accessory={<Badge tone="success">Prêt</Badge>}
              />
              <BusinessRow
                title="Email"
                description="Notifications et rappels"
                accessory={<Badge tone="success">Actif</Badge>}
              />
            </BusinessList>
          </WorkspacePanel>
          <WorkspacePanel
            title="Sécurité"
            description="Connexion, accès et validations sensibles."
          >
            <Button variant="secondary">Vérifier les accès</Button>
          </WorkspacePanel>
        </SettingsStack>
      ) : null}

      {page === "protections" && state === "list" ? (
        <WorkspaceSection
          title="Toutes les protections"
          description="Les dossiers actifs, incomplets ou à vérifier."
        >
          <BusinessList ariaLabel="Protections">
            {PAYMENTS.map((item, index) => (
              <BusinessRow
                key={item.title}
                title={`Protection ${item.client}`}
                description={`${item.title} · échéance ${item.due}`}
                accessory={
                  <>
                    <Badge tone={index === 0 ? "success" : item.tone}>
                      {index === 0 ? "Active" : item.status}
                    </Badge>
                    <RowAmount>{item.amount}</RowAmount>
                  </>
                }
              />
            ))}
          </BusinessList>
        </WorkspaceSection>
      ) : null}
    </AppShell>
  );
}
