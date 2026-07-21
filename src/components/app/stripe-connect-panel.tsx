"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { StripeConnectActionState } from "@/app/app/connexion-stripe/actions";
import type {
  StripeCapabilityView,
  StripeConnectAccountView,
} from "@/lib/stripe/connect/account-view";

type StripeConnectAction = (
  previousState: StripeConnectActionState | undefined,
  formData: FormData,
) => Promise<StripeConnectActionState>;

type ReturnContext = "returned" | "expired" | null;
type ActivationContext = "ready" | "missing_receivable" | "unavailable";

type StatusPresentation = {
  badge: string;
  badgeClassName: string;
  title: string;
  description: string;
  primaryLabel: string | null;
};

function statusPresentation(
  view: StripeConnectAccountView | null,
  activationContext: ActivationContext,
): StatusPresentation {
  if (!view) {
    return {
      badge: "État indisponible",
      badgeClassName: "bg-red-50 text-red-700",
      title: "Impossible de vérifier Stripe maintenant",
      description:
        "Aucun état local n’est utilisé à la place de Stripe. Actualisez pour relancer la vérification en direct.",
      primaryLabel: null,
    };
  }

  if (!view.configured) {
    if (activationContext === "missing_receivable") {
      return {
        badge: "À préparer",
        badgeClassName: "bg-gris-100 text-gris-500",
        title: "Créez d’abord un paiement à recevoir",
        description:
          "Stripe intervient au moment utile : juste avant de rendre votre premier lien de paiement partageable.",
        primaryLabel: null,
      };
    }

    if (activationContext === "unavailable") {
      return {
        badge: "Contexte indisponible",
        badgeClassName: "bg-red-50 text-red-700",
        title: "Impossible de vérifier l’étape précédente",
        description:
          "Sidian ne créera aucun compte Stripe tant que le contexte produit n’aura pas été vérifié côté serveur.",
        primaryLabel: null,
      };
    }

    return {
      badge: "Stripe non commencé",
      badgeClassName: "bg-gris-100 text-gris-500",
      title: "Sécurisez l’encaissement de vos paiements",
      description:
        "Sidian va créer ou retrouver votre compte Stripe Express, puis Stripe recueillera uniquement les informations nécessaires maintenant.",
      primaryLabel: "Finaliser avec Stripe",
    };
  }

  if (view.canOpenOnboarding) {
    const actionRequired =
      view.pastDueCount > 0 || view.onboardingStatus === "action_requise";
    return {
      badge: actionRequired ? "Action requise" : "Informations requises",
      badgeClassName: "bg-amber-50 text-amber-700",
      title: actionRequired
        ? "Stripe attend une action de votre part"
        : "La configuration Stripe reste à compléter",
      description:
        "Continuez sur l’écran sécurisé de Stripe. Sidian ne collecte ni pièce d’identité ni coordonnées bancaires.",
      primaryLabel: actionRequired
        ? "Résoudre sur Stripe"
        : "Continuer sur Stripe",
    };
  }

  if (view.requiredRailsActive) {
    return {
      badge: "Encaissement prêt",
      badgeClassName: "bg-emerald-50 text-emerald-700",
      title: "Votre compte Stripe est prêt",
      description:
        "La carte et le prélèvement SEPA sont actifs. Sidian les revérifiera auprès de Stripe avant chaque règlement.",
      primaryLabel: null,
    };
  }

  if (
    view.pendingVerificationCount > 0 ||
    view.onboardingStatus === "verification_en_cours"
  ) {
    return {
      badge: "Vérification en cours",
      badgeClassName: "bg-gris-100 text-gris-500",
      title: "Stripe vérifie vos informations",
      description:
        "Aucune nouvelle saisie n’est demandée pour le moment. Cette étape peut évoluer lorsque Stripe termine ses contrôles.",
      primaryLabel: null,
    };
  }

  return {
    badge: "Activation partielle",
    badgeClassName: "bg-amber-50 text-amber-700",
    title: "Tous les moyens de paiement ne sont pas encore actifs",
    description:
      "Stripe ne demande actuellement aucune information supplémentaire. Actualisez plus tard si une capacité reste en attente.",
    primaryLabel: null,
  };
}

function capabilityLabel(status: StripeCapabilityView): string {
  if (status === "active") return "Actif";
  if (status === "pending") return "En vérification";
  return "Non actif";
}

function capabilityClassName(status: StripeCapabilityView): string {
  if (status === "active") return "text-emerald-700";
  if (status === "pending") return "text-amber-700";
  return "text-gris-500";
}

function BooleanStatus({ active }: { active: boolean }) {
  return (
    <span
      className={active ? "font-medium text-emerald-700" : "text-gris-500"}
    >
      {active ? "Actif" : "Non actif"}
    </span>
  );
}

function ActionFeedback({ state }: { state?: StripeConnectActionState }) {
  if (!state) return null;

  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={
        state.status === "error"
          ? "text-sm text-red-700"
          : "text-sm text-emerald-700"
      }
    >
      {state.message}
    </p>
  );
}

export function StripeConnectPanel({
  view,
  activationContext,
  returnContext,
  beginAction,
  refreshAction,
}: {
  view: StripeConnectAccountView | null;
  activationContext: ActivationContext;
  returnContext: ReturnContext;
  beginAction: StripeConnectAction;
  refreshAction: StripeConnectAction;
}) {
  const presentation = statusPresentation(view, activationContext);
  const [beginState, submitBegin, beginPending] = useActionState(
    beginAction,
    undefined,
  );
  const [refreshState, submitRefresh, refreshPending] = useActionState(
    refreshAction,
    undefined,
  );

  return (
    <section
      aria-labelledby="stripe-connect-title"
      className="overflow-hidden rounded-xl border border-gris-200 bg-white"
    >
      <div className="p-5 sm:p-6">
        {returnContext === "expired" ? (
          <p
            role="status"
            className="mb-5 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700"
          >
            Le lien Stripe a expiré ou a déjà été utilisé. Relancez l’étape pour
            obtenir un accès neuf et sécurisé.
          </p>
        ) : null}
        {returnContext === "returned" && view ? (
          <p
            role="status"
            className="mb-5 rounded-lg bg-gris-100 px-4 py-3 text-sm text-gris-500"
          >
            Vérification Stripe effectuée. Seules les capacités affichées
            ci-dessous déterminent si l’encaissement est prêt.
          </p>
        ) : null}
        {returnContext === "returned" && !view ? (
          <p
            role="status"
            className="mb-5 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700"
          >
            Retour de Stripe reçu, mais la vérification en direct n’a pas abouti.
            Actualisez l’état avant de considérer l’étape comme terminée.
          </p>
        ) : null}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${presentation.badgeClassName}`}
            >
              {presentation.badge}
            </span>
            <h2
              id="stripe-connect-title"
              className="mt-3 text-xl font-semibold tracking-tight text-nuit"
            >
              {presentation.title}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gris-500">
              {presentation.description}
            </p>
          </div>
          {view?.configured ? (
            <p className="shrink-0 text-xs font-medium text-gris-500">
              Vérifié en direct auprès de Stripe
            </p>
          ) : null}
        </div>

        {view?.configured ? (
          <dl className="mt-6 divide-y divide-gris-100 border-y border-gris-100 text-sm">
            <div className="flex min-h-12 items-center justify-between gap-4 py-3">
              <dt className="text-gris-500">Encaissement</dt>
              <dd>
                <BooleanStatus active={view.chargesEnabled} />
              </dd>
            </div>
            <div className="flex min-h-12 items-center justify-between gap-4 py-3">
              <dt className="text-gris-500">Carte bancaire</dt>
              <dd
                className={`font-medium ${capabilityClassName(view.cardPaymentsStatus)}`}
              >
                {capabilityLabel(view.cardPaymentsStatus)}
              </dd>
            </div>
            <div className="flex min-h-12 items-center justify-between gap-4 py-3">
              <dt className="text-gris-500">Prélèvement SEPA</dt>
              <dd
                className={`font-medium ${capabilityClassName(view.sepaDebitPaymentsStatus)}`}
              >
                {capabilityLabel(view.sepaDebitPaymentsStatus)}
              </dd>
            </div>
            <div className="flex min-h-12 items-center justify-between gap-4 py-3">
              <dt className="text-gris-500">Versements vers votre banque</dt>
              <dd>
                <BooleanStatus active={view.payoutsEnabled} />
              </dd>
            </div>
          </dl>
        ) : null}

        {view &&
        (view.currentlyDueCount > 0 ||
          view.pendingVerificationCount > 0 ||
          view.pastDueCount > 0) ? (
          <div className="mt-5 text-sm text-gris-500">
            <p className="font-medium text-nuit">Suivi des vérifications</p>
            <ul className="mt-2 space-y-1.5">
              {view.currentlyDueCount > 0 ? (
                <li>
                  {view.currentlyDueCount} information
                  {view.currentlyDueCount > 1 ? "s" : ""} demandée
                  {view.currentlyDueCount > 1 ? "s" : ""} maintenant
                </li>
              ) : null}
              {view.pendingVerificationCount > 0 ? (
                <li>
                  {view.pendingVerificationCount} élément
                  {view.pendingVerificationCount > 1 ? "s" : ""} en cours de
                  vérification
                </li>
              ) : null}
              {view.pastDueCount > 0 ? (
                <li className="text-amber-700">
                  {view.pastDueCount} élément
                  {view.pastDueCount > 1 ? "s" : ""} à régulariser
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}

        <div className="mt-6 flex flex-col gap-3 border-t border-gris-100 pt-5 sm:flex-row sm:items-center">
          {view &&
          !view.configured &&
          activationContext === "missing_receivable" ? (
            <Link
              href="/app/paiements-a-recevoir"
              className="inline-flex min-h-11 items-center rounded-lg bg-sidian-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
            >
              Créer un paiement à recevoir
            </Link>
          ) : null}
          {presentation.primaryLabel ? (
            <form action={submitBegin}>
              <button
                type="submit"
                disabled={beginPending || refreshPending}
                className="min-h-11 rounded-lg bg-sidian-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue disabled:cursor-not-allowed disabled:opacity-60"
              >
                {beginPending
                  ? "Ouverture de Stripe…"
                  : presentation.primaryLabel}
              </button>
            </form>
          ) : null}
          <form action={submitRefresh}>
            <button
              type="submit"
              disabled={beginPending || refreshPending}
              className="min-h-11 rounded-lg border border-gris-200 bg-white px-4 py-2.5 text-sm font-semibold text-nuit transition-colors hover:bg-gris-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshPending ? "Vérification…" : "Actualiser l’état"}
            </button>
          </form>
        </div>

        <div aria-live="polite" className="mt-3 space-y-2">
          <ActionFeedback state={beginState} />
          <ActionFeedback state={refreshState} />
        </div>
      </div>

      <div className="border-t border-gris-100 bg-gris-50 px-5 py-4 text-sm leading-6 text-gris-500 sm:px-6">
        <p>
          Stripe héberge les étapes d’identité et de compte bancaire. Sidian ne
          reçoit que leur état et des références techniques : jamais vos données
          de carte ou votre IBAN brut.
        </p>
      </div>
    </section>
  );
}
