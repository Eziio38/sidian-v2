"use client";

import { useFormStatus } from "react-dom";

type AuthSubmitButtonProps = {
  children: string;
  pendingLabel?: string;
};

export function AuthSubmitButton({
  children,
  pendingLabel = "Traitement en cours…",
}: AuthSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center rounded-lg bg-sidian-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#315fd9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
