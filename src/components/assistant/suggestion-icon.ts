import {
  CalendarDays,
  CircleDollarSign,
  FilePlus,
  FolderOpen,
  ReceiptText,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

export function resolveSuggestionIcon(
  action?: string,
  label?: string,
): LucideIcon {
  const value = `${action ?? ""} ${label ?? ""}`.toLocaleLowerCase("fr");

  if (value.includes("protection") || value.includes("panneau")) {
    return ShieldCheck;
  }
  if (
    value.includes("montant") ||
    value.includes("paiement") ||
    value.includes("payé")
  ) {
    return CircleDollarSign;
  }
  if (value.includes("échéance") || value.includes("date")) {
    return CalendarDays;
  }
  if (value.includes("client") || value.includes("contact")) {
    return value.includes("ajout") ||
      value.includes("cré") ||
      value.includes("saisir") ||
      value.includes("nom")
      ? UserPlus
      : Users;
  }
  if (value.includes("analys") || value.includes("document")) return FolderOpen;
  if (value.includes("facture")) return ReceiptText;
  if (value.includes("ajouter") || value.includes("créer")) return FilePlus;
  return Search;
}
