import { redirect } from "next/navigation";

/** Home produit = Aujourd’hui (workspace IA). */
export default function AppIndexPage() {
  redirect("/app/assistant");
}
