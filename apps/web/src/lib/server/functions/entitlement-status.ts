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

export const ENTITLEMENT_STATUS_KEYS = ENTITLEMENT_KEYS
