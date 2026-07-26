export type ConfigProbeState =
  | "ready"
  | "missing"
  | "partial"
  | "unavailable"
  | "blocked";

export type ConfigChannelKind =
  | "email"
  | "whatsapp"
  | "stripe"
  | "auto_debit_ceiling";

export type ConfigChannelStatus = {
  kind: ConfigChannelKind;
  state: ConfigProbeState;
  label: string;
  title: string;
  description: string;
  href?: string;
  actionLabel?: string;
};

export type WorkspaceConfigStatus = {
  channels: ConfigChannelStatus[];
  /** True si un canal critique bloque un envoi / un prélèvement auto. */
  hasBlockingGap: boolean;
};
