/**
 * Types du cycle de vie d'un compte prestataire.
 *
 * Aucune fonction de ce module ne reçoit d'identifiant de tenant : le compte
 * concerné est toujours celui de la session serveur, dérivé côté SQL depuis
 * `auth.uid()`.
 */

export type AccountLifecycleErrorCode =
  | "account_not_authenticated"
  | "account_not_found"
  | "account_closed"
  | "account_export_unavailable"
  | "account_closure_unavailable"
  | "account_confirmation_mismatch";

export type AccountResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly code: AccountLifecycleErrorCode;
      readonly message: string;
    };

/**
 * Export JSON du compte. La forme exacte est produite par
 * `public.export_current_account_data()` ; on ne la retype pas champ à champ
 * ici pour éviter deux vérités divergentes.
 */
export type AccountExport = {
  schema_version: number;
  generated_at: string;
  notice: Record<string, string>;
  profile: Record<string, unknown>;
  clients: unknown[];
  creances: unknown[];
  payment_attempts: unknown[];
  payments: unknown[];
  conversations: unknown[];
  messages: unknown[];
  documents: unknown[];
};

/**
 * Compte rendu de clôture.
 *
 * `retainedForLegalObligation` n'est pas décoratif : il est la preuve que la
 * clôture est une anonymisation PARTIELLE. Toute interface qui l'ignorerait
 * annoncerait un effacement qui n'a pas eu lieu.
 */
export type AccountClosureReport = {
  prestataireId: string;
  alreadyClosed: boolean;
  closedAt: string | null;
  anonymised: {
    profileIdentity: boolean;
    documentsSoftDeleted: number;
    messagesErased: number;
    conversationsCleared: number;
  };
  retainedForLegalObligation: {
    clients: number;
    creances: number;
    payments: number;
  };
  /**
   * `false` quand les lignes `document` sont marquées supprimées mais que les
   * octets n'ont pas pu être retirés du bucket. L'écart est remonté, jamais
   * masqué derrière un succès.
   */
  storageObjectsRemoved: boolean;
  storageObjectsCount: number;
  /**
   * `false` quand l'identité Auth (email de connexion, sessions) n'a pas pu
   * être neutralisée : le compte est alors clos en base mais l'utilisateur
   * pourrait encore se présenter.
   */
  authIdentityRevoked: boolean;
};
