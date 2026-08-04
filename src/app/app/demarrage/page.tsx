import Link from "next/link";

import { AppShell } from "@/components/app/app-shell";
import {
  DisabledHint,
  MissingConfigBanner,
  StatusBanner,
} from "@/components/feedback";
import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { requireConfirmedUser } from "@/lib/auth/session";
import { listActiveClientPayeurs } from "@/lib/clients/client-payeur";
import { listActiveCreances } from "@/lib/creances/creance";
import {
  buildOnboardingSteps,
  getOnboardingCompletion,
} from "@/lib/onboarding/progress";
import { getCurrentPrestataireProfile } from "@/lib/profile/profile";
import { getPrestataireStripeReadiness } from "@/lib/stripe/connect/readiness";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceConfigStatus } from "@/lib/ux/config-status";
import { UX_COPY } from "@/lib/ux/microcopy";

export default async function DemarragePage() {
  const user = await requireConfirmedUser();
  const supabase = await createClient();
  const prestataire = await ensurePrestataireForUser(supabase, user);

  const [profile, clients, payments, stripe, configStatus] = await Promise.all([
    getCurrentPrestataireProfile(supabase),
    listActiveClientPayeurs(supabase),
    listActiveCreances(supabase),
    getPrestataireStripeReadiness(supabase, prestataire.id),
    getWorkspaceConfigStatus(supabase, prestataire.id),
  ]);

  const steps = buildOnboardingSteps({
    profileConfigured: Boolean(profile.onboarding_profile_completed_at),
    hasClient: clients.length > 0,
    hasPaymentReceivable: payments.length > 0,
    stripeReady:
      stripe.configured &&
      stripe.chargesEnabled &&
      stripe.onboardingStatus === "paiements_actives" &&
      stripe.sepaDebitPaymentsStatus === "active",
  });
  const completion = getOnboardingCompletion(steps);
  const paymentCreated = steps.find((step) => step.id === "payment")?.completed;
  const stripeReady = steps.find((step) => step.id === "stripe")?.completed;
  const stripeChannel = configStatus.channels.find((c) => c.kind === "stripe");
  const autoDebitChannel = configStatus.channels.find(
    (c) => c.kind === "auto_debit_ceiling",
  );

  return (
    <AppShell
      title="Bien démarrer"
      description={UX_COPY.onboardingProgress.description}
      userDisplayName={prestataire.nom}
      userEmail={prestataire.email}
    >
      <div className="max-w-4xl space-y-6">
        <section
          className="rounded-xl border border-gris-200 bg-surface p-5 sm:p-6"
          aria-labelledby="onboarding-progress-title"
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="onboarding-progress-title" className="font-semibold text-nuit">
                {UX_COPY.onboardingProgress.title}
              </h2>
              <p className="mt-1 text-sm text-gris-500">
                {completion.completed} étape{completion.completed > 1 ? "s" : ""} sur{" "}
                {completion.total}
              </p>
            </div>
            <p className="text-sm font-semibold tabular-nums text-nuit">
              {completion.percentage} %
            </p>
          </div>
          <div
            className="mt-4 h-2 overflow-hidden rounded-full bg-gris-100"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={completion.percentage}
            aria-label="Progression de la configuration"
          >
            <div
              className="h-full rounded-full bg-sidian-blue transition-[width] duration-200 motion-reduce:transition-none"
              style={{ width: `${completion.percentage}%` }}
            />
          </div>
        </section>

        {paymentCreated && !stripeReady && stripeChannel ? (
          <MissingConfigBanner channel={stripeChannel} />
        ) : null}

        {paymentCreated && stripeReady ? (
          <StatusBanner
            tone="success"
            badge="Prêt"
            title="Ton premier paiement est prêt"
            description="L’encaissement est finalisé. Tu peux partager le lien quand tu veux."
          />
        ) : null}

        {autoDebitChannel && autoDebitChannel.state !== "ready" ? (
          <MissingConfigBanner channel={autoDebitChannel} />
        ) : null}

        <ol className="divide-y divide-gris-100 overflow-hidden rounded-xl border border-gris-200 bg-surface">
          {steps.map((step, index) => (
            <li key={step.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  step.completed
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-gris-100 text-nuit"
                }`}
                aria-hidden="true"
              >
                {step.completed ? "✓" : index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-nuit">{step.title}</h3>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gris-500">
                  {step.description}
                </p>
              </div>
              {step.available ? (
                <Link
                  href={step.href}
                  className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-gris-200 px-4 text-sm font-medium text-nuit transition-colors hover:border-sidian-blue hover:text-sidian-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
                >
                  {step.actionLabel}
                </Link>
              ) : (
                <DisabledHint className="max-w-[14rem] sm:text-right" />
              )}
            </li>
          ))}
        </ol>
      </div>
    </AppShell>
  );
}
