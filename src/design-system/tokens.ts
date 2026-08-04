/**
 * Typed references to the official CSS tokens.
 *
 * Raw design values intentionally remain in tokens.css. TypeScript consumers
 * receive var() references so CSS stays the single source of truth.
 */

const cssVar = <TName extends string>(name: TName) => `var(${name})` as const;

export const colorTokens = {
  background: cssVar("--ds-color-background"),
  surface: cssVar("--ds-color-surface"),
  surfaceRaised: cssVar("--ds-color-surface-raised"),
  surfaceMuted: cssVar("--ds-color-surface-muted"),
  border: cssVar("--ds-color-border"),
  borderStrong: cssVar("--ds-color-border-strong"),
  textPrimary: cssVar("--ds-color-text-primary"),
  textSecondary: cssVar("--ds-color-text-secondary"),
  textMuted: cssVar("--ds-color-text-muted"),
  textInverse: cssVar("--ds-color-text-inverse"),
  brand: cssVar("--ds-color-brand"),
  accent: cssVar("--ds-color-accent"),
  accentHover: cssVar("--ds-color-accent-hover"),
  accentSoft: cssVar("--ds-color-accent-soft"),
  accentSoftHover: cssVar("--ds-color-accent-soft-hover"),
  accentBorder: cssVar("--ds-color-accent-border"),
  success: cssVar("--ds-color-success"),
  warning: cssVar("--ds-color-warning"),
  danger: cssVar("--ds-color-danger"),
  info: cssVar("--ds-color-info"),
  focusRing: cssVar("--ds-color-focus-ring"),
  overlay: cssVar("--ds-color-overlay"),
} as const;

export const spacingTokens = {
  1: cssVar("--ds-space-1"),
  2: cssVar("--ds-space-2"),
  3: cssVar("--ds-space-3"),
  4: cssVar("--ds-space-4"),
  5: cssVar("--ds-space-5"),
  6: cssVar("--ds-space-6"),
  8: cssVar("--ds-space-8"),
  10: cssVar("--ds-space-10"),
  12: cssVar("--ds-space-12"),
  16: cssVar("--ds-space-16"),
  20: cssVar("--ds-space-20"),
  24: cssVar("--ds-space-24"),
} as const;

export const radiusTokens = {
  sm: cssVar("--ds-radius-sm"),
  md: cssVar("--ds-radius-md"),
  lg: cssVar("--ds-radius-lg"),
  xl: cssVar("--ds-radius-xl"),
  "2xl": cssVar("--ds-radius-2xl"),
  pill: cssVar("--ds-radius-pill"),
} as const;

export const shadowTokens = {
  none: cssVar("--ds-shadow-none"),
  xs: cssVar("--ds-shadow-xs"),
  sm: cssVar("--ds-shadow-sm"),
  md: cssVar("--ds-shadow-md"),
  lg: cssVar("--ds-shadow-lg"),
  xl: cssVar("--ds-shadow-xl"),
} as const;

export const motionTokens = {
  duration: {
    fast: cssVar("--ds-duration-fast"),
    normal: cssVar("--ds-duration-normal"),
    slow: cssVar("--ds-duration-slow"),
  },
  easing: {
    standard: cssVar("--ds-ease-standard"),
    entrance: cssVar("--ds-ease-entrance"),
    exit: cssVar("--ds-ease-exit"),
    emphasis: cssVar("--ds-ease-emphasis"),
  },
} as const;

export const layoutTokens = {
  sidebarWidth: cssVar("--ds-layout-sidebar-width"),
  contentWidth: cssVar("--ds-layout-content-width"),
  conversationWidth: cssVar("--ds-layout-conversation-width"),
  conversationPanelWidth: cssVar("--ds-layout-conversation-panel-width"),
  conversationResponseWidth: cssVar("--ds-layout-conversation-response-width"),
  businessCardWidth: cssVar("--ds-layout-business-card-width"),
  panelWidth: cssVar("--ds-layout-panel-width"),
  containerWidth: cssVar("--ds-layout-container-width"),
  gutters: {
    mobile: cssVar("--ds-layout-gutter-mobile"),
    tablet: cssVar("--ds-layout-gutter-tablet"),
    desktop: cssVar("--ds-layout-gutter-desktop"),
  },
  breakpoints: {
    sm: cssVar("--ds-breakpoint-sm"),
    md: cssVar("--ds-breakpoint-md"),
    lg: cssVar("--ds-breakpoint-lg"),
    xl: cssVar("--ds-breakpoint-xl"),
  },
} as const;

export const typographyRoles = [
  "display",
  "h1",
  "h2",
  "h3",
  "title",
  "body",
  "bodySmall",
  "caption",
  "label",
  "code",
] as const;

export type TypographyRole = (typeof typographyRoles)[number];

export const designTokens = {
  color: colorTokens,
  spacing: spacingTokens,
  radius: radiusTokens,
  shadow: shadowTokens,
  motion: motionTokens,
  layout: layoutTokens,
} as const;
