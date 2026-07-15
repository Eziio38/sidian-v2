import Link from "next/link";

import { AuthPage } from "@/components/auth/auth-page";
import { AUTH_MESSAGES } from "@/lib/auth/messages";

export default function VerifierEmailPage() {
  return (
    <AuthPage
      title="Confirmez votre email"
      description={AUTH_MESSAGES.emailConfirmationRequired}
      footer={
        <p>
          Email confirmé ?{" "}
          <Link
            href="/connexion"
            className="font-medium text-sidian-blue hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
          >
            Se connecter
          </Link>
        </p>
      }
    >
      <div className="space-y-4 text-sm leading-relaxed text-gris-500">
        <p>
          Nous vous avons envoyé un lien de confirmation. Ouvrez-le depuis la
          même boîte mail que celle utilisée à l&apos;inscription.
        </p>
        <p>
          Tant que votre adresse n&apos;est pas confirmée, votre espace
          prestataire n&apos;est pas activé.
        </p>
      </div>
    </AuthPage>
  );
}
