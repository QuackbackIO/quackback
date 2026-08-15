import { createServerFn } from '@tanstack/react-start'

/** @deprecated Use hasEntitlementFn({ data: { key: 'sso' } }). */
export const hasSsoEntitlementFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { hasEntitlementFn } = await import('./entitlement-status')
  return hasEntitlementFn({ data: { key: 'sso' } })
})
