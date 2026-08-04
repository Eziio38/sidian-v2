import { updateNotificationPreferencesAction } from "@/app/actions/notifications";
import { configureProfileAction } from "@/app/actions/profile";
import { AppShell } from "@/components/app/app-shell";
import { ProfileForm } from "@/components/app/profile-form";
import {
  AccountPrivacy,
  NotificationPreferencesForm,
  SettingsBlock,
  SettingsNote,
  SubscriptionSummary,
} from "@/components/app/settings";
import {
  SettingsStack,
  WorkspacePanel,
} from "@/components/app/workspace-blocks";
import { ConfigStatusList } from "@/components/feedback";
import { AppearanceControl } from "@/components/theme/appearance-control";
import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { requireConfirmedUser } from "@/lib/auth/session";
import { getNotificationPreferences } from "@/lib/notification-preferences/server";
import { getCurrentPrestataireProfile } from "@/lib/profile/profile";
import { loadSubscriptionForPrestataire } from "@/lib/subscription/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceConfigStatus } from "@/lib/ux/config-status";
import { UX_COPY } from "@/lib/ux/microcopy";

/**
 * Dates formatées côté serveur : le client n'en reformate aucune, donc aucun
 * écart d'hydratation entre le fuseau du serveur et celui du navigateur.
 */
const LONG_DATE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return LONG_DATE.format(parsed);
}

export default async function ParametresPage() {
  const user = await requireConfirmedUser();
  const supabase = await createClient();
  const prestataire = await ensurePrestataireForUser(supabase, user);

  const [profile, configStatus, notifications, subscription, billing] =
    await Promise.all([
      getCurrentPrestataireProfile(supabase),
      getWorkspaceConfigStatus(supabase, prestataire.id),
      getNotificationPreferences(supabase),
      loadSubscriptionForPrestataire(supabase, user.id),
      // Colonnes tarifaires réelles de `prestataire`, lues sous RLS : aucun
      // identifiant n'est passé à la requête, la session suffit.
      supabase
        .from("prestataire")
        .select(
          "pricing_version, subscription_started_at, early_access_price_locked_until",
        )
        .maybeSingle(),
    ]);

  const entitlements = subscription?.entitlements ?? null;
  const whatsapp = configStatus.channels.find(
    (channel) => channel.kind === "whatsapp",
  );

  return (
    <AppShell
      title="Paramètres"
      description="Les infos essentielles de ton activité, et l’état réel de tes canaux."
      userDisplayName={prestataire.nom}
      userEmail={prestataire.email}
    >
      <SettingsStack>
        <WorkspacePanel
          title="Profil de l’activité"
          description="Le nom ci-dessous est celui que tes clients verront. Ton email de connexion reste géré par ton compte Sidian."
        >
          <ProfileForm
            action={configureProfileAction}
            initial={{
              nom: profile.nom,
              profilAgent: profile.profil_agent_defaut,
            }}
          />
        </WorkspacePanel>

        {/*
          Deux interrupteurs seulement : le runtime n'émet que deux emails
          (src/lib/notification-preferences/catalogue.ts en tient le décompte,
          et un test le verrouille). WhatsApp n'a pas d'interrupteur — son
          activation dépend de la plateforme, on affiche donc son état réel.
        */}
        <WorkspacePanel
          title="Notifications"
          description="Les emails automatiques partent à tes clients : Sidian ne t’envoie aujourd’hui aucune notification par email."
        >
          <SettingsBlock>
            <NotificationPreferencesForm
              action={updateNotificationPreferencesAction}
              initial={notifications}
            />
            <SettingsNote>
              Ton choix est enregistré sur ton compte et tracé dans le journal
              d’audit. L’envoi automatique ne le consulte pas encore : tant que
              ce branchement n’est pas fait, les deux emails ci-dessus suivent
              le calendrier standard.
            </SettingsNote>
            {whatsapp ? (
              <SettingsNote>
                WhatsApp — {whatsapp.label} : {whatsapp.title}. Ce canal est
                activé par l’équipe Sidian ; il ne se règle pas depuis cet
                écran, d’où l’absence d’interrupteur.
              </SettingsNote>
            ) : null}
          </SettingsBlock>
        </WorkspacePanel>

        <WorkspacePanel
          title="Abonnement"
          description="L’état ci-dessous vient de ton compte et de Stripe. Aucun nom d’offre ni prix n’est affiché : le dépôt n’en enregistre aucun."
        >
          <SubscriptionSummary
            state={entitlements?.state ?? "billing_unavailable"}
            billingConfigured={entitlements?.billingConfigured ?? false}
            canStartSubscription={
              entitlements?.capabilities.billing_start_subscription ?? false
            }
            canManageSubscription={
              entitlements?.capabilities.billing_manage_subscription ?? false
            }
            currentPeriodEndLabel={formatDate(
              entitlements?.binding?.currentPeriodEnd,
            )}
            cancelAtPeriodEnd={entitlements?.binding?.cancelAtPeriodEnd ?? false}
            pricingVersion={billing.data?.pricing_version ?? "Non renseignée"}
            subscriptionStartedAtLabel={formatDate(
              billing.data?.subscription_started_at,
            )}
            earlyAccessLockedUntilLabel={formatDate(
              billing.data?.early_access_price_locked_until,
            )}
          />
        </WorkspacePanel>

        {/*
          Canaux : projection en lecture seule de `getWorkspaceConfigStatus`.
          Email et WhatsApp dépendent de l'environnement plateforme ; seul
          Stripe Connect se poursuit depuis l'application.
        */}
        <ConfigStatusList
          channels={configStatus.channels}
          title={UX_COPY.settingsChannels.title}
          description={`${UX_COPY.settingsChannels.description} Les canaux activés par l’équipe Sidian restent en lecture seule ici.`}
        />

        <WorkspacePanel
          title="Apparence"
          description="Le thème clair est la référence de Sidian. Ton choix est enregistré sur ton compte et te suit sur tes autres appareils."
        >
          <AppearanceControl />
        </WorkspacePanel>

        <WorkspacePanel
          title="Compte et confidentialité"
          description="Ton adresse vient de ton compte connecté ; elle n’est jamais remplacée depuis un formulaire métier."
        >
          <AccountPrivacy accountEmail={profile.email} />
        </WorkspacePanel>
      </SettingsStack>
    </AppShell>
  );
}
