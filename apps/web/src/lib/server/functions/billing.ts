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

/**
 * Advertised plan stickers. Same payload Plan & billing renders.
 * Any signed-in teammate may read it so upgrade offers stay consistent;
 * checkout and invoices stay billing.manage.
 */
export const fetchBillingCatalogueFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth()
  const { getCloudConfig } = await import('@/lib/server/domains/settings/cloud/cloud.service')
  if (!(await getCloudConfig()).enabled) return null
  const { fetchBillingCatalogue } = await import('@/lib/server/control-plane/client')
  return fetchBillingCatalogue()
})

/**
 * What an upgrade prompt may say about the workspace it is shown in: the plan
 * in force and whether a trial can be offered. Same audience as the catalogue.
 * Null on self-hosted installs and whenever no plan is in force.
 */
export const fetchUpgradeContextFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth()
  const { getCloudConfig } = await import('@/lib/server/domains/settings/cloud/cloud.service')
  const { upgradeContextFor } = await import('@/lib/server/domains/settings/cloud/upgrade-context')
  return upgradeContextFor(await getCloudConfig())
})

export const fetchBillingInvoicesFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.BILLING_MANAGE })
  const { fetchBillingInvoices } = await import('@/lib/server/control-plane/client')
  return fetchBillingInvoices()
})

// This module is imported by the client for its RPC stubs: only `.handler()`
// bodies are stripped, and any module-scope helper an export still reaches
// ships to the browser with its imports. Helpers that touch the database
// therefore live in `@/lib/server/domains/billing/usage-counts` and are
// imported from inside the handlers like every other server dependency
// (guarded by policy/__tests__/server-fn-client-half.test.ts).

export const fetchPlanUsageFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.BILLING_MANAGE })
  const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
  const { finiteUsageLines, planUsageLines } =
    await import('@/lib/server/domains/billing/plan-usage')
  const { loadUsageCounts } = await import('@/lib/server/domains/billing/usage-counts')
  const [limits, used] = await Promise.all([getTierLimits(), loadUsageCounts()])
  return finiteUsageLines(planUsageLines(limits, used))
})

export const fetchDowngradePreviewFn = createServerFn({ method: 'GET' })
  .validator((data: { planId: string }) => data)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.BILLING_MANAGE })
    const { parseTargetPlanId, loadUsageCounts } =
      await import('@/lib/server/domains/billing/usage-counts')
    const planId = parseTargetPlanId(data.planId)
    if (!planId) throw new Error('invalid')
    const { getBillingProjectionOverview } =
      await import('@/lib/server/domains/billing/projection-overview')
    const { loadDowngradePreview } = await import('@/lib/server/domains/billing/downgrade-preview')
    const [overview, used] = await Promise.all([getBillingProjectionOverview(), loadUsageCounts()])
    return loadDowngradePreview({ planId, overview, used })
  })

/** @deprecated Use {@link fetchDowngradePreviewFn} with `planId: 'free'`. */
export const fetchFreeDowngradePreviewFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.BILLING_MANAGE })
  const { getBillingProjectionOverview } =
    await import('@/lib/server/domains/billing/projection-overview')
  const { loadUsageCounts } = await import('@/lib/server/domains/billing/usage-counts')
  const { loadDowngradePreview } = await import('@/lib/server/domains/billing/downgrade-preview')
  const [overview, used] = await Promise.all([getBillingProjectionOverview(), loadUsageCounts()])
  return loadDowngradePreview({ planId: 'free', overview, used })
})
