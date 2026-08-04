"use client";

import { LogOut } from "lucide-react";

import { signOutAction } from "@/app/actions/auth";
import { AuthSubmitButton } from "@/components/auth/auth-submit-button";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <AuthSubmitButton icon={LogOut} pendingLabel="Déconnexion…">
        Se déconnecter
      </AuthSubmitButton>
    </form>
  );
}
