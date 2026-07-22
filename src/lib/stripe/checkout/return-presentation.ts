import type { CheckoutReturnStatus } from "./resolve-checkout-status";

export type CheckoutReturnPresentation = {
  title: string;
  message: string;
  canRecheck: boolean;
};

export function checkoutReturnPresentation(
  status: CheckoutReturnStatus,
): CheckoutReturnPresentation {
  if (status === "confirmed") {
    return {
      title: "Paiement confirmé",
      message:
        "Merci, votre paiement a bien été reçu et confirmé. Vous pouvez fermer cette page.",
      canRecheck: false,
    };
  }
  if (status === "not_confirmed") {
    return {
      title: "Paiement non confirmé",
      message:
        "Ce paiement n’a pas abouti. Vous pouvez réessayer depuis votre lien de paiement, avec le même moyen de paiement ou un autre.",
      canRecheck: false,
    };
  }
  if (status === "processing") {
    return {
      title: "Paiement en cours",
      message:
        "Votre paiement est en cours de traitement. Vous recevrez une confirmation dès qu’il sera validé — cela peut prendre quelques instants, ou quelques jours ouvrés pour un prélèvement bancaire.",
      canRecheck: true,
    };
  }
  if (status === "expired") {
    return {
      title: "Session de paiement expirée",
      message:
        "Cette session a expiré sans confirmer de paiement. Votre lien de paiement reste utilisable pour recommencer en toute sécurité.",
      canRecheck: false,
    };
  }
  return {
    title: "Paiement impossible à vérifier",
    message:
      "Nous ne pouvons pas déterminer le statut de ce paiement pour le moment. Aucune confirmation n’est affichée tant que la projection serveur n’est pas disponible.",
    canRecheck: true,
  };
}
