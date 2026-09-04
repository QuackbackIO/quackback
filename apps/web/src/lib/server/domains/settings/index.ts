/**
 * Settings domain module exports
 *
 * IMPORTANT: This barrel export only includes types and constants.
 * Service functions that access the database are NOT exported here to prevent
 * them from being bundled into the client.
 *
 * For service functions, import directly from './settings.service' in server-only code
 * (server functions, API routes, etc.)
 */

// Config types (no DB dependency)
export type {
  OAuthProviders,
  AuthConfig,
  PortalFeatures,
  PortalConfig,
  PortalAccessConfig,
  PortalNavConfig,
  PortalNavItemConfig,
  PortalNavItemType,
  PortalWelcomeCard,
  HeaderDisplayMode,
  ThemeColors,
  BrandingConfig,
  UpdateAuthConfigInput,
  UpdatePortalConfigInput,
  PublicAuthConfig,
  PublicPortalConfig,
  DeveloperConfig,
  UpdateDeveloperConfigInput,
  WidgetConfig,
  PublicWidgetConfig,
  UpdateWidgetConfigInput,
  HelpCenterConfig,
  HelpCenterHeaderLink,
  HelpCenterSeoConfig,
  HelpCenterDomainConfig,
  HelpCenterLocalesConfig,
  HelpCenterLocaleChromeStrings,
  HelpCenterAutoTranslateConfig,
} from './settings.types'

// Welcome card constants (no DB dependency)
export { EMPTY_WELCOME_BODY } from './settings.types'

// Default config values (no DB dependency)
export {
  DEFAULT_AUTH_CONFIG,
  DEFAULT_PORTAL_CONFIG,
  DEFAULT_DEVELOPER_CONFIG,
  DEFAULT_WIDGET_CONFIG,
  DEFAULT_HELP_CENTER_CONFIG,
  DEFAULT_HELP_CENTER_SEO_CONFIG,
} from './settings.types'

// Consolidated workspace settings type (in types.ts to avoid server dep leak via barrel)
export type { WorkspaceSettings, SettingsBrandingData } from './settings.types'

// Verified-domain type — no DB dependency, safe for client-side consumption
export type { VerifiedDomain } from './settings.types'

// Tier limits — type + OSS defaults are barrel-safe (no DB dep).
// The resolver service (tier-limits.service.ts) must NOT be exported here;
// import it directly in server-only code to avoid leaking DB into the client bundle.
export type { TierLimits, TierLimit, TierFeatureFlags } from './tier-limits.types'
export { OSS_TIER_LIMITS } from './tier-limits.types'

// Cloud config — plans and entitlements. Types, catalogues and the disabled
// default are pure data with no DB dependency, so they are barrel-safe. The
// resolver (cloud.service.ts) and the gate (entitlements.ts) must NOT be
// exported here; import them directly in server-only code.
export type {
  CloudConfig,
  BillingStatus,
  PlanId,
  PlanIdAlias,
  PlanDefinition,
  EntitlementKey,
  EntitlementDefinition,
} from './cloud/cloud.types'
export {
  PLAN_IDS,
  PLAN_ID_ALIASES,
  PLAN_CATALOGUE,
  PLAN_DEFINITIONS,
  ENTITLEMENTS,
  ENTITLEMENT_KEYS,
  DISABLED_CLOUD_CONFIG,
  minimumPlanFor,
  isPlanId,
  canonicalPlanId,
  isEntitlementKey,
} from './cloud/cloud.types'
