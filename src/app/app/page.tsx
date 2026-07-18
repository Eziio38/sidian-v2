import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { requireConfirmedUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app/app-shell";
import Link from "next/link";

export default async function AppPage() {
  const user = await requireConfirmedUser();
  const supabase = await createClient();
  const prestataire = await ensurePrestataireForUser(supabase, user);
  const displayName =
    typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name
      : user.email;

  return (
    <AppShell
      title={`Bonjour ${displayName}`}
      description={`${prestataire.nom} — gérez vos clients et paiements à recevoir.`}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/app/clients"
          className="rounded-xl border border-gris-200 bg-white p-5 transition-colors hover:border-sidian-blue"
        >
          <h2 className="text-lg font-semibold text-nuit">Clients</h2>
          <p className="mt-2 text-sm text-gris-500">
            Créer et mettre à jour les clients payeurs.
          </p>
        </Link>
        <Link
          href="/app/paiements-a-recevoir"
          className="rounded-xl border border-gris-200 bg-white p-5 transition-colors hover:border-sidian-blue"
        >
          <h2 className="text-lg font-semibold text-nuit">
            Paiements à recevoir
          </h2>
          <p className="mt-2 text-sm text-gris-500">
            Créer des brouillons et suivre vos paiements à recevoir.
          </p>
        </Link>
      </div>
    </AppShell>
  );
}
