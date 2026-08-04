/**
 * Remontée d’erreurs, indépendante de tout fournisseur.
 *
 * POURQUOI : une bonne partie du code applicatif avale ses erreurs (`catch {}`)
 * pour ne pas casser un rendu. Le comportement est correct pour l’utilisateur,
 * mais l’exploitant ne voit alors jamais l’incident. Ce module donne un point
 * d’entrée unique — `captureException` / `captureMessage` — que les blocs
 * `catch` peuvent appeler sans changer leur comportement de repli.
 *
 * POURQUOI PAS DE SDK : aucune dépendance fournisseur n’est ajoutée. Tant que
 * rien n’est configuré, l’implémentation active est un no-op explicite ; elle
 * le déclare (`provider: "noop"`, `configured: false`) et /api/health le
 * rapporte. Brancher un fournisseur plus tard consiste à implémenter
 * `ErrorReporter` et à l’enregistrer via `setErrorReporter`.
 *
 * REDACTION : rien de sensible ne sort d’ici. Le message passe par
 * `redactText` (JWT, Bearer, e-mails, téléphones E.164, IBAN, PAN) puis est
 * tronqué ; le contexte passe par `redactLogContext` (clés sensibles, valeurs
 * suspectes, profondeur et taille bornées). Le tenant n’est transmis que sous
 * forme d’empreinte.
 */

import "server-only";

import { createHash } from "node:crypto";

import { redactText } from "@/lib/llm/redaction";

import { logServerEvent, redactLogContext } from "./server-logger";

export const ERROR_SEVERITIES = [
  "debug",
  "info",
  "warning",
  "error",
  "fatal",
] as const;

export type ErrorSeverity = (typeof ERROR_SEVERITIES)[number];

const MAX_MESSAGE_LENGTH = 300;
const MAX_SCOPE_LENGTH = 80;
const SCOPE_PATTERN = /^[a-z0-9._:-]{1,80}$/i;

export type ErrorReportContext = {
  /** Corrélation avec les logs de la requête (voir ./request-id). */
  requestId?: string | null;
  /** Empreinte du tenant — jamais l’identifiant brut, jamais un e-mail. */
  tenantHash?: string | null;
  severity?: ErrorSeverity;
  /** Emplacement fonctionnel, ex. "api.cron.drains" ou "llm.budget". */
  scope?: string;
  /** Métadonnées additionnelles ; expurgées avant émission. */
  extra?: Readonly<Record<string, unknown>>;
};

/** Événement normalisé, déjà expurgé, transmis à l’implémentation active. */
export type ErrorReportEvent = {
  kind: "exception" | "message";
  severity: ErrorSeverity;
  scope: string;
  message: string;
  error_name: string | null;
  request_id: string | null;
  tenant_hash: string | null;
  extra: Record<string, unknown>;
  occurred_at: string;
};

export type ErrorReporter = {
  /** Identifiant de l’implémentation ("noop", "console", …). */
  readonly provider: string;
  /** false = aucun collecteur configuré, les erreurs ne partent nulle part. */
  readonly configured: boolean;
  captureException(error: unknown, context?: ErrorReportContext): void;
  captureMessage(message: string, context?: ErrorReportContext): void;
};

/**
 * Empreinte stable d’un identifiant de tenant.
 * Tronquée à 32 hex : suffisant pour corréler deux incidents, insuffisant pour
 * remonter à l’identifiant sans le connaître déjà.
 */
export function hashTenantId(tenantId: string): string {
  return createHash("sha256")
    .update(tenantId, "utf8")
    .digest("hex")
    .slice(0, 32);
}

function normalizeScope(scope: string | undefined): string {
  if (!scope) return "unknown";
  const trimmed = scope.trim().slice(0, MAX_SCOPE_LENGTH);
  return SCOPE_PATTERN.test(trimmed) ? trimmed : "invalid_scope";
}

function normalizeMessage(raw: string): string {
  const redacted = redactText(raw.replace(/\s+/g, " ").trim());
  return redacted.length > MAX_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_MESSAGE_LENGTH)}…`
    : redacted;
}

/**
 * N’extrait d’une erreur que ce qui est diffusable : nom et message expurgé.
 * Jamais la stack (chemins internes), jamais `cause` (peut porter un corps de
 * réponse fournisseur complet).
 */
function describeError(error: unknown): {
  name: string | null;
  message: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: normalizeMessage(error.message || error.name || "error"),
    };
  }
  if (typeof error === "string") {
    return { name: null, message: normalizeMessage(error) };
  }
  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return {
      name: null,
      message: normalizeMessage((error as { message: string }).message),
    };
  }
  return { name: null, message: "unserializable_error" };
}

function buildEvent(
  kind: ErrorReportEvent["kind"],
  message: string,
  errorName: string | null,
  context: ErrorReportContext | undefined,
  now: () => Date,
): ErrorReportEvent {
  return {
    kind,
    severity: context?.severity ?? "error",
    scope: normalizeScope(context?.scope),
    message,
    error_name: errorName,
    request_id: context?.requestId ?? null,
    tenant_hash: context?.tenantHash ?? null,
    extra: context?.extra ? redactLogContext(context.extra) : {},
    occurred_at: now().toISOString(),
  };
}

export type CreateErrorReporterOptions = {
  now?: () => Date;
  /** Réception de l’événement normalisé — c’est ici qu’un adaptateur se branche. */
  emit?: (event: ErrorReportEvent) => void;
};

function createReporter(
  provider: string,
  configured: boolean,
  options: CreateErrorReporterOptions = {},
): ErrorReporter {
  const now = options.now ?? (() => new Date());
  const emit = options.emit ?? (() => {});

  return {
    provider,
    configured,
    captureException(error, context) {
      const described = describeError(error);
      emit(
        buildEvent(
          "exception",
          described.message,
          described.name,
          context,
          now,
        ),
      );
    },
    captureMessage(message, context) {
      emit(
        buildEvent(
          "message",
          normalizeMessage(message),
          null,
          context,
          now,
        ),
      );
    },
  };
}

/**
 * Implémentation par défaut : ne transmet rien, ne masque rien non plus.
 * Elle existe pour que les appelants n’aient jamais à tester la présence d’un
 * collecteur, et pour que /api/health puisse dire « aucun collecteur configuré ».
 */
export function createNoopErrorReporter(
  options?: CreateErrorReporterOptions,
): ErrorReporter {
  return createReporter("noop", false, options);
}

/**
 * Journalise l’incident dans le journal serveur structuré.
 * Le transport (stdout) est déjà collecté par l’hébergeur : c’est la seule
 * destination réellement disponible sans configuration externe.
 */
export function createConsoleErrorReporter(
  options?: CreateErrorReporterOptions,
): ErrorReporter {
  const emit =
    options?.emit ??
    ((event: ErrorReportEvent) => {
      logServerEvent(
        event.severity === "debug" || event.severity === "info"
          ? "info"
          : event.severity === "warning"
            ? "warn"
            : "error",
        "error_report",
        {
          kind: event.kind,
          severity: event.severity,
          scope: event.scope,
          // `summary` et non `message` : redactLogContext expurge d’office
          // toute clé se terminant par `message`, ce qui viderait le rapport.
          // La valeur est déjà passée par redactText en amont.
          summary: event.message,
          error_name: event.error_name,
          request_id: event.request_id,
          tenant_hash: event.tenant_hash,
          extra: event.extra,
          occurred_at: event.occurred_at,
        },
      );
    });

  return createReporter("console", true, { ...options, emit });
}

/** Collecteur mémoire — tests et assertions uniquement. */
export function createMemoryErrorReporter(
  options?: CreateErrorReporterOptions,
): ErrorReporter & { readonly events: readonly ErrorReportEvent[]; clear(): void } {
  const events: ErrorReportEvent[] = [];
  const base = createReporter("memory", true, {
    ...options,
    emit: (event) => {
      events.push(event);
      options?.emit?.(event);
    },
  });

  return {
    ...base,
    get events() {
      return events;
    },
    clear() {
      events.length = 0;
    },
  };
}

export type ErrorReportingBackendId = "off" | "console";

/**
 * Lit `SIDIAN_ERROR_REPORTING`. Défaut `off` : aucune sortie non demandée.
 */
export function resolveErrorReportingBackend(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): ErrorReportingBackendId {
  return env.SIDIAN_ERROR_REPORTING?.trim().toLowerCase() === "console"
    ? "console"
    : "off";
}

let reporter: ErrorReporter | null = null;

/** Instance active, construite paresseusement depuis l’environnement. */
export function getErrorReporter(): ErrorReporter {
  if (!reporter) {
    reporter =
      resolveErrorReportingBackend() === "console"
        ? createConsoleErrorReporter()
        : createNoopErrorReporter();
  }
  return reporter;
}

/** Remplace l’instance active (tests, ou branchement d’un adaptateur maison). */
export function setErrorReporter(next: ErrorReporter | null): void {
  reporter = next;
}

/**
 * Raccourci pour les blocs `catch` : remonte l’incident sans jamais lever.
 * Un collecteur défaillant ne doit pas devenir la cause d’une panne.
 */
export function reportError(
  error: unknown,
  context?: ErrorReportContext,
): void {
  try {
    getErrorReporter().captureException(error, context);
  } catch {
    // Dernier recours : le collecteur lui-même a échoué. On ne peut ni lever
    // (on est dans un chemin de repli) ni rappeler le collecteur.
  }
}

/** Variante message — pour les états anormaux qui ne produisent pas d’Error. */
export function reportMessage(
  message: string,
  context?: ErrorReportContext,
): void {
  try {
    getErrorReporter().captureMessage(message, context);
  } catch {
    // idem reportError.
  }
}

export type ErrorReportingReport = {
  provider: string;
  configured: boolean;
  backend: ErrorReportingBackendId;
};

/** Diagnostic /api/health : y a-t-il un collecteur d’erreurs actif. */
export function describeErrorReporting(): ErrorReportingReport {
  const active = getErrorReporter();
  return {
    provider: active.provider,
    configured: active.configured,
    backend: resolveErrorReportingBackend(),
  };
}
