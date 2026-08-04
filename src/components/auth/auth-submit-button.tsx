"use client";

import type { LucideIcon } from "lucide-react";
import { useFormStatus } from "react-dom";

import { Button } from "@/design-system";

type AuthSubmitButtonProps = {
  children: string;
  icon?: LucideIcon;
  pendingLabel?: string;
};

export function AuthSubmitButton({
  children,
  icon,
  pendingLabel = "Traitement en cours…",
}: AuthSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      disabled={pending}
      icon={icon}
      loading={pending}
      loadingLabel={pendingLabel}
    >
      {children}
    </Button>
  );
}
