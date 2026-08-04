export {
  closeAccount,
  exportAccountData,
  type AccountAdminClient,
  type AccountSessionClient,
  type CloseAccountInput,
} from "./service";

export {
  ACCOUNT_CLOSURE_LEGAL_NOTICE,
  buildAccountExportFilename,
  summariseAccountClosure,
} from "./reporting";

export type {
  AccountClosureReport,
  AccountExport,
  AccountLifecycleErrorCode,
  AccountResult,
} from "./types";
