import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { requireConfirmedUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/auth/sign-out-button";

export default async function AppPage() {
  const user = await requireConfirmedUser();
  const supabase = await createClient();
  const prestataire = await ensurePrestataireForUser(supabase, user);
  const displayName =
    typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name
      : user.email;

  return (
    <div className="min-h-full bg-gris-50">
      <main className="mx-auto flex min-h-full max-w-3xl flex-col justify-center px-4 py-16 sm:px-6">
        <div className="rounded-2xl border border-gris-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-medium uppercase tracking-wide text-sidian-blue">
            Espace prestataire
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-nuit">
            Bonjour {displayName}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-gris-500">
            Votre compte est connecté et votre prestataire est prêt. Le tableau
            de bord métier arrive dans une prochaine phase.
          </p>

          <dl className="mt-8 grid gap-4 rounded-xl border border-gris-100 bg-gris-50 p-5 text-sm">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <dt className="text-gris-500">Prestataire</dt>
              <dd className="font-medium text-nuit">{prestataire.nom}</dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <dt className="text-gris-500">Email confirmé</dt>
              <dd className="font-medium text-nuit">{prestataire.email}</dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <dt className="text-gris-500">Identifiant utilisateur</dt>
              <dd className="font-mono text-xs text-gris-500">{user.id}</dd>
            </div>
          </dl>

          <div className="mt-8 max-w-xs">
            <SignOutButton />
          </div>
        </div>
      </main>
    </div>
  );
}
