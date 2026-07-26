import type { ReactNode } from "react";

function IconShell({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex size-3.5 shrink-0 items-center justify-center text-current opacity-70">
      {children}
    </span>
  );
}

function ShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3 5 6v6c0 5 3.5 8.5 7 9 3.5-.5 7-4 7-9V6l-7-3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="4"
        y="5"
        width="16"
        height="15"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M8 3v4M16 3v4M4 10h16"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function InvoiceIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 3h8l4 4v14H7V3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M15 3v4h4M9 12h6M9 16h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 19h4l10.5-10.5a2.1 2.1 0 0 0-3-3L6 16v3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M13 6.5 17.5 11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5.5 19a6.5 6.5 0 0 1 13 0"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 12.5v-1a7 7 0 0 0-14 0v6a4 4 0 0 0 8 0V11a2 2 0 1 0-4 0v6.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12.5 10 17.5 19 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const ACTION_ICONS: Record<string, ReactNode> = {
  create_protection: <ShieldIcon />,
  view_expected_payments: <CalendarIcon />,
  add_invoice: <InvoiceIcon />,
  edit_amount: <PencilIcon />,
  change_due_date: <CalendarIcon />,
  add_contact: <PersonIcon />,
  add_document: <PaperclipIcon />,
  view_protection: <EyeIcon />,
  add_another_invoice: <PlusIcon />,
  mark_as_paid: <CheckIcon />,
};

const LABEL_ICONS: Array<{ match: RegExp; icon: ReactNode }> = [
  { match: /protection/i, icon: <ShieldIcon /> },
  { match: /paiement|attendu|échéance|jours|mois|date/i, icon: <CalendarIcon /> },
  { match: /facture|document/i, icon: <InvoiceIcon /> },
  { match: /montant|modifier/i, icon: <PencilIcon /> },
  { match: /client|contact/i, icon: <PersonIcon /> },
  { match: /payé|payer|valid/i, icon: <CheckIcon /> },
  { match: /voir/i, icon: <EyeIcon /> },
  { match: /ajouter/i, icon: <PlusIcon /> },
];

export function SuggestionIcon({
  action,
  label,
}: {
  action?: string;
  label?: string;
}) {
  const byAction = action ? ACTION_ICONS[action] : undefined;
  if (byAction) {
    return <IconShell>{byAction}</IconShell>;
  }

  if (label) {
    const byLabel = LABEL_ICONS.find((entry) => entry.match.test(label));
    if (byLabel) {
      return <IconShell>{byLabel.icon}</IconShell>;
    }
  }

  return (
    <IconShell>
      <PlusIcon />
    </IconShell>
  );
}
