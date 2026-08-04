/**
 * G1-M — service domaine Conversation-to-Protection Draft.
 *
 * Tenant / actor uniquement depuis TrustedExecutionContext (passés par l’exécuteur).
 * Extraction = brouillon seulement ; création métier uniquement via confirm().
 */

import { randomBytes, randomUUID } from "node:crypto";

import { extractProtectionDraftFromMessage } from "./extraction";
import { ProtectionDraftError } from "./errors";
import {
  applyCorrection,
  buildRecap,
  buildTargetedQuestion,
  computeMissingFields,
  markFieldsConfirmed,
  mergeAttachments,
  mergeFields,
  resolveAmbiguityOnAnswer,
} from "./fields";
import type { ProtectionDraftRepository } from "./repository";
import { createSupabaseProtectionDraftRepository } from "./supabase-repository";
import type { ProtectionDraftPersistenceClient } from "./supabase-repository";
import {
  canAdvance,
  canConfirm,
  isTerminalState,
  nextStateAfterUpdate,
  stateAfterAcknowledgeRecap,
} from "./state-machine";
import type {
  AdvanceIntent,
  DraftFields,
  OpenAmbiguity,
  ProtectionDraftRecord,
  ProtectionDraftService,
  ProtectionDraftState,
} from "./types";
import {
  canonicalizeDraftEmail,
  normalizeClientName,
  parseAmountEurosToMinor,
  validateAmountMinor,
  validateCurrency,
  validateIsoDate,
} from "./validation";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function addMs(iso: string, ms: number): string {
  const t = new Date(iso).getTime();
  return new Date(t + ms).toISOString();
}

function newNonce(): string {
  return randomBytes(16).toString("base64url");
}

function emptyDraftSeed(now: string, expiresAt: string): Omit<
  ProtectionDraftRecord,
  "draft_id" | "tenant_id" | "actor_id"
> {
  return {
    conversation_id: null,
    state: "MESSAGE_RECU",
    fields: {},
    missing_fields: [
      "client_name",
      "client_email",
      "expected_amount_minor",
      "currency",
      "due_date",
    ],
    pending_question: null,
    open_ambiguities: [],
    attachments: [],
    client_creation_key: null,
    creance_creation_key: null,
    confirmation_nonce: null,
    confirmed_at: null,
    client_payeur_id: null,
    creance_id: null,
    expires_at: expiresAt,
    cancelled_at: null,
    created_at: now,
    updated_at: now,
  };
}

function applyAnswerToMissing(
  fields: DraftFields,
  missing: string[],
  text: string,
  now: string,
): DraftFields {
  if (missing.length === 0) return fields;
  const target = missing[0]!;
  try {
    if (target === "client_name") {
      return {
        ...fields,
        client_name: {
          value: normalizeClientName(text),
          provenance: "user_provided",
          updated_at: now,
        },
      };
    }
    if (target === "client_email") {
      return {
        ...fields,
        client_email: {
          value: canonicalizeDraftEmail(text),
          provenance: "user_provided",
          updated_at: now,
        },
      };
    }
    if (target === "expected_amount_minor") {
      const minor = /^\d+$/.test(text.trim())
        ? validateAmountMinor(Number(text.trim()))
        : parseAmountEurosToMinor(text);
      return {
        ...fields,
        expected_amount_minor: {
          value: minor,
          provenance: "user_provided",
          updated_at: now,
        },
        currency: fields.currency ?? {
          value: "EUR",
          provenance: "user_provided",
          updated_at: now,
        },
      };
    }
    if (target === "currency") {
      return {
        ...fields,
        currency: {
          value: validateCurrency(text),
          provenance: "user_provided",
          updated_at: now,
        },
      };
    }
    if (target === "due_date") {
      return {
        ...fields,
        due_date: {
          value: validateIsoDate(text.trim()),
          provenance: "user_provided",
          updated_at: now,
        },
      };
    }
  } catch (err) {
    if (err instanceof ProtectionDraftError) throw err;
    throw new ProtectionDraftError("PROTECTION_DRAFT_VALIDATION_FAILED");
  }
  return fields;
}

export function createProtectionDraftService(
  repository: ProtectionDraftRepository,
  options?: { ttlMs?: number },
): ProtectionDraftService {
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;

  async function loadOrCreate(input: {
    tenant_id: string;
    actor_id: string;
    draft_id?: string;
    conversation_id?: string;
    now: string;
  }): Promise<ProtectionDraftRecord> {
    if (input.draft_id) {
      const existing = await repository.get({
        tenant_id: input.tenant_id,
        draft_id: input.draft_id,
        now: input.now,
      });
      if (existing.tenant_id !== input.tenant_id) {
        throw new ProtectionDraftError("PROTECTION_DRAFT_TENANT_MISMATCH");
      }
      return existing;
    }
    const expires = addMs(input.now, ttlMs);
    const seed = emptyDraftSeed(input.now, expires);
    return repository.upsert({
      tenant_id: input.tenant_id,
      actor_id: input.actor_id,
      conversation_id: input.conversation_id ?? null,
      state: seed.state,
      fields: seed.fields,
      missing_fields: seed.missing_fields,
      pending_question: seed.pending_question,
      open_ambiguities: seed.open_ambiguities,
      attachments: seed.attachments,
      expires_at: expires,
      now: input.now,
    });
  }

  async function persistUpdate(
    draft: ProtectionDraftRecord,
    patch: {
      state: ProtectionDraftRecord["state"];
      fields: DraftFields;
      open_ambiguities: OpenAmbiguity[];
      attachments?: ProtectionDraftRecord["attachments"];
      confirmation_nonce?: string | null;
      client_creation_key?: string | null;
      creance_creation_key?: string | null;
    },
    now: string,
  ): Promise<ProtectionDraftRecord> {
    const missing = computeMissingFields(patch.fields, patch.open_ambiguities);
    const question = buildTargetedQuestion(missing, patch.open_ambiguities);
    let nonce = patch.confirmation_nonce ?? draft.confirmation_nonce;
    let clientKey = patch.client_creation_key ?? draft.client_creation_key;
    let creanceKey = patch.creance_creation_key ?? draft.creance_creation_key;

    if (
      (patch.state === "RECAPITULATIF" ||
        patch.state === "BROUILLON_COMPLET" ||
        patch.state === "CONFIRMATION_EXPLICITE") &&
      missing.length === 0 &&
      patch.open_ambiguities.length === 0
    ) {
      nonce = nonce ?? newNonce();
      clientKey = clientKey ?? randomUUID();
      creanceKey = creanceKey ?? randomUUID();
    }

    return repository.upsert({
      tenant_id: draft.tenant_id,
      actor_id: draft.actor_id,
      draft_id: draft.draft_id,
      conversation_id: draft.conversation_id,
      state: patch.state,
      fields: patch.fields,
      missing_fields: missing,
      pending_question: question,
      open_ambiguities: patch.open_ambiguities,
      attachments: patch.attachments ?? draft.attachments,
      client_creation_key: clientKey,
      creance_creation_key: creanceKey,
      confirmation_nonce: nonce,
      expires_at: draft.expires_at,
      now,
    });
  }

  return {
    async advance(input) {
      const draft = await loadOrCreate(input);
      if (draft.state === "EXPIRE") {
        throw new ProtectionDraftError("PROTECTION_DRAFT_EXPIRED");
      }
      if (draft.state === "ANNULE") {
        throw new ProtectionDraftError("PROTECTION_DRAFT_CANCELLED");
      }
      if (!canAdvance(draft.state) && draft.state !== "TERMINE") {
        throw new ProtectionDraftError("PROTECTION_DRAFT_NOT_CONFIRMABLE");
      }
      if (draft.state === "TERMINE") {
        return {
          draft,
          recap: buildRecap(draft),
          targeted_question: null,
        };
      }

      const intent: AdvanceIntent = input.intent;
      let fields = draft.fields;
      let ambiguities = [...draft.open_ambiguities];
      let attachments = draft.attachments;
      let state: ProtectionDraftState = draft.state;

      if (intent.kind === "message") {
        state = "EXTRACTION_BROUILLON";
        const extracted = extractProtectionDraftFromMessage(
          intent.text,
          input.now,
        );
        fields = mergeFields(fields, extracted.fields, "agent_proposed");
        ambiguities = [...ambiguities, ...extracted.ambiguities];
        // Dédup ambiguïtés par kind
        const seen = new Set<string>();
        ambiguities = ambiguities.filter((a) => {
          const k = `${a.kind}:${a.message}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        attachments = mergeAttachments(attachments, intent.attachments);
        // Si message répond aussi à un missing (ex. email seul)
        const missingBefore = computeMissingFields(fields, ambiguities);
        if (
          missingBefore.length > 0 &&
          extracted.not_found.includes(missingBefore[0]!) === false
        ) {
          // extraction a déjà rempli
        } else if (
          missingBefore.length > 0 &&
          extracted.fields[missingBefore[0] as keyof typeof extracted.fields] ===
            undefined
        ) {
          // tente d’interpréter le texte comme réponse au champ manquant
          // uniquement si extraction n’a rien trouvé de nouveau pour ce champ
        }
      } else if (intent.kind === "apply_extraction") {
        // G1-N — champs déjà validés (LLM + domaine) ; pas de ré-extraction.
        state = "EXTRACTION_BROUILLON";
        fields = mergeFields(fields, intent.fields, "agent_proposed");
        ambiguities = [...ambiguities, ...(intent.ambiguities ?? [])];
        const seenApply = new Set<string>();
        ambiguities = ambiguities.filter((a) => {
          const k = `${a.kind}:${a.message}`;
          if (seenApply.has(k)) return false;
          seenApply.add(k);
          return true;
        });
        attachments = mergeAttachments(attachments, intent.attachments);
      } else if (intent.kind === "correction") {
        fields = applyCorrection(
          fields,
          intent.field,
          intent.value,
          input.now,
        );
        // Une correction due_date / currency / amount lève l’ambiguïté correspondante
        if (intent.field === "due_date") {
          ambiguities = ambiguities.filter((a) => a.kind !== "due_date");
        }
        if (intent.field === "currency") {
          ambiguities = ambiguities.filter((a) => a.kind !== "currency");
        }
        if (intent.field === "expected_amount_minor") {
          ambiguities = ambiguities.filter((a) => a.kind !== "amount");
        }
      } else if (intent.kind === "answer") {
        if (ambiguities.length > 0) {
          const resolved = resolveAmbiguityOnAnswer(
            ambiguities,
            intent.text,
            input.now,
          );
          fields = mergeFields(fields, resolved.fields, "user_provided");
          ambiguities = resolved.remaining;
        } else {
          const missing = computeMissingFields(fields, ambiguities);
          fields = applyAnswerToMissing(
            fields,
            missing,
            intent.text,
            input.now,
          );
        }
      } else if (intent.kind === "acknowledge_recap") {
        const missing = computeMissingFields(fields, ambiguities);
        if (missing.length > 0 || ambiguities.length > 0) {
          throw new ProtectionDraftError("PROTECTION_DRAFT_NOT_READY");
        }
        state = stateAfterAcknowledgeRecap(
          state === "RECAPITULATIF" ? state : "RECAPITULATIF",
        );
        const updated = await persistUpdate(
          draft,
          {
            state,
            fields,
            open_ambiguities: ambiguities,
            attachments,
          },
          input.now,
        );
        return {
          draft: updated,
          recap: buildRecap(updated),
          targeted_question: updated.pending_question,
        };
      }

      const missing = computeMissingFields(fields, ambiguities);
      state = nextStateAfterUpdate({
        missingCount: missing.length,
        ambiguityCount: ambiguities.length,
        previous: state,
      });
      // Si complet mais pas encore acknowledge → BROUILLON_COMPLET puis RECAP
      if (missing.length === 0 && ambiguities.length === 0) {
        state = "RECAPITULATIF";
      }

      const updated = await persistUpdate(
        draft,
        { state, fields, open_ambiguities: ambiguities, attachments },
        input.now,
      );

      return {
        draft: updated,
        recap: buildRecap(updated),
        targeted_question: updated.pending_question,
      };
    },

    async get(input) {
      const draft = await repository.get(input);
      if (draft.tenant_id !== input.tenant_id) {
        throw new ProtectionDraftError("PROTECTION_DRAFT_TENANT_MISMATCH");
      }
      return { draft, recap: buildRecap(draft) };
    },

    async cancel(input) {
      const draft = await repository.cancel(input);
      return { draft };
    },

    async confirm(input) {
      if (input.explicit_confirmation !== true) {
        throw new ProtectionDraftError(
          "PROTECTION_DRAFT_CONFIRMATION_REQUIRED",
        );
      }
      const current = await repository.get({
        tenant_id: input.tenant_id,
        draft_id: input.draft_id,
        now: input.now,
      });
      if (current.tenant_id !== input.tenant_id) {
        throw new ProtectionDraftError("PROTECTION_DRAFT_TENANT_MISMATCH");
      }
      if (isTerminalState(current.state) && current.state !== "TERMINE") {
        throw new ProtectionDraftError("PROTECTION_DRAFT_NOT_CONFIRMABLE");
      }
      if (current.state !== "TERMINE" && !canConfirm(current.state)) {
        throw new ProtectionDraftError("PROTECTION_DRAFT_NOT_READY");
      }

      // Marque provenance confirmée avant création (si pas déjà TERMINE)
      if (current.state !== "TERMINE") {
        const confirmedFields = markFieldsConfirmed(current.fields, input.now);
        await repository.upsert({
          tenant_id: current.tenant_id,
          actor_id: current.actor_id,
          draft_id: current.draft_id,
          conversation_id: current.conversation_id,
          state: "CONFIRMATION_EXPLICITE",
          fields: confirmedFields,
          missing_fields: current.missing_fields,
          pending_question: null,
          open_ambiguities: current.open_ambiguities,
          attachments: current.attachments,
          client_creation_key: current.client_creation_key,
          creance_creation_key: current.creance_creation_key,
          confirmation_nonce: current.confirmation_nonce,
          expires_at: current.expires_at,
          now: input.now,
        });
      }

      return repository.confirm({
        tenant_id: input.tenant_id,
        actor_id: input.actor_id,
        draft_id: input.draft_id,
        confirmation_nonce: input.confirmation_nonce,
        now: input.now,
      });
    },
  };
}

export function createSupabaseProtectionDraftService(
  client: ProtectionDraftPersistenceClient,
  options?: { ttlMs?: number },
): ProtectionDraftService {
  return createProtectionDraftService(
    createSupabaseProtectionDraftRepository(client),
    options,
  );
}
