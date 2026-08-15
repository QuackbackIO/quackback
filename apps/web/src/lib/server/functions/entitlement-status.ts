import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  ENTITLEMENT_KEYS,
  isEntitlementKey,
  type EntitlementKey,
} from '@/lib/server/domains/settings'

const entitlementKeySchema = z
  .string()
  .refine((value): value is EntitlementKey => isEntitlementKey(value), 'unknown entitlement')

/** Non-throwing plan check. Use this in loaders — never prefetch a gated list. */
export const hasEntitlementFn = createServerFn({ method: 'GET' })
  .validator(z.object({ key: entitlementKeySchema }))
  .handler(async ({ data }) => {
    const { hasEntitlement } = await import('@/lib/server/domains/settings/cloud/entitlements')
    return hasEntitlement(data.key)
  })

/** Every entitlement for mixed pages (Access & Security, Developers). */
export const listEntitlementsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { listEntitlements } = await import('@/lib/server/domains/settings/cloud/entitlements')
  return listEntitlements()
})

const TIER_FEATURE_KEYS = [
  'customDomain',
  'customOidcProvider',
  'ipAllowlist',
  'webhooks',
  'mcpServer',
  'analyticsExports',
  'customColors',
  'customCss',
  'integrations',
] as const

/** Non-throwing feature check for loaders (same shape as hasEntitlementFn). */
export const hasTierFeatureFn = createServerFn({ method: 'GET' })
  .validator(z.object({ feature: z.enum(TIER_FEATURE_KEYS) }))
  .handler(async ({ data }) => {
    const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
    const limits = await getTierLimits()
    return limits.features[data.feature]
  })

export const ENTITLEMENT_STATUS_KEYS = ENTITLEMENT_KEYS
