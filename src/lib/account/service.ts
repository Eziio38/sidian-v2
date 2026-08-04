/**
 * Export et clôture d'un compte prestataire.
 *
 * Règle structurante : aucune fonction ne prend d'identifiant de tenant. Les
 * deux RPC sous-jacentes dérivent le prestataire de `auth.uid()`, donc du
 * client **session** qui leur est passé. Le client service_role n'intervient
 * que pour deux effets que SQL ne peut pas produire : retirer les octets du
 * bucket et neutraliser l'identité Auth.
 */

import { DOCUMENT_STORAGE_BUCKET } from "@/lib/documents/schemas";

import type {
  AccountClosureReport,
  AccountExport,
  AccountResult,
} from "./types";

type RpcResult = {
  data: unknown;
  error: { message?: string } | null;
};

/** Client porteur de la session utilisateur — c'est lui qui définit le tenant. */
export type AccountSessionClient = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult>;
};

/** Client service_role — effets hors SQL uniquement, jamais pour lire un tenant. */
export type AccountAdminClient = {
  storage: {
    from(bucket: string): {
      remove(paths: string[]): PromiseLike<{ error: { message?: string } | null }>;
    };
  };
  auth: {
    admin: {
      updateUserById(
        userId: string,
        attributes: Record<string, unknown>,
      ): PromiseLike<{ error: { message?: string } | null }>;
    };
  };
};

const EXPORT_FAILURE_MESSAGE =
  "L’export de vos données n’a pas pu être produit pour le moment.";
const CLOSURE_FAILURE_MESSAGE =
  "La clôture du compte n’a pas pu être effectuée pour le moment.";

function rpcErrorResult<T>(
  message: string | undefined,
  fallbackCode: "account_export_unavailable" | "account_closure_unavailable",
  fallbackMessage: string,
): AccountResult<T> {
  const raw = message ?? "";
  if (raw.includes("not_authenticated")) {
    return {
      ok: false,
      code: "account_not_authenticated",
      message: "Authentification requise.",
    };
  }
  if (raw.includes("prestataire_not_found")) {
    return {
      ok: false,
      code: "account_not_found",
      message: "Aucun compte n’est associé à cette session.",
    };
  }
  if (raw.includes("account_closed")) {
    return {
      ok: false,
      code: "account_closed",
      message: "Ce compte est clôturé.",
    };
  }
  // Le texte brut de la base n'est jamais renvoyé : il peut nommer des
  // fonctions, des contraintes ou des colonnes.
  return { ok: false, code: fallbackCode, message: fallbackMessage };
}

export async function exportAccountData(
  session: AccountSessionClient,
): Promise<AccountResult<AccountExport>> {
  let result: RpcResult;
  try {
    result = await session.rpc("export_current_account_data");
  } catch (cause) {
    return rpcErrorResult(
      cause instanceof Error ? cause.message : undefined,
      "account_export_unavailable",
      EXPORT_FAILURE_MESSAGE,
    );
  }

  if (result.error) {
    return rpcErrorResult(
      result.error.message,
      "account_export_unavailable",
      EXPORT_FAILURE_MESSAGE,
    );
  }

  if (!result.data || typeof result.data !== "object") {
    return {
      ok: false,
      code: "account_export_unavailable",
      message: EXPORT_FAILURE_MESSAGE,
    };
  }

  return { ok: true, value: result.data as AccountExport };
}

type ClosureRpcPayload = {
  prestataire_id?: unknown;
  already_closed?: unknown;
  closed_at?: unknown;
  anonymised?: {
    profile_identity?: unknown;
    documents_soft_deleted?: unknown;
    messages_erased?: unknown;
    conversations_cleared?: unknown;
  };
  retained_for_legal_obligation?: {
    clients?: unknown;
    creances?: unknown;
    payments?: unknown;
  };
  storage_paths?: unknown;
};

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export type CloseAccountInput = {
  session: AccountSessionClient;
  admin: AccountAdminClient;
  /** Identifiant Auth du titulaire, résolu par l'appelant depuis la session. */
  userId: string;
};

/**
 * Clôture et anonymise le compte de la session.
 *
 * L'ordre est délibéré : la RPC d'abord (elle est transactionnelle et fait foi),
 * puis les effets externes. Si l'un d'eux échoue, la clôture reste acquise et
 * l'écart est remonté dans le rapport — on ne prétend jamais que les octets ont
 * disparu ni que l'accès est révoqué si ce n'est pas le cas.
 */
export async function closeAccount(
  input: CloseAccountInput,
): Promise<AccountResult<AccountClosureReport>> {
  let result: RpcResult;
  try {
    result = await input.session.rpc("close_current_account");
  } catch (cause) {
    return rpcErrorResult(
      cause instanceof Error ? cause.message : undefined,
      "account_closure_unavailable",
      CLOSURE_FAILURE_MESSAGE,
    );
  }

  if (result.error) {
    return rpcErrorResult(
      result.error.message,
      "account_closure_unavailable",
      CLOSURE_FAILURE_MESSAGE,
    );
  }

  const payload = (result.data ?? {}) as ClosureRpcPayload;
  const prestataireId =
    typeof payload.prestataire_id === "string" ? payload.prestataire_id : null;
  if (prestataireId === null) {
    return {
      ok: false,
      code: "account_closure_unavailable",
      message: CLOSURE_FAILURE_MESSAGE,
    };
  }

  const storagePaths = Array.isArray(payload.storage_paths)
    ? payload.storage_paths.filter(
        (path): path is string => typeof path === "string",
      )
    : [];

  let storageObjectsRemoved = true;
  if (storagePaths.length > 0) {
    try {
      const { error } = await input.admin.storage
        .from(DOCUMENT_STORAGE_BUCKET)
        .remove(storagePaths);
      storageObjectsRemoved = !error;
    } catch {
      storageObjectsRemoved = false;
    }
  }

  // Révocation d'accès côté Auth. `current_prestataire_id()` ne résout déjà
  // plus pour un compte clos, mais tant que l'identité Auth existe, l'email
  // d'origine reste stocké dans auth.users — ce qui contredirait
  // l'anonymisation.
  let authIdentityRevoked = true;
  try {
    const { error } = await input.admin.auth.admin.updateUserById(
      input.userId,
      {
        email: `compte-clos+${prestataireId}@sidian.invalid`,
        email_confirm: true,
        // Ban très long plutôt que suppression : `prestataire.user_id` est en
        // `on delete restrict`, un delete échouerait et emporterait la clôture.
        ban_duration: "876000h",
        user_metadata: { account_closed: true },
      },
    );
    authIdentityRevoked = !error;
  } catch {
    authIdentityRevoked = false;
  }

  return {
    ok: true,
    value: {
      prestataireId,
      alreadyClosed: payload.already_closed === true,
      closedAt: typeof payload.closed_at === "string" ? payload.closed_at : null,
      anonymised: {
        profileIdentity: payload.anonymised?.profile_identity === true,
        documentsSoftDeleted: count(payload.anonymised?.documents_soft_deleted),
        messagesErased: count(payload.anonymised?.messages_erased),
        conversationsCleared: count(payload.anonymised?.conversations_cleared),
      },
      retainedForLegalObligation: {
        clients: count(payload.retained_for_legal_obligation?.clients),
        creances: count(payload.retained_for_legal_obligation?.creances),
        payments: count(payload.retained_for_legal_obligation?.payments),
      },
      storageObjectsRemoved,
      storageObjectsCount: storagePaths.length,
      authIdentityRevoked,
    },
  };
}
