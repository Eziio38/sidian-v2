import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ConfigStatusList,
  EmptyState,
  ErrorState,
  GeneratingIndicator,
  IncompleteProtectionNotice,
  PageSkeleton,
  PermissionDenied,
  StatusBanner,
} from "@/components/feedback";
import { UX_COPY } from "@/lib/ux/microcopy";
import type { ConfigChannelStatus } from "@/lib/ux/config-status-types";

const FORBIDDEN_UI_WORDS = [
  "créance",
  "débiteur",
  "RPC",
  "webhook",
  "provider",
  "outbox",
  "idempotence",
  "tenant",
  "reconciliation",
  "status code",
];

describe("microcopie UX", () => {
  it("reste en tutoiement et sans jargon technique interdit", () => {
    const blob = Object.values(UX_COPY)
      .flatMap((entry) => {
        const copy = entry as {
          title: string;
          description: string;
          actionLabel?: string;
          secondaryLabel?: string;
        };
        return [
          copy.title,
          copy.description,
          copy.actionLabel ?? "",
          copy.secondaryLabel ?? "",
        ];
      })
      .join("\n")
      .toLowerCase();

    expect(blob).toMatch(/\b(tu|ton|ta|tes|t’|t')\b/);
    for (const word of FORBIDDEN_UI_WORDS) {
      expect(blob).not.toContain(word.toLowerCase());
    }
  });
});

describe("composants feedback", () => {
  it(
    "EmptyState affiche titre, description et action",
    () => {
      const onClick = vi.fn();
      render(
        <EmptyState
          title={UX_COPY.emptyClients.title}
          description={UX_COPY.emptyClients.description}
          action={{ label: "Ajouter un client", onClick }}
        />,
      );

      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
      expect(screen.getByText(UX_COPY.emptyClients.title)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Ajouter un client" }),
      ).toBeInTheDocument();
    },
    15_000,
  );

  it("ErrorState expose un retry sans détail technique", () => {
    const onRetry = vi.fn();
    render(
      <ErrorState
        title={UX_COPY.errorGeneric.title}
        description={UX_COPY.errorGeneric.description}
        onRetry={onRetry}
        digest="abc-secret"
      />,
    );

    expect(screen.getByTestId("error-state")).toHaveAttribute("role", "alert");
    expect(screen.queryByText(/abc-secret/)).not.toBeInTheDocument();
    screen.getByRole("button", { name: "Réessayer" }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("PermissionDenied et IncompleteProtection restent solution-oriented", () => {
    render(
      <>
        <PermissionDenied />
        <IncompleteProtectionNotice />
        <StatusBanner
          tone="warning"
          title={UX_COPY.autoDebitCeilingNotValidated.title}
          description={UX_COPY.autoDebitCeilingNotValidated.description}
        />
      </>,
    );

    expect(
      screen.getByText(UX_COPY.permissionDenied.title),
    ).toBeInTheDocument();
    expect(
      screen.getByText(UX_COPY.incompleteProtection.title),
    ).toBeInTheDocument();
    expect(
      screen.getByText(UX_COPY.autoDebitCeilingNotValidated.title),
    ).toBeInTheDocument();
  });

  it("PageSkeleton et GeneratingIndicator sont annoncés", () => {
    const { rerender } = render(<PageSkeleton />);
    expect(screen.getByTestId("page-skeleton")).toHaveAttribute(
      "aria-busy",
      "true",
    );

    rerender(<GeneratingIndicator />);
    expect(screen.getByTestId("generating-indicator")).toHaveAttribute(
      "role",
      "status",
    );
  });

  it("ConfigStatusList affiche email/WhatsApp en lecture seule avec CTA démarrage", () => {
    const channels: ConfigChannelStatus[] = [
      {
        kind: "email",
        state: "missing",
        label: "À activer",
        title: UX_COPY.missingConfigEmail.title,
        description: UX_COPY.missingConfigEmail.description,
        href: "/app/demarrage",
        actionLabel: UX_COPY.missingConfigEmail.actionLabel,
      },
      {
        kind: "whatsapp",
        state: "missing",
        label: "À activer",
        title: UX_COPY.missingConfigWhatsapp.title,
        description: UX_COPY.missingConfigWhatsapp.description,
        href: "/app/demarrage",
        actionLabel: UX_COPY.missingConfigWhatsapp.actionLabel,
      },
    ];

    render(
      <ConfigStatusList
        channels={channels}
        title={UX_COPY.settingsChannels.title}
        description={UX_COPY.settingsChannels.description}
      />,
    );

    expect(screen.getByTestId("config-status-list")).toBeInTheDocument();
    expect(screen.getByText(UX_COPY.missingConfigEmail.title)).toBeInTheDocument();
    expect(
      screen.getByText(UX_COPY.missingConfigWhatsapp.title),
    ).toBeInTheDocument();
    const ctas = screen.getAllByRole("link", { name: "Continuer le démarrage" });
    expect(ctas).toHaveLength(2);
    expect(ctas[0]).toHaveAttribute("href", "/app/demarrage");
  });
});
