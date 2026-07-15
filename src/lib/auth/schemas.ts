import { z } from "zod";

function normalizeSpaces(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

const passwordSchema = z
  .string()
  .min(8, "Le mot de passe doit contenir au moins 8 caractères.")
  .regex(/[a-zA-Z]/, "Le mot de passe doit contenir au moins une lettre.")
  .regex(/[0-9]/, "Le mot de passe doit contenir au moins un chiffre.");

export const signUpSchema = z
  .object({
    displayName: z
      .string()
      .transform(normalizeSpaces)
      .pipe(z.string().min(1, "Indiquez comment nous pouvons vous appeler.")),
    agencyName: z
      .string()
      .transform(normalizeSpaces)
      .pipe(
        z.string().min(1, "Indiquez le nom de votre agence ou activité."),
      ),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email("Adresse email invalide.")),
    password: passwordSchema,
    passwordConfirm: z.string().min(1, "Confirmez votre mot de passe."),
    acceptCgu: z.literal(true, {
      error: "Vous devez accepter les conditions générales d'utilisation.",
    }),
    acceptPrivacy: z.literal(true, {
      error: "Vous devez accepter la politique de confidentialité.",
    }),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    path: ["passwordConfirm"],
    message: "Les mots de passe ne correspondent pas.",
  });

export const signInSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Adresse email invalide.")),
  password: z.string().min(1, "Saisissez votre mot de passe."),
});

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Adresse email invalide.")),
});

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    passwordConfirm: z.string().min(1, "Confirmez votre mot de passe."),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    path: ["passwordConfirm"],
    message: "Les mots de passe ne correspondent pas.",
  });

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export type FieldErrors = Record<string, string[]>;

export function formatZodFieldErrors(
  error: z.ZodError,
): FieldErrors {
  const fieldErrors: FieldErrors = {};

  for (const issue of error.issues) {
    const key = issue.path[0];

    if (typeof key !== "string") {
      continue;
    }

    fieldErrors[key] ??= [];
    fieldErrors[key].push(issue.message);
  }

  return fieldErrors;
}
