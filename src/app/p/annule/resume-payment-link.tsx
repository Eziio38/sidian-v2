"use client";

import { useSyncExternalStore } from "react";

import { PUBLIC_PAYMENT_RESUME_STORAGE_KEY } from "../[token]/pay-button";

const RESUME_PATH_RE = /^\/p\/[A-Za-z0-9_-]{43}$/;

export function safePublicPaymentResumePath(value: string | null): string | null {
  return value && RESUME_PATH_RE.test(value) ? value : null;
}

function subscribeToResumePath(): () => void {
  return () => undefined;
}

function readResumePath(): string | null {
  try {
    return safePublicPaymentResumePath(
      sessionStorage.getItem(PUBLIC_PAYMENT_RESUME_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

export function ResumePaymentLink() {
  const resumePath = useSyncExternalStore(
    subscribeToResumePath,
    readResumePath,
    () => null,
  );

  if (!resumePath) {
    return (
      <p className="mt-5 text-sm leading-relaxed text-gris-500">
        Pour reprendre, ouvrez à nouveau le lien de paiement qui vous a été
        envoyé.
      </p>
    );
  }

  return (
    <a
      href={resumePath}
      onClick={() => {
        try {
          sessionStorage.removeItem(PUBLIC_PAYMENT_RESUME_STORAGE_KEY);
        } catch {
          // La navigation reste possible sans accès au stockage du navigateur.
        }
      }}
      className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-sidian-blue px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
    >
      Reprendre le paiement
    </a>
  );
}
