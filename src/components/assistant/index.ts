export { AssistantShell } from "./assistant-shell";
export { COMPOSER_MAX_LENGTH, Composer } from "./composer";
export { ComposerShortcuts } from "./composer-shortcuts";
export { ConversationalWorkspace } from "./conversational-workspace";
export { getDemoWorkspaceState, isDemoStateId } from "./demo-states";
export {
  ProtectionPanel,
  mapDraftOutputToPanel,
  protectionDraftApi,
} from "./protection-panel";
export {
  getComposerShortcuts,
  resolveShortcutPhase,
  shouldShowContextPanel,
  shouldShowWelcomeState,
} from "./shortcuts";
export {
  buildWelcomeSummaryLines,
  FALLBACK_WELCOME_SUMMARY,
} from "./welcome-summary";
export type {
  ActiveContext,
  AssistantMessage,
  AssistantViewport,
  ComposerShortcut,
  DemoStateId,
  ProtectionContextData,
} from "./types";
