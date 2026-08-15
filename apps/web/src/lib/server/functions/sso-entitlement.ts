import { createServerFn } from '@tanstack/react-start'

export const hasSsoEntitlementFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { hasEntitlement } = await import('@/lib/server/domains/settings/cloud/entitlements')
  return hasEntitlement('sso')
})
