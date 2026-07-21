import { redirect } from "next/navigation";

import { requireConfirmedUser } from "@/lib/auth/session";

export default async function StripeConnectReturnPage() {
  await requireConfirmedUser();
  redirect("/app/connexion-stripe?source=retour");
}
