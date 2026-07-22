import { PublicPaymentShell } from "../public-payment-shell";
import { ResumePaymentLink } from "./resume-payment-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lecture pure : cet écran ne déduit aucun état financier de la redirection. */
export default function CheckoutCancelPage() {
  return (
    <PublicPaymentShell centred>
      <h1 className="text-xl font-semibold tracking-[-0.02em] text-nuit">
        Parcours de paiement quitté
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-gris-500">
        Cette page ne modifie aucun paiement et ne confirme aucun débit. L’état
        réel sera revérifié côté serveur lorsque vous reprendrez.
      </p>
      <ResumePaymentLink />
    </PublicPaymentShell>
  );
}
