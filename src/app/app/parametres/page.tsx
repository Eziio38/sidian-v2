import { configureProfileAction } from "@/app/actions/profile";
import { AppShell } from "@/components/app/app-shell";
import { ProfileForm } from "@/components/app/profile-form";
import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { requireConfirmedUser } from "@/lib/auth/session";
import { getCurrentPrestataireProfile } from "@/lib/profile/profile";
import { createClient } from "@/lib/supabase/server";

export default async function ParametresPage() {
  const user = await requireConfirmedUser();
  const supabase = await createClient();
  await ensurePrestataireForUser(supabase, user);
  const profile = await getCurrentPrestataireProfile(supabase);

  return (
    <AppShell
      title="Paramètres"
      description="Les informations essentielles de votre activité et le cadre de travail de l’agent."
    >
      <div className="max-w-3xl space-y-8">
        <section className="rounded-xl border border-gris-200 bg-white p-5 sm:p-6">
          <div className="mb-6 max-w-2xl">
            <h2 className="text-lg font-semibold text-nuit">Profil de l’activité</h2>
            <p className="mt-1 text-sm leading-relaxed text-gris-500">
              Votre email de connexion reste géré par votre compte Sidian. Le nom
              ci-dessous est celui que vos clients verront.
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

        <section className="border-t border-gris-200 pt-6">
          <h2 className="text-sm font-semibold text-nuit">Adresse du compte</h2>
          <p className="mt-2 text-sm text-gris-500">{profile.email}</p>
          <p className="mt-1 text-xs leading-relaxed text-gris-500">
            Cette adresse provient de votre compte authentifié et n’est jamais
            remplacée depuis un formulaire métier.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
