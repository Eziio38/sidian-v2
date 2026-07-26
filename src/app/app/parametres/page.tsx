import { configureProfileAction } from "@/app/actions/profile";
import { AppShell } from "@/components/app/app-shell";
import { ProfileForm } from "@/components/app/profile-form";
import { ConfigStatusList } from "@/components/feedback";
import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { requireConfirmedUser } from "@/lib/auth/session";
import { getCurrentPrestataireProfile } from "@/lib/profile/profile";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceConfigStatus } from "@/lib/ux/config-status";
import { UX_COPY } from "@/lib/ux/microcopy";

export default async function ParametresPage() {
  const user = await requireConfirmedUser();
  const supabase = await createClient();
  const prestataire = await ensurePrestataireForUser(supabase, user);
  const [profile, configStatus] = await Promise.all([
    getCurrentPrestataireProfile(supabase),
    getWorkspaceConfigStatus(supabase, prestataire.id),
  ]);

  return (
    <AppShell
      title="Paramètres"
      description="Les infos essentielles de ton activité, et l’état réel de tes canaux."
    >
      <div className="max-w-3xl space-y-8">
        <section className="rounded-xl border border-gris-200 bg-white p-5 sm:p-6">
          <div className="mb-6 max-w-2xl">
            <h2 className="text-lg font-semibold text-nuit">Profil de l’activité</h2>
            <p className="mt-1 text-sm leading-relaxed text-gris-500">
              Ton email de connexion reste géré par ton compte Sidian. Le nom
              ci-dessous est celui que tes clients verront.
            </p>
          </div>
          <ProfileForm
            action={configureProfileAction}
            initial={{
              nom: profile.nom,
              profilAgent: profile.profil_agent_defaut,
            }}
          />
        </section>

        <ConfigStatusList
          channels={configStatus.channels}
          title={UX_COPY.settingsChannels.title}
          description={UX_COPY.settingsChannels.description}
        />

        <section className="border-t border-gris-200 pt-6">
          <h2 className="text-sm font-semibold text-nuit">Adresse du compte</h2>
          <p className="mt-2 text-sm text-gris-500">{profile.email}</p>
          <p className="mt-1 text-xs leading-relaxed text-gris-500">
            Cette adresse vient de ton compte connecté. Elle n’est jamais
            remplacée depuis un formulaire métier.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
