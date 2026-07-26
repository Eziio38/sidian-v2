/**
 * G1-N — intégration runtime ↔ protection.draft (mémoire).
 */

import { describe, expect, it } from "vitest";

import {
  CONVERSATIONAL_RUNTIME_SCHEMA_VERSION,
  createConversationalRuntimeService,
  createStubLlmProvider,
} from "@/lib/agent/conversational-runtime";
import { createProtectionDraftService } from "@/lib/agent/protection-draft";
import {
  ACTOR_A,
  createMemoryProtectionDraftRepository,
  EXAMPLE_MESSAGE,
  NOW,
  TENANT_A,
} from "@/lib/agent/protection-draft/test-fixtures";

describe("G1-N wire protection.draft", () => {
  it("tourne un message → brouillon uniquement (pas de métier)", async () => {
    const repo = createMemoryProtectionDraftRepository();
    const draftService = createProtectionDraftService(repo);
    const runtime = createConversationalRuntimeService({
      provider: createStubLlmProvider({ mode: "deterministic" }),
      draftService,
    });

    const turn = await runtime.handleTurn({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      user_message: EXAMPLE_MESSAGE,
      reference_now: NOW,
      idempotency_key: "turn-1",
    });

    expect(turn.draft.state).toBe("RECAPITULATIF");
    expect(turn.draft.client_payeur_id).toBeNull();
    expect(turn.draft.creance_id).toBeNull();
    expect(repo._clients.size).toBe(0);
    expect(repo._creances.size).toBe(0);
    expect(turn.recap.expected_amount_minor).toBe(240_000);
    expect(turn.draft.confirmation_nonce).toBeTruthy();
  });

  it("double envoi / rejeu idempotent", async () => {
    const repo = createMemoryProtectionDraftRepository();
    const draftService = createProtectionDraftService(repo);
    const runtime = createConversationalRuntimeService({
      provider: createStubLlmProvider({ mode: "deterministic" }),
      draftService,
    });

    const a = await runtime.handleTurn({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      user_message: EXAMPLE_MESSAGE,
      reference_now: NOW,
      idempotency_key: "same-key",
    });
    const b = await runtime.handleTurn({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      user_message: EXAMPLE_MESSAGE,
      reference_now: NOW,
      idempotency_key: "same-key",
    });

    expect(b.replay).toBe(true);
    expect(b.draft.draft_id).toBe(a.draft.draft_id);
    expect(repo._store.size).toBe(1);
  });

  it("contradiction montant : correction via draft.advance après converse", async () => {
    const repo = createMemoryProtectionDraftRepository();
    const draftService = createProtectionDraftService(repo);
    const runtime = createConversationalRuntimeService({
      provider: createStubLlmProvider({ mode: "deterministic" }),
      draftService,
    });

    const turn = await runtime.handleTurn({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      user_message: EXAMPLE_MESSAGE,
      reference_now: NOW,
    });

    const corrected = await draftService.advance({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      draft_id: turn.draft.draft_id,
      intent: {
        kind: "correction",
        field: "expected_amount_minor",
        value: 300_000,
      },
      now: NOW,
    });

    expect(corrected.draft.fields.expected_amount_minor?.value).toBe(300_000);
    expect(corrected.draft.fields.expected_amount_minor?.provenance).toBe(
      "user_corrected",
    );
  });

  it("fallback après erreur provider : toujours un brouillon", async () => {
    const repo = createMemoryProtectionDraftRepository();
    const draftService = createProtectionDraftService(repo);
    const provider = createStubLlmProvider({
      mode: "error",
      error: new Error("boom"),
    });
    const runtime = createConversationalRuntimeService({
      provider,
      draftService,
    });

    const turn = await runtime.handleTurn({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      user_message: EXAMPLE_MESSAGE,
      reference_now: NOW,
      max_retries: 0,
    });

    expect(turn.trace.fallback_used).toBe(true);
    expect(turn.extraction.source).toBe("deterministic_fallback");
    expect(turn.draft.client_payeur_id).toBeNull();
  });

  it("sortie LLM avec champs inventés filtrés avant wire", async () => {
    const repo = createMemoryProtectionDraftRepository();
    const draftService = createProtectionDraftService(repo);
    const provider = createStubLlmProvider({
      mode: "fixed",
      response: {
        schema_version: CONVERSATIONAL_RUNTIME_SCHEMA_VERSION,
        fields: {
          client_name: { value: "Dupont Conseil", confidence: 0.9 },
          client_email: { value: "hallucinated@evil.com", confidence: 0.99 },
          expected_amount_minor: { value: 240000, confidence: 0.9 },
          currency: { value: "EUR", confidence: 0.9 },
          due_date: { value: "2026-09-12", confidence: 0.9 },
        },
        ambiguities: [],
      },
    });
    const runtime = createConversationalRuntimeService({
      provider,
      draftService,
    });

    const turn = await runtime.handleTurn({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      user_message: EXAMPLE_MESSAGE,
      reference_now: NOW,
    });

    expect(turn.draft.fields.client_email).toBeUndefined();
    expect(turn.draft.missing_fields).toContain("client_email");
  });

  it("confirm reste le seul chemin métier (après converse)", async () => {
    const repo = createMemoryProtectionDraftRepository();
    const draftService = createProtectionDraftService(repo);
    const runtime = createConversationalRuntimeService({
      provider: createStubLlmProvider({ mode: "deterministic" }),
      draftService,
    });

    const turn = await runtime.handleTurn({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      user_message: EXAMPLE_MESSAGE,
      reference_now: NOW,
    });

    await draftService.advance({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      draft_id: turn.draft.draft_id,
      intent: { kind: "acknowledge_recap" },
      now: NOW,
    });

    const created = await draftService.confirm({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      draft_id: turn.draft.draft_id,
      explicit_confirmation: true,
      confirmation_nonce: turn.draft.confirmation_nonce!,
      now: NOW,
    });

    expect(created.outcome).toBe("created");
    expect(repo._clients.size).toBe(1);
    expect(repo._creances.size).toBe(1);
  });
});
