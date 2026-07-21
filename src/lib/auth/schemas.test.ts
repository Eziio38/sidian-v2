import { describe, expect, it } from "vitest";

import {
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/auth/schemas";

const validSignUp = {
  displayName: "Camille Martin",
  agencyName: "Studio Horizon",
  email: "camille@example.com",
  password: "Motdepasse1",
  passwordConfirm: "Motdepasse1",
  acceptCgu: true,
  acceptPrivacy: true,
};

describe("bornes des entrées Auth", () => {
  it("refuse les noms métier au-delà de 120 caractères", () => {
    expect(
      signUpSchema.safeParse({
        ...validSignUp,
        displayName: "a".repeat(121),
      }).success,
    ).toBe(false);
    expect(
      signUpSchema.safeParse({
        ...validSignUp,
        agencyName: "a".repeat(121),
      }).success,
    ).toBe(false);
  });

  it("refuse les emails au-delà de 254 caractères sur tous les parcours", () => {
    const longEmail = `${"a".repeat(244)}@example.com`;

    expect(
      signUpSchema.safeParse({ ...validSignUp, email: longEmail }).success,
    ).toBe(false);
    expect(
      signInSchema.safeParse({ email: longEmail, password: "x" }).success,
    ).toBe(false);
    expect(forgotPasswordSchema.safeParse({ email: longEmail }).success).toBe(
      false,
    );
  });

  it("refuse mot de passe et confirmation au-delà de 1024 caractères", () => {
    const longPassword = `A1${"x".repeat(1023)}`;

    expect(
      signUpSchema.safeParse({
        ...validSignUp,
        password: longPassword,
        passwordConfirm: longPassword,
      }).success,
    ).toBe(false);
    expect(
      signInSchema.safeParse({
        email: validSignUp.email,
        password: longPassword,
      }).success,
    ).toBe(false);
    expect(
      resetPasswordSchema.safeParse({
        password: longPassword,
        passwordConfirm: longPassword,
      }).success,
    ).toBe(false);
  });
});
