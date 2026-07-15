import "server-only";

import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function getAuthenticatedUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}

export async function requireAuthenticatedUser(): Promise<User> {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/connexion");
  }

  return user;
}

export async function requireConfirmedUser(): Promise<User> {
  const user = await requireAuthenticatedUser();

  if (!user.email_confirmed_at) {
    redirect("/inscription/verifier-email");
  }

  return user;
}

export async function redirectIfAuthenticated(destination = "/app"): Promise<void> {
  const user = await getAuthenticatedUser();

  if (user) {
    redirect(destination);
  }
}
