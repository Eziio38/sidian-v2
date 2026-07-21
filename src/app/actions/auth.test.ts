import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_MESSAGES } from "@/lib/auth/messages";

const mocks = vi.hoisted(() => ({
  requestHeaders: new Headers({
    "x-vercel-forwarded-for": "203.0.113.10",
  }),
  evaluateAuthRateLimit: vi.fn(async () => ({
    status: "allowed" as "allowed" | "limited" | "unavailable",
  })),
  createClient: vi.fn(),
  getUser: vi.fn(async () => ({
    data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
  })),
  updateUser: vi.fn(async () => ({ error: null })),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => mocks.requestHeaders),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock("@/lib/auth/rate-limit", () => ({
  evaluateAuthRateLimit: mocks.evaluateAuthRateLimit,
}));
vi.mock("@/lib/auth/ensure-prestataire", () => ({
  ensurePrestataireForUser: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth/log-auth-error", () => ({
  logSignUpInputPresence: vi.fn(),
  logSupabaseAuthError: vi.fn(),
}));
vi.mock("@/lib/auth/urls", () => ({
  buildAuthCallbackUrl: vi.fn(() => "http://localhost/auth/callback"),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import {
  forgotPasswordAction,
  resetPasswordAction,
  signInAction,
  signUpAction,
} from "@/app/actions/auth";

function signUpForm(): FormData {
  const formData = new FormData();
  formData.set("displayName", "Camille Martin");
  formData.set("agencyName", "Studio Horizon");
  formData.set("email", "Camille@Example.com");
  formData.set("password", "Motdepasse1");
  formData.set("passwordConfirm", "Motdepasse1");
  formData.set("acceptCgu", "on");
  formData.set("acceptPrivacy", "on");
  return formData;
}

function credentialsForm(): FormData {
  const formData = new FormData();
  formData.set("email", "Camille@Example.com");
  formData.set("password", "Motdepasse1");
  return formData;
}

describe("rate limiting des actions Auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.evaluateAuthRateLimit.mockResolvedValue({ status: "allowed" });
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: mocks.getUser,
        updateUser: mocks.updateUser,
      },
    });
  });

  it("bloque l'inscription avant tout appel Supabase Auth", async () => {
    mocks.evaluateAuthRateLimit.mockResolvedValueOnce({ status: "limited" });

    const result = await signUpAction({ ok: false }, signUpForm());

    expect(result).toEqual({
      ok: false,
      fieldErrors: undefined,
      message: AUTH_MESSAGES.genericRateLimitError,
    });
    expect(mocks.evaluateAuthRateLimit).toHaveBeenCalledWith({
      operation: "sign_up",
      requestHeaders: mocks.requestHeaders,
      identity: "camille@example.com",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("échoue fermé sur la connexion si le quota est indisponible", async () => {
    mocks.evaluateAuthRateLimit.mockResolvedValueOnce({
      status: "unavailable",
    });

    const result = await signInAction({ ok: false }, credentialsForm());

    expect(result.message).toBe(AUTH_MESSAGES.genericRateLimitError);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("ne révèle pas le rate limit de récupération de mot de passe", async () => {
    mocks.evaluateAuthRateLimit.mockResolvedValueOnce({ status: "limited" });
    const formData = new FormData();
    formData.set("email", "Camille@Example.com");

    const result = await forgotPasswordAction({ ok: false }, formData);

    expect(result).toEqual({
      ok: true,
      message: AUTH_MESSAGES.genericPasswordResetSent,
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("borne la mise à jour par l'identité serveur de la session", async () => {
    mocks.evaluateAuthRateLimit.mockResolvedValueOnce({ status: "limited" });
    const formData = new FormData();
    formData.set("password", "NouveauMot2");
    formData.set("passwordConfirm", "NouveauMot2");

    const result = await resetPasswordAction({ ok: false }, formData);

    expect(mocks.evaluateAuthRateLimit).toHaveBeenCalledWith({
      operation: "password_update",
      requestHeaders: mocks.requestHeaders,
      identity: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.message).toBe(AUTH_MESSAGES.genericRateLimitError);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
});
