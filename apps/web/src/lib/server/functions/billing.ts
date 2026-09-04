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

export const fetchSeatsPreviewFn = createServerFn({ method: 'GET' })
  .validator((data: { quantity: number }) => data)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.BILLING_MANAGE })
    const { fetchSeatsPreview } = await import('@/lib/server/control-plane/client')
    try {
      return await fetchSeatsPreview(data.quantity)
    } catch {
      return { amountDueCents: null }
    }
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
  const { finiteUsageLines } = await import('@/lib/server/domains/billing/plan-usage')
  const { loadUsageCounts } = await import('@/lib/server/domains/billing/usage-counts')
  const [limits, used] = await Promise.all([getTierLimits(), loadUsageCounts()])
  return finiteUsageLines([
    { key: 'maxBoards', label: 'boards', used: used.maxBoards ?? 0, limit: limits.maxBoards },
    { key: 'maxPosts', label: 'posts', used: used.maxPosts ?? 0, limit: limits.maxPosts },
    {
      key: 'maxTeamSeats',
      label: 'seats',
      used: used.maxTeamSeats ?? 0,
      limit: limits.maxTeamSeats,
    },
    {
      key: 'maxStatusComponents',
      label: 'status components',
      used: used.maxStatusComponents ?? 0,
      limit: limits.maxStatusComponents,
    },
    {
      key: 'maxCustomRoles',
      label: 'custom roles',
      used: used.maxCustomRoles ?? 0,
      limit: limits.maxCustomRoles,
    },
    {
      key: 'maxSendingDomains',
      label: 'sending domains',
      used: used.maxSendingDomains ?? 0,
      limit: limits.maxSendingDomains,
    },
    {
      key: 'aiTokensPerMonth',
      label: 'AI tokens this month',
      used: used.aiTokensPerMonth ?? 0,
      limit: limits.aiTokensPerMonth,
    },
    {
      key: 'emailsPerMonth',
      label: 'emails',
      used: used.emailsPerMonth ?? 0,
      limit: limits.emailsPerMonth,
    },
    {
      key: 'apiRequestsPerMonth',
      label: 'API requests',
      used: used.apiRequestsPerMonth ?? 0,
      limit: limits.apiRequestsPerMonth,
    },
  ])
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

export const fetchPendingDowngradeFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.BILLING_MANAGE })
  const { getPendingDowngrade, pendingPlanName } =
    await import('@/lib/server/domains/billing/pending-downgrade')
  const pending = await getPendingDowngrade()
  if (!pending) return null
  const { fetchBillingCatalogue } = await import('@/lib/server/control-plane/client')
  const catalogue = await fetchBillingCatalogue().catch(() => null)
  const catalogueName = catalogue?.plans.find((plan) => plan.id === pending.planId)?.name
  return { planId: pending.planId, planName: pendingPlanName(pending.planId, catalogueName) }
})

export const beginPlanDowngradeFn = createServerFn({ method: 'POST' })
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
    const { setPendingDowngrade, clearPendingDowngrade } =
      await import('@/lib/server/domains/billing/pending-downgrade')
    const [overview, used] = await Promise.all([getBillingProjectionOverview(), loadUsageCounts()])
    const preview = await loadDowngradePreview({ planId, overview, used })
    if (preview.issues.length > 0) await setPendingDowngrade(planId)
    else await clearPendingDowngrade()
    return { ...preview, locked: preview.issues.length > 0 }
  })

export const cancelPlanDowngradeFn = createServerFn({ method: 'POST' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.BILLING_MANAGE })
  const { clearPendingDowngrade } = await import('@/lib/server/domains/billing/pending-downgrade')
  await clearPendingDowngrade()
  return { ok: true as const }
})

export const shouldLockAdminToBillingFn = createServerFn({ method: 'GET' })
  .validator((data: { pathname: string }) => data)
  .handler(async ({ data }) => {
    const { permissions } = await requireAuth()
    const { shouldLockAdminToBilling } =
      await import('@/lib/server/domains/billing/pending-downgrade')
    return shouldLockAdminToBilling(data.pathname, permissions)
  })
