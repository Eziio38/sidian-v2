import { AuthPage } from "@/components/auth/auth-page";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { redirectIfAuthenticated } from "@/lib/auth/session";

export default async function MotDePasseOubliePage() {
  await redirectIfAuthenticated();

  return (
    <AuthPage
      title="Mot de passe oublié"
      description="Saisissez l'email de votre compte. Nous vous enverrons un lien pour choisir un nouveau mot de passe."
    >
      <ForgotPasswordForm />
    </AuthPage>
  );
}
