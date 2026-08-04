import { redirect } from "next/navigation";

import { requireConfirmedUser } from "@/lib/auth/session";

export default async function StripeConnectRefreshPage() {
  await requireConfirmedUser();
  redirect("/app/connexion-stripe?source=reprise");
}
