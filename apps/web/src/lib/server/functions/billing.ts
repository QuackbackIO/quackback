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

export const fetchPlanUsageFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.BILLING_MANAGE })
  const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
  const { aiTokensThisMonth } = await import('@/lib/server/domains/ai/usage-counter')
  const { finiteUsageLines } = await import('@/lib/server/domains/billing/plan-usage')
  const { db, eq, isNull, sql, posts, boards, roles, statusComponents, emailSendingDomains } =
    await import('@/lib/server/db')

  const limits = await getTierLimits()
  const { countSeatUsage } = await import('@/lib/server/domains/principals/seat-usage')
  const { emailsSentThisMonth } = await import('@/lib/server/email/email-budget')
  const [boardRow, postRow, seats, statusRow, roleRow, domainRow, aiTokens, emailsSent] =
    await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(boards)
        .where(isNull(boards.deletedAt)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(posts)
        .where(isNull(posts.deletedAt)),
      countSeatUsage(),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(statusComponents)
        .where(isNull(statusComponents.deletedAt)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(roles)
        .where(eq(roles.isSystem, false)),
      db.select({ count: sql<number>`count(*)::int` }).from(emailSendingDomains),
      aiTokensThisMonth(),
      emailsSentThisMonth(),
    ])

  return finiteUsageLines([
    { key: 'maxBoards', label: 'boards', used: boardRow[0]?.count ?? 0, limit: limits.maxBoards },
    { key: 'maxPosts', label: 'posts', used: postRow[0]?.count ?? 0, limit: limits.maxPosts },
    {
      key: 'maxTeamSeats',
      label: 'seats',
      used: seats.used,
      limit: limits.maxTeamSeats,
    },
    {
      key: 'maxStatusComponents',
      label: 'status components',
      used: statusRow[0]?.count ?? 0,
      limit: limits.maxStatusComponents,
    },
    {
      key: 'maxCustomRoles',
      label: 'custom roles',
      used: roleRow[0]?.count ?? 0,
      limit: limits.maxCustomRoles,
    },
    {
      key: 'maxSendingDomains',
      label: 'sending domains',
      used: domainRow[0]?.count ?? 0,
      limit: limits.maxSendingDomains,
    },
    {
      key: 'aiTokensPerMonth',
      label: 'AI tokens this month',
      used: aiTokens,
      limit: limits.aiTokensPerMonth,
    },
    {
      key: 'emailsPerMonth',
      label: 'emails',
      used: emailsSent,
      limit: limits.emailsPerMonth,
    },
  ])
})
