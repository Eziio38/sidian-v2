import { redirect } from "next/navigation";

import { AuthPage } from "@/components/auth/auth-page";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { getAuthenticatedUser } from "@/lib/auth/session";

export default async function ReinitialiserMotDePassePage() {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/connexion?erreur=session");
  }

  return (
    <AuthPage
      title="Nouveau mot de passe"
      description="Choisissez un mot de passe robuste pour sécuriser votre compte Sidian."
    >
      <ResetPasswordForm />
    </AuthPage>
  );
}
