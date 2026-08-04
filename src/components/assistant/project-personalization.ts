import {
  BriefcaseBusiness,
  Building2,
  FileText,
  Folder,
  ReceiptText,
  ShieldCheck,
  Star,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export type ProjectIconId =
  | "folder"
  | "briefcase"
  | "user"
  | "building"
  | "document"
  | "invoice"
  | "star"
  | "shield";

export type ProjectColorId =
  | "sidian"
  | "violet"
  | "green"
  | "amber"
  | "orange"
  | "coral";

export type ProjectPersonalization = {
  icon: ProjectIconId;
  color: ProjectColorId;
};

export type ProjectCreationDraft = ProjectPersonalization & {
  name: string;
};

export const DEFAULT_PROJECT_PERSONALIZATION: ProjectPersonalization = {
  icon: "folder",
  color: "sidian",
};

export const PROJECT_ICON_OPTIONS: ReadonlyArray<{
  id: ProjectIconId;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "folder", label: "Dossier", icon: Folder },
  { id: "briefcase", label: "Mallette", icon: BriefcaseBusiness },
  { id: "user", label: "Client", icon: UserRound },
  { id: "building", label: "Entreprise", icon: Building2 },
  { id: "document", label: "Document", icon: FileText },
  { id: "invoice", label: "Facture", icon: ReceiptText },
  { id: "star", label: "Favori", icon: Star },
  { id: "shield", label: "Protection", icon: ShieldCheck },
];

export const PROJECT_COLORS: ReadonlyArray<{
  id: ProjectColorId;
  label: string;
  value: string;
}> = [
  { id: "sidian", label: "Bleu Sidian", value: "#4f76e8" },
  { id: "violet", label: "Violet", value: "#8875c4" },
  { id: "green", label: "Vert", value: "#60977f" },
  { id: "amber", label: "Ambre", value: "#bd9652" },
  { id: "orange", label: "Orange", value: "#c77b55" },
  { id: "coral", label: "Rouge corail", value: "#cc706d" },
];

export const PROJECT_ICON_BY_ID = Object.fromEntries(
  PROJECT_ICON_OPTIONS.map((option) => [option.id, option.icon]),
) as Record<ProjectIconId, LucideIcon>;

export const PROJECT_COLOR_BY_ID = Object.fromEntries(
  PROJECT_COLORS.map((option) => [option.id, option.value]),
) as Record<ProjectColorId, string>;
