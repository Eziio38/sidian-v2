/**
 * G1-M — service domaine (machine d’état, confirm, cross-tenant, idempotence).
 */

import { describe, expect, it } from "vitest";

import { ProtectionDraftError } from "./errors";
import { createProtectionDraftService } from "./service";
import {
  ACTOR_A,
  ACTOR_B,
  EXAMPLE_MESSAGE,
  EXPIRED,
  LATER,
  NOW,
  TENANT_A,
  TENANT_B,
  createMemoryProtectionDraftRepository,
} from "./test-fixtures";

function createSut() {
  const repo = createMemoryProtectionDraftRepository();
  const service = createProtectionDraftService(repo, {
    ttlMs: 24 * 60 * 60 * 1000,
  });
  return { repo, service };
}

describe("G1-M ProtectionDraftService", () => {
  it("extrait un brouillon sans créer de client/créance métier", async () => {
    const { repo, service } = createSut();
    const result = await service.advance({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      intent: { kind: "message", text: EXAMPLE_MESSAGE },
      now: NOW,
    });

    expect(result.draft.state).toBe("RECAPITULATIF");
    expect(result.draft.missing_fields).toEqual([]);
    expect(result.recap.expected_amount_minor).toBe(240_000);
    expect(result.recap.client_email).toBe("jean@dupont.fr");
    expect(result.draft.client_payeur_id).toBeNull();
    expect(result.draft.creance_id).toBeNull();
    expect(repo._clients.size).toBe(0);
    expect(repo._creances.size).toBe(0);
    expect(result.draft.fields.client_name?.provenance).toBe("agent_proposed");
  });

  it("pose des questions ciblées pour les champs manquants uniquement", async () => {
    const { service } = createSut();
    const result = await service.advance({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      intent: {
        kind: "message",
        text: "Je dois recevoir 500 € le 2026-08-01.",
      },
      now: NOW,
    });
    expect(result.draft.missing_fields).toEqual(
      expect.arrayContaining(["client_name", "client_email"]),
    );
    expect(result.draft.missing_fields).not.toContain("expected_amount_minor");
    expect(result.targeted_question).toBeTruthy();
    expect(result.draft.state).toBe("INFORMATIONS_MANQUANTES");
  });

  it("les corrections écrasent proprement la valeur précédente", async () => {
    const { service } = createSut();
    const first = await service.advance({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      intent: { kind: "message", text: EXAMPLE_MESSAGE },
      now: NOW,
    });
    const corrected = await service.advance({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      draft_id: first.draft.draft_id,
      intent: {
        kind: "correction",
        field: "expected_amount_minor",
        value: "2500",
      },
      now: LATER,
    });
    expect(corrected.recap.expected_amount_minor).toBe(250_000);
    expect(
      corrected.draft.fields.expected_amount_minor?.provenance,
    ).toBe("user_corrected");
  });

  it("une date ambiguë exige confirmation avant récap complet", async () => {
    const { service } = createSut();
    const first = await service.advance({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      intent: {
        kind: "message",
        text: "Recevoir 100 € de Dupont le 12 septembre. Contact: jean@dupont.fr",
      },
      now: NOW,
    });
    expect(first.draft.open_ambiguities.length).toBeGreaterThan(0);
    expect(first.draft.state).toBe("QUESTION_CIBLEE");
    expect(first.draft.client_payeur_id).toBeNull();

    const candidate = first.draft.open_ambiguities[0]?.candidates?.[0];
    expect(candidate).toBeTruthy();

    const answered = await service.advance({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      draft_id: first.draft.draft_id,
      intent: { kind: "answer", text: candidate! },
      now: LATER,
    });
    expect(answered.draft.open_ambiguities).toHaveLength(0);
    expect(answered.recap.due_date).toBe(candidate);
    expect(answered.draft.state).toBe("RECAPITULATIF");
  });

  it("refuse la création sans confirmation explicite / nonce", async () => {
    const { service } = createSut();
    const draft = await service.advance({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      intent: { kind: "message", text: EXAMPLE_MESSAGE },
      now: NOW,
    });
    await expect(
      service.confirm({
        tenant_id: TENANT_A,
        actor_id: ACTOR_A,
        draft_id: draft.draft.draft_id,
        explicit_confirmation: true,
        confirmation_nonce: "wrong-nonce-xxxxxxxx",
        now: LATER,
      }),
    ).rejects.toBeInstanceOf(ProtectionDraftError);
  });

  it("crée atomiquement + rejeu idempotent sur double confirm", async () => {
    const { repo, service } = createSut();
    const draft = await service.advance({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      intent: { kind: "message", text: EXAMPLE_MESSAGE },
      now: NOW,
    });
    const nonce = draft.draft.confirmation_nonce;
    expect(nonce).toBeTruthy();

    const created = await service.confirm({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      draft_id: draft.draft.draft_id,
      explicit_confirmation: true,
      confirmation_nonce: nonce!,
      now: LATER,
    });
    expect(created.outcome).toBe("created");
    expect(created.state).toBe("TERMINE");
    expect(repo._clients.size).toBe(1);
    expect(repo._creances.size).toBe(1);

    const replay = await service.confirm({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      draft_id: draft.draft.draft_id,
      explicit_confirmation: true,
      confirmation_nonce: nonce!,
      now: LATER,
    });
    expect(replay.outcome).toBe("replay");
    expect(replay.client_payeur_id).toBe(created.client_payeur_id);
    expect(replay.creance_id).toBe(created.creance_id);
    expect(repo._clients.size).toBe(1);
    expect(repo._creances.size).toBe(1);
  });

  it("isole les brouillons cross-tenant", async () => {
    const { service } = createSut();
    const a = await service.advance({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      intent: { kind: "message", text: EXAMPLE_MESSAGE },
      now: NOW,
    });
    await expect(
      service.get({
        tenant_id: TENANT_B,
        draft_id: a.draft.draft_id,
        now: LATER,
      }),
    ).rejects.toBeInstanceOf(ProtectionDraftError);

    await expect(
      service.confirm({
        tenant_id: TENANT_B,
        actor_id: ACTOR_B,
        draft_id: a.draft.draft_id,
        explicit_confirmation: true,
        confirmation_nonce: a.draft.confirmation_nonce!,
        now: LATER,
      }),
    ).rejects.toBeInstanceOf(ProtectionDraftError);
  });

  it("ignore toute identité injectée côté appelant (tenant passé séparément)", async () => {
    const { service } = createSut();
    // Le service ne lit jamais tenant/actor depuis intent — uniquement input trusted.
    const result = await service.advance({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      intent: {
        kind: "message",
        text: EXAMPLE_MESSAGE,
      },
      now: NOW,
    });
    expect(result.draft.tenant_id).toBe(TENANT_A);
    expect(result.draft.actor_id).toBe(ACTOR_A);
  });

  it("annule un brouillon sans création métier", async () => {
    const { repo, service } = createSut();
    const draft = await service.advance({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      intent: { kind: "message", text: EXAMPLE_MESSAGE },
      now: NOW,
    });
    const cancelled = await service.cancel({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      draft_id: draft.draft.draft_id,
      now: LATER,
    });
    expect(cancelled.draft.state).toBe("ANNULE");
    expect(repo._clients.size).toBe(0);

    await expect(
      service.confirm({
        tenant_id: TENANT_A,
        actor_id: ACTOR_A,
        draft_id: draft.draft.draft_id,
        explicit_confirmation: true,
        confirmation_nonce: draft.draft.confirmation_nonce!,
        now: LATER,
      }),
    ).rejects.toBeInstanceOf(ProtectionDraftError);
  });

  it("expire un brouillon à la lecture après TTL", async () => {
    const { service } = createSut();
    const draft = await service.advance({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      intent: { kind: "message", text: EXAMPLE_MESSAGE },
      now: NOW,
    });
    const got = await service.get({
      tenant_id: TENANT_A,
      draft_id: draft.draft.draft_id,
      now: EXPIRED,
    });
    expect(got.draft.state).toBe("EXPIRE");
  });

  it("reprend une conversation existante (draft_id)", async () => {
    const { service } = createSut();
    const first = await service.advance({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      intent: {
        kind: "message",
        text: "Recevoir 200 € de Acme le 2026-09-01.",
      },
      now: NOW,
    });
    const resumed = await service.advance({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      draft_id: first.draft.draft_id,
      intent: { kind: "answer", text: "contact@acme.fr" },
      now: LATER,
    });
    expect(resumed.draft.draft_id).toBe(first.draft.draft_id);
    expect(resumed.recap.client_email).toBe("contact@acme.fr");
    expect(resumed.draft.fields.client_email?.provenance).toBe("user_provided");
  });

  it("accepte des pièces jointes métadonnées sans OCR", async () => {
    const { service } = createSut();
    const result = await service.advance({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      intent: {
        kind: "message",
        text: EXAMPLE_MESSAGE,
        attachments: [
          {
            attachment_id: "att_1",
            filename: "facture.pdf",
            content_type: "application/pdf",
            size_bytes: 12_345,
          },
        ],
      },
      now: NOW,
    });
    expect(result.draft.attachments).toHaveLength(1);
    expect(result.draft.attachments[0]?.filename).toBe("facture.pdf");
    // Pas de champ contenu / OCR
    expect(
      Object.keys(result.draft.attachments[0] as object).sort(),
    ).toEqual(["attachment_id", "content_type", "filename", "size_bytes"]);
  });

  it("valide email / montant / échéance sur correction", async () => {
    const { service } = createSut();
    const draft = await service.advance({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      intent: { kind: "message", text: EXAMPLE_MESSAGE },
      now: NOW,
    });
    await expect(
      service.advance({
        tenant_id: TENANT_A,
        actor_id: ACTOR_A,
        draft_id: draft.draft.draft_id,
        intent: { kind: "correction", field: "client_email", value: "nope" },
        now: LATER,
      }),
    ).rejects.toBeInstanceOf(ProtectionDraftError);
  });

  it("passe par CONFIRMATION_EXPLICITE via acknowledge_recap", async () => {
    const { service } = createSut();
    const draft = await service.advance({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      intent: { kind: "message", text: EXAMPLE_MESSAGE },
      now: NOW,
    });
    const ack = await service.advance({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      draft_id: draft.draft.draft_id,
      intent: { kind: "acknowledge_recap" },
      now: LATER,
    });
    expect(ack.draft.state).toBe("CONFIRMATION_EXPLICITE");
    expect(ack.draft.client_payeur_id).toBeNull();
  });

  it("marque les champs confirmed après confirm réussi", async () => {
    const { service } = createSut();
    const draft = await service.advance({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      intent: { kind: "message", text: EXAMPLE_MESSAGE },
      now: NOW,
    });
    await service.confirm({
      tenant_id: TENANT_A,
      actor_id: ACTOR_A,
      draft_id: draft.draft.draft_id,
      explicit_confirmation: true,
      confirmation_nonce: draft.draft.confirmation_nonce!,
      now: LATER,
    });
    const got = await service.get({
      tenant_id: TENANT_A,
      draft_id: draft.draft.draft_id,
      now: LATER,
    });
    expect(got.draft.state).toBe("TERMINE");
    expect(got.draft.fields.client_name?.provenance).toBe("confirmed");
    expect(got.draft.fields.expected_amount_minor?.provenance).toBe(
      "confirmed",
    );
  });
});
