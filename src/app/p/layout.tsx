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
  return children;
}
