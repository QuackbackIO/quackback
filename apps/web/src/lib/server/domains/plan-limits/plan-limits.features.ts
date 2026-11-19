/**
 * The plan feature key space: one name per paid feature, mapped to the tier
 * feature flag and/or the plan entitlement that grants it today.
 *
 * A plan "has" a key when the gates it is checked by today are open: the tier
 * feature flag and/or the entitlement. Most keys need every gate they map to.
 * Two keys follow the one gate their runtime path reads: single sign-on reads
 * the tier flag (`registered-providers.ts`) and the MCP server reads the
 * entitlement (`mcp/handler.ts`). On an install without plan billing
 * every gate is open, so every key is live.
 *
 * `grace` says whether a feature that ran on the previous plan keeps running
 * through the grace after a drop. Features that stop at once on a drop (MCP,
 * AI insights, the audit log, analytics exports) are not grace features: they
 * have no live state a customer depends on.
 */

import type { TierFeatureFlags } from '@/lib/server/domains/settings/tier-limits.types'
import type { CloudConfig, EntitlementKey } from '@/lib/server/domains/settings/cloud/cloud.types'
import { CUSTOM_DOMAINS_HREF, PORTAL_SETTINGS_PATH } from '@/lib/shared/portal-settings-tabs'

export interface PlanFeatureDefinition {
  tierFeature: keyof TierFeatureFlags | null
  entitlement: EntitlementKey | null
  grace: boolean
  /** Which gate decides when a key has both. Default: both must be open. */
  gate?: 'tier' | 'entitlement'
}

export const PLAN_FEATURES = {
  customDomain: { tierFeature: 'customDomain', entitlement: 'customDomain', grace: true },
  sso: { tierFeature: 'customOidcProvider', entitlement: 'sso', grace: true, gate: 'tier' },
  webhooks: { tierFeature: 'webhooks', entitlement: 'webhooks', grace: true },
  workflows: { tierFeature: null, entitlement: 'workflows', grace: true },
  integrations: { tierFeature: 'integrations', entitlement: null, grace: true },
  customCss: { tierFeature: 'customCss', entitlement: null, grace: true },
  aiAssistant: { tierFeature: null, entitlement: 'aiAssistant', grace: true },
  aiArticleTranslation: { tierFeature: null, entitlement: 'aiArticleTranslation', grace: true },
  mcpServer: {
    tierFeature: 'mcpServer',
    entitlement: 'mcpServer',
    grace: false,
    gate: 'entitlement',
  },
  aiInsights: { tierFeature: null, entitlement: 'aiInsights', grace: false },
  aiDrafts: { tierFeature: null, entitlement: 'aiDrafts', grace: false },
  apiAccess: { tierFeature: null, entitlement: 'apiAccess', grace: false },
  auditLog: { tierFeature: null, entitlement: 'auditLog', grace: false },
  analyticsExports: { tierFeature: 'analyticsExports', entitlement: null, grace: false },
  customColors: { tierFeature: 'customColors', entitlement: null, grace: false },
  visitorAnalytics: { tierFeature: 'visitorAnalytics', entitlement: null, grace: false },
} as const satisfies Record<string, PlanFeatureDefinition>

export type PlanFeatureKey = keyof typeof PLAN_FEATURES

export const PLAN_FEATURE_KEYS = Object.keys(PLAN_FEATURES) as PlanFeatureKey[]

/** Which plan features are on. Every key is present. */
export type PlanFeatureSet = Record<PlanFeatureKey, boolean>

export function isPlanFeatureKey(value: string): value is PlanFeatureKey {
  return Object.prototype.hasOwnProperty.call(PLAN_FEATURES, value)
}

/** Whether `config` grants `key`: always on an install without plan billing. */
function entitled(config: CloudConfig, key: EntitlementKey): boolean {
  if (!config.enabled) return true
  return config.entitlements[key] === true
}

/** The feature set a plan grants, from its tier feature flags and entitlements. */
export function planFeatureSet(features: TierFeatureFlags, config: CloudConfig): PlanFeatureSet {
  const set = {} as PlanFeatureSet
  for (const key of PLAN_FEATURE_KEYS) {
    const definition: PlanFeatureDefinition = PLAN_FEATURES[key]
    const tierOn =
      definition.tierFeature && definition.gate !== 'entitlement'
        ? features[definition.tierFeature] === true
        : true
    const entitlementOn =
      definition.entitlement && definition.gate !== 'tier'
        ? entitled(config, definition.entitlement)
        : true
    set[key] = tierOn && entitlementOn
  }
  return set
}

/** Where each paid feature that can pause is set up, and its name on the Plan limits page. */
export const PLAN_FEATURE_LINKS: Partial<Record<PlanFeatureKey, { label: string; href: string }>> =
  {
    customDomain: { label: 'Custom domain', href: CUSTOM_DOMAINS_HREF },
    sso: { label: 'Single sign-on', href: '/admin/settings/security/sso' },
    webhooks: { label: 'Webhooks', href: '/admin/settings/developers' },
    workflows: { label: 'Workflows', href: '/admin/settings/workflows' },
    integrations: { label: 'Integrations', href: '/admin/settings/integrations' },
    customCss: { label: 'Custom CSS', href: PORTAL_SETTINGS_PATH },
    aiAssistant: { label: 'AI assistant', href: '/admin/settings/agent' },
    aiArticleTranslation: {
      label: 'AI article translation',
      href: '/admin/settings/help-center',
    },
  }
