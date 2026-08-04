/**
 * Microcopie UX Sidian — tutoiement, ton humain, orienté solution.
 * Interdit dans l’UI : créance, débiteur, RPC, webhook, provider,
 * outbox, idempotence, tenant, reconciliation, status code.
 */

export type UxCopy = {
  title: string;
  description: string;
  actionLabel?: string;
  secondaryLabel?: string;
};

export const UX_COPY = {
  loading: {
    title: "Un instant…",
    description: "On charge ton espace.",
  },
  skeleton: {
    title: "Préparation en cours",
    description: "Ça arrive dans une seconde.",
  },
  emptyGeneric: {
    title: "Rien à afficher pour l’instant",
    description: "Dès qu’il y aura quelque chose ici, tu le verras tout de suite.",
  },
  emptyClients: {
    title: "Aucun client pour l’instant",
    description: "Ajoute ton premier client pour préparer un suivi de paiement.",
    actionLabel: "Ajouter un client",
  },
  emptyPayments: {
    title: "Aucun paiement attendu",
    description: "Crée un premier paiement à recevoir. Stripe n’est pas encore nécessaire.",
    actionLabel: "Créer un paiement",
  },
  emptyAssistant: {
    title: "Par où tu veux commencer ?",
    description: "Dis-moi simplement ce que tu veux faire. Je t’accompagne pas à pas.",
  },
  errorGeneric: {
    title: "On n’a pas pu afficher cet écran",
    description:
      "Rien n’a été modifié de ton côté. Tu peux réessayer, ou revenir dans un instant.",
    actionLabel: "Réessayer",
  },
  errorLoad: {
    title: "Chargement impossible",
    description: "Réessaie dans quelques secondes. Si ça continue, reviens un peu plus tard.",
    actionLabel: "Réessayer",
  },
  requestSaveFailed: {
    title: "Je n’ai pas pu enregistrer ta demande.",
    description:
      "Rien n’a été modifié. Tu peux réessayer dans un instant.",
    actionLabel: "Réessayer",
  },
  offline: {
    title: "Tu es hors ligne",
    description: "Reconnecte-toi pour continuer. Tes actions ne partiront pas tant que le réseau manque.",
    actionLabel: "Réessayer",
  },
  successGeneric: {
    title: "C’est bon",
    description: "Tout s’est bien passé.",
  },
  successSaved: {
    title: "Enregistré",
    description: "Tes changements sont bien pris en compte.",
  },
  disabledGeneric: {
    title: "Pas encore disponible",
    description: "Cette action s’ouvrira dès que l’étape précédente sera terminée.",
  },
  permissionDenied: {
    title: "Tu n’as pas accès à cette action",
    description:
      "C’est normal : certaines décisions restent sous ton contrôle. Choisis une autre action, ou confirme d’abord ce qui est demandé.",
  },
  missingConfigEmail: {
    title: "L’envoi d’emails n’est pas prêt",
    description:
      "Les messages email ne partiront pas tant que l’envoi n’est pas activé côté Sidian. Tu peux continuer à préparer tes paiements et finaliser Stripe.",
    actionLabel: "Continuer le démarrage",
  },
  missingConfigWhatsapp: {
    title: "WhatsApp n’est pas prêt",
    description:
      "Les messages WhatsApp ne partiront pas tant que le canal n’est pas actif côté Sidian. Tu peux déjà créer tes paiements à recevoir.",
    actionLabel: "Continuer le démarrage",
  },
  missingConfigStripe: {
    title: "L’encaissement n’est pas encore finalisé",
    description:
      "Finalise Stripe quand tu voudras partager un lien de paiement. Tu peux créer le paiement avant.",
    actionLabel: "Finaliser Stripe",
  },
  incompleteProtection: {
    title: "La protection n’est pas encore complète",
    description:
      "Il me manque encore quelques informations. Rien ne sera envoyé avant ta confirmation.",
    actionLabel: "Continuer",
  },
  autoDebitCeilingNotValidated: {
    title: "Le plafond de prélèvement auto n’est pas encore validé",
    description:
      "Pour te protéger, Sidian n’enclenchera aucun prélèvement automatique tant que ce plafond n’est pas défini. Les paiements manuels restent possibles.",
  },
  inProgress: {
    title: "En cours…",
    description: "On s’en occupe. Tu peux rester sur cet écran.",
  },
  generating: {
    title: "Sidian réfléchit…",
    description: "Réponse en préparation.",
  },
  irreversibleConfirm: {
    title: "Tu confirmes ?",
    description: "Cette action ne pourra pas être annulée facilement.",
    actionLabel: "Confirmer",
    secondaryLabel: "Annuler",
  },
  irreversibleCancelPayment: {
    title: "Annuler ce paiement à recevoir ?",
    description:
      "Le lien actif sera révoqué. Tu pourras en créer un nouveau plus tard si besoin.",
    actionLabel: "Oui, annuler",
    secondaryLabel: "Garder",
  },
  retryHint: {
    title: "Réessaie",
    description: "Parfois ça passe au second essai.",
    actionLabel: "Réessayer",
  },
  onboardingProgress: {
    title: "Ta progression",
    description: "Quelques étapes courtes pour préparer ton premier suivi.",
  },
  settingsChannels: {
    title: "Canaux et encaissement",
    description:
      "État réel de ce qui est prêt aujourd’hui. Rien n’est inventé : on affiche seulement ce qui est vérifié.",
  },
} as const satisfies Record<string, UxCopy>;

export type UxCopyKey = keyof typeof UX_COPY;

export function getUxCopy(key: UxCopyKey): UxCopy {
  return UX_COPY[key];
}

/** Libellés courts pour badges / lignes de statut. */
export const UX_STATUS_LABEL = {
  ready: "Prêt",
  missing: "À activer",
  partial: "En cours",
  unavailable: "Indisponible",
  blocked: "En pause",
} as const;

export type UxStatusLabelKey = keyof typeof UX_STATUS_LABEL;
