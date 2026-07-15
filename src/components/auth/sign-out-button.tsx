"use client";

import { signOutAction } from "@/app/actions/auth";
import { AuthSubmitButton } from "@/components/auth/auth-submit-button";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <AuthSubmitButton pendingLabel="Déconnexion…">
        Se déconnecter
      </AuthSubmitButton>
    </form>
  );
}
