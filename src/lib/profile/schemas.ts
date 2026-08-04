import { z } from "zod";

export const prestataireProfileSchema = z.object({
  nom: z
    .string()
    .trim()
    .transform((value) => value.replace(/\s+/g, " "))
    .pipe(
      z
        .string()
        .min(2, "Indiquez un nom d’activité.")
        .max(200, "Le nom doit contenir au maximum 200 caractères."),
    ),
  profilAgent: z.enum(["controle", "delegation"], {
    message: "Choisissez un profil pour l’agent.",
  }),
});

export type PrestataireProfileInput = z.infer<
  typeof prestataireProfileSchema
>;
