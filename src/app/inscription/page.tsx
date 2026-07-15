import Link from "next/link";

import { AuthPage } from "@/components/auth/auth-page";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { redirectIfAuthenticated } from "@/lib/auth/session";

export default async function InscriptionPage() {
  await redirectIfAuthenticated();

  return (
    <AuthPage
      title="Créer un compte"
      description="Rejoignez Sidian Early Access et déléguez le suivi des règlements de votre agence."
      footer={
        <p>
          Déjà inscrit ?{" "}
          <Link
            href="/connexion"
            className="font-medium text-sidian-blue hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
          >
            Se connecter
          </Link>
        </p>
      }
    >
      <SignUpForm />
    </AuthPage>
  );
}
