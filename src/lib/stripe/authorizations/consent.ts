export const FUTURE_PAYMENT_AUTHORIZATION_TEXT_VERSION =
  "sidian-future-payments-fr-v1";

export const FUTURE_PAYMENT_AUTHORIZATION_TITLE =
  "Simplifier vos prochains règlements";

export function futurePaymentAuthorizationText(prestataireNom: string): string {
  return `J’autorise ${prestataireNom} à enregistrer, via Stripe, le moyen que je vais choisir pour de futurs paiements éligibles en euros. Cette autorisation pourra être révoquée. Chaque paiement restera soumis aux garde-fous Sidian et aux conditions du moyen choisi. Aucun prélèvement SEPA automatique ne sera déclenché tant que les conditions de prénotification applicables ne sont pas validées.`;
}

