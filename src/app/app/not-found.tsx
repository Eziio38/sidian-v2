import { EmptyState } from "@/components/feedback";

/**
 * 404 de l'espace authentifié.
 *
 * Sans ce fichier, `notFound()` — appelé notamment quand une créance a été
 * supprimée ou n'appartient pas au compte — rendait la page 404 par défaut de
 * Next, en anglais et hors de la coquille produit.
 *
 * Le message ne distingue pas « supprimé » de « n'appartient pas à ce compte » :
 * révéler l'existence d'une ressource d'un autre prestataire serait une fuite.
 */
export default function AppNotFound() {
  return (
    // La 404 est rendue hors AppShell : sans <main> ici, la page n'a aucun
    // landmark principal.
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <EmptyState
        title="Cette page n’existe plus"
        description="Le dossier que tu cherches a peut-être été supprimé, ou le lien n’est plus valide. Tes autres dossiers sont intacts."
        action={{ label: "Revenir à l’accueil", href: "/app/assistant" }}
      />
    </main>
  );
}
