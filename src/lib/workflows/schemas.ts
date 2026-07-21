import { z } from "zod";

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Date invalide.");

export const receivableIdSchema = z.string().uuid();

export const followUpUpdateSchema = z.object({
  receivableId: receivableIdSchema,
  targetState: z.enum([
    "PREVENTION",
    "ECHEANCE",
    "SUIVI_AMIABLE",
    "PAUSE_LITIGE",
    "ATTENTE_CLIENT",
    "ATTENTE_PRESTATAIRE",
    "ESCALADE_HUMAINE",
    "CLOS",
  ]),
  nextActionDate: z.union([z.literal(""), isoDateSchema]),
  escalationReason: z.string().trim().max(500, "Le motif est trop long."),
});

export function nextActionDateToIso(value: string): string | null {
  return value ? `${value}T12:00:00.000Z` : null;
}
