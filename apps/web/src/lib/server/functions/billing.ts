/** Read the workspace-safe billing projection. Provider data stays in the control plane. */

import { createServerFn } from '@tanstack/react-start'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { requireAuth } from './auth-helpers'

/**
 * Null without a valid projection, keeping self-hosted installs default-off.
 */
export const fetchBillingOverviewFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.BILLING_MANAGE })
  const { getBillingProjectionOverview } =
    await import('@/lib/server/domains/billing/projection-overview')
  return await getBillingProjectionOverview()
})

export const fetchBillingCatalogueFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.BILLING_MANAGE })
  const { fetchBillingCatalogue } = await import('@/lib/server/control-plane/client')
  return fetchBillingCatalogue()
})

export const fetchBillingInvoicesFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.BILLING_MANAGE })
  const { fetchBillingInvoices } = await import('@/lib/server/control-plane/client')
  return fetchBillingInvoices()
})
