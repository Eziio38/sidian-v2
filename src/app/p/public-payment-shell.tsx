export function PublicPaymentShell({
  children,
  centred = false,
}: Readonly<{
  children: React.ReactNode;
  centred?: boolean;
}>) {
  return (
    <main className="min-h-dvh bg-gris-50 px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-lg items-center sm:min-h-[calc(100dvh-6rem)]">
        <section
          className={`w-full rounded-2xl border border-gris-200 bg-white p-6 sm:p-8 ${centred ? "text-center" : ""}`}
        >
          <div
            className={`mb-7 flex items-center gap-2 ${centred ? "justify-center" : ""}`}
            aria-label="Sidian"
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-full bg-sidian-blue"
            />
            <span className="text-sm font-semibold tracking-tight text-nuit">
              Sidian
            </span>
          </div>
          {children}
          <p className="mt-8 border-t border-gris-100 pt-5 text-xs leading-relaxed text-gris-500">
            Le règlement est traité sur l’écran sécurisé de Stripe. Sidian ne
            reçoit jamais vos données de carte ou d’IBAN.
          </p>
        </section>
      </div>
    </main>
  );
}
