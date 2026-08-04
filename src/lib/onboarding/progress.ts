export type OnboardingFacts = {
  profileConfigured: boolean;
  hasClient: boolean;
  hasPaymentReceivable: boolean;
  stripeReady: boolean;
};

export type OnboardingStep = {
  id: "profile" | "client" | "payment" | "stripe";
  title: string;
  description: string;
  href: string;
  actionLabel: string;
  completed: boolean;
  available: boolean;
};

export function buildOnboardingSteps(
  facts: OnboardingFacts,
): OnboardingStep[] {
  return [
    {
      id: "profile",
      title: "Présente ton activité",
      description:
        "Confirme le nom vu par tes clients et choisis le niveau d’accompagnement de l’agent.",
      href: "/app/parametres",
      actionLabel: facts.profileConfigured ? "Modifier le profil" : "Configurer le profil",
      completed: facts.profileConfigured,
      available: true,
    },
    {
      id: "client",
      title: "Ajoute ton premier client",
      description:
        "Un nom et un email suffisent pour préparer le suivi de son règlement.",
      href: "/app/clients",
      actionLabel: facts.hasClient ? "Voir les clients" : "Ajouter un client",
      completed: facts.hasClient,
      available: facts.profileConfigured,
    },
    {
      id: "payment",
      title: "Crée un paiement à recevoir",
      description:
        "Indique le montant en euros et l’échéance. Stripe n’est pas encore nécessaire.",
      href: "/app/paiements-a-recevoir",
      actionLabel: facts.hasPaymentReceivable
        ? "Voir les paiements"
        : "Créer le paiement",
      completed: facts.hasPaymentReceivable,
      available: facts.hasClient,
    },
    {
      id: "stripe",
      title: "Finalise l’encaissement avec Stripe",
      description:
        "Cette étape devient utile maintenant : Stripe vérifie ton activité avant que le lien puisse être partagé.",
      href: "/app/connexion-stripe",
      actionLabel: facts.stripeReady ? "Vérifier Stripe" : "Finaliser Stripe",
      completed: facts.stripeReady,
      available: facts.hasPaymentReceivable,
    },
  ];
}

export function getOnboardingCompletion(steps: OnboardingStep[]): {
  completed: number;
  total: number;
  percentage: number;
} {
  const completed = steps.filter((step) => step.completed).length;
  const total = steps.length;
  return {
    completed,
    total,
    percentage: Math.round((completed / total) * 100),
  };
}
