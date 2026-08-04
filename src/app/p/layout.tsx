import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Paiement sécurisé | Sidian",
  referrer: "no-referrer",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function PublicPaymentLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  /*
   * Les pages de paiement s'adressent au client débiteur, pas au prestataire.
   * Lui appliquer la préférence d'apparence du prestataire n'aurait aucun sens,
   * et une page où l'on saisit un moyen de paiement doit rendre exactement la
   * même chose pour tout le monde.
   *
   * `data-theme="light"` réapplique ici le bloc clair complet, même si <html>
   * est en sombre : les tokens sont hérités de l'ancêtre le plus proche qui
   * les déclare (voir design-system/tokens.css).
   */
  return (
    <div data-theme="light" className="contents">
      {children}
    </div>
  );
}
