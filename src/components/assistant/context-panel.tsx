"use client";

/**
 * Compatibilité G1-O : ContextPanel délègue au ProtectionPanel finalisé.
 */

import { ProtectionPanel } from "./protection-panel";
import type { ProtectionPanelData, ProtectionPanelMode } from "./protection-panel";

type ContextPanelProps = {
  open: boolean;
  protection: ProtectionPanelData;
  onClose: () => void;
  onPrimaryAction?: () => void;
  onSecondaryAction?: () => void;
  mode?: ProtectionPanelMode;
  busy?: boolean;
  actionError?: string | null;
};

export function ContextPanel(props: ContextPanelProps) {
  return <ProtectionPanel {...props} />;
}
