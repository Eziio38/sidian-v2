import Link from "next/link";

import { AuthPage } from "@/components/auth/auth-page";
import { SignInForm } from "@/components/auth/sign-in-form";
import { AUTH_MESSAGES } from "@/lib/auth/messages";
import { redirectIfAuthenticated } from "@/lib/auth/session";

const ERROR_MESSAGES: Record<string, string> = {
  callback: AUTH_MESSAGES.genericAuthError,
  session: AUTH_MESSAGES.sessionExpired,
  onboarding: AUTH_MESSAGES.genericAuthError,
};

const SUCCESS_MESSAGES: Record<string, string> = {
  "mot-de-passe-mis-a-jour": AUTH_MESSAGES.passwordUpdated,
};

type PageProps = {
  searchParams: Promise<{
    erreur?: string;
    message?: string;
  }>;
};

export default async function ConnexionPage({ searchParams }: PageProps) {
  await redirectIfAuthenticated();
  const params = await searchParams;

  return (
    <AuthPage
      title="Connexion"
      description="Accédez à votre espace Sidian pour suivre les règlements de votre agence."
      footer={
        <p>
          Pas encore de compte ?{" "}
          <Link
            href="/inscription"
            className="font-medium text-sidian-blue hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
          >
            Créer un compte
          </Link>
        </p>
      }
    >
      <SignInForm
        error={params.erreur ? ERROR_MESSAGES[params.erreur] : undefined}
        message={params.message ? SUCCESS_MESSAGES[params.message] : undefined}
      />
    </AuthPage>
  );
}
