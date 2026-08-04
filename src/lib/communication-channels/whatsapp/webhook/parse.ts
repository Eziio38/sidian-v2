export type ParsedWhatsAppStatusEvent = {
  dedupeKey: string;
  providerEventId: string;
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  errorCode?: string;
  errorMessage?: string;
};

const STATUS_MAP: Record<string, ParsedWhatsAppStatusEvent["status"]> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

/**
 * Parse défensif — ignore les structures inconnues sans throw.
 */
export function parseWhatsAppStatusEvents(
  payload: unknown,
): ParsedWhatsAppStatusEvent[] {
  if (!payload || typeof payload !== "object") return [];
  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];

  const events: ParsedWhatsAppStatusEvent[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const changes = (entry as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      if (!change || typeof change !== "object") continue;
      const value = (change as { value?: unknown }).value;
      if (!value || typeof value !== "object") continue;
      const statuses = (value as { statuses?: unknown }).statuses;
      if (!Array.isArray(statuses)) continue;

      for (const statusItem of statuses) {
        if (!statusItem || typeof statusItem !== "object") continue;
        const id = (statusItem as { id?: unknown }).id;
        const status = (statusItem as { status?: unknown }).status;
        const timestamp = (statusItem as { timestamp?: unknown }).timestamp;
        if (typeof id !== "string" || typeof status !== "string") continue;
        const mapped = STATUS_MAP[status];
        if (!mapped) continue;

        const ts =
          typeof timestamp === "string" || typeof timestamp === "number"
            ? new Date(Number(timestamp) * 1000).toISOString()
            : new Date().toISOString();

        const errors = (statusItem as { errors?: unknown }).errors;
        let errorCode: string | undefined;
        let errorMessage: string | undefined;
        if (Array.isArray(errors) && errors[0] && typeof errors[0] === "object") {
          const err = errors[0] as { code?: unknown; title?: unknown };
          if (typeof err.code === "number" || typeof err.code === "string") {
            errorCode = String(err.code);
          }
          if (typeof err.title === "string") {
            errorMessage = err.title.slice(0, 200);
          }
        }

        events.push({
          dedupeKey: `${id}:${mapped}`,
          providerEventId: `${id}:${mapped}:${timestamp ?? "na"}`,
          providerMessageId: id,
          status: mapped,
          timestamp: ts,
          errorCode,
          errorMessage,
        });
      }
    }
  }

  return events;
}
