import type { ReactNode } from "react";

import { AuthShell } from "@/components/auth/auth-shell";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}

export function AuthPage({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AuthShell title={title} description={description} footer={footer}>
      {children}
    </AuthShell>
  );
}
