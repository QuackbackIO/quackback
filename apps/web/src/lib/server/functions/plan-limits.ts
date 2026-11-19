/**
 * The Plan limits page's server functions: the state with every row and the
 * choosers' candidates, and one setter per chooser. Every teammate may read
 * the page; a chooser needs billing rights or the permission that manages
 * what it chooses (the same pairs as `CHOOSERS` in plan-limits.page.ts). A
 * choice that cannot apply comes back as a value.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { ForbiddenError } from '@/lib/shared/errors'
import { isTeamMember } from '@/lib/shared/roles'
import { assertAnyPermission, assertDashboardScope, requireAuth } from './auth-helpers'

// Server-only helpers are imported inside each handler: anything this module
// reaches at module scope ships to the browser with its RPC stubs.

export type PlanLimitsChoiceRefusal = {
  ok: false
  reason: 'not_over' | 'unknown' | 'too_many' | 'read_only'
}
export type PlanLimitsChoiceResponse = { ok: true } | PlanLimitsChoiceRefusal

const idSchema = z.string().min(1).max(200)
const idsSchema = z.object({ ids: z.array(idSchema).max(500) })

export const getPlanLimitsFn = createServerFn({ method: 'GET' }).handler(async () => {
  // Every teammate, not a portal user: the same gate as the plan notice.
  const { permissions } = await requireAuth({ permission: PERMISSIONS.MEMBER_VIEW })
  const { getPlanLimitsWithCandidates } =
    await import('@/lib/server/domains/plan-limits/plan-limits.service')
  const { planLimitsPage } = await import('@/lib/server/domains/plan-limits/plan-limits.page')
  const { limits, candidates } = await getPlanLimitsWithCandidates()
  return planLimitsPage(limits, candidates, permissions)
})

export const setKeptBoardFn = createServerFn({ method: 'POST' })
  .validator(z.object({ boardId: idSchema }))
  .handler(async ({ data }): Promise<PlanLimitsChoiceResponse> => {
    assertAnyPermission(await requireAuth(), [
      PERMISSIONS.BILLING_MANAGE,
      PERMISSIONS.SETTINGS_MANAGE,
    ])
    const { setKeptBoard } = await import('@/lib/server/domains/plan-limits/plan-limits.choosers')
    return setKeptBoard(data.boardId)
  })

export const setSeatHoldersFn = createServerFn({ method: 'POST' })
  .validator(idsSchema)
  .handler(async ({ data }): Promise<PlanLimitsChoiceResponse> => {
    assertAnyPermission(await requireAuth(), [
      PERMISSIONS.BILLING_MANAGE,
      PERMISSIONS.MEMBER_MANAGE,
    ])
    const { setSeatHolders } = await import('@/lib/server/domains/plan-limits/plan-limits.choosers')
    return setSeatHolders(data.ids)
  })

export const setVisibleStatusComponentsFn = createServerFn({ method: 'POST' })
  .validator(idsSchema)
  .handler(async ({ data }): Promise<PlanLimitsChoiceResponse> => {
    assertAnyPermission(await requireAuth(), [
      PERMISSIONS.BILLING_MANAGE,
      PERMISSIONS.STATUS_PAGE_MANAGE,
    ])
    const { setVisibleStatusComponents } =
      await import('@/lib/server/domains/plan-limits/plan-limits.choosers')
    return setVisibleStatusComponents(data.ids)
  })

export const setKeptSendingDomainsFn = createServerFn({ method: 'POST' })
  .validator(idsSchema)
  .handler(async ({ data }): Promise<PlanLimitsChoiceResponse> => {
    assertAnyPermission(await requireAuth(), [
      PERMISSIONS.BILLING_MANAGE,
      PERMISSIONS.CHANNEL_ACCOUNT_MANAGE,
    ])
    const { setKeptSendingDomains } =
      await import('@/lib/server/domains/plan-limits/plan-limits.choosers')
    return setKeptSendingDomains(data.ids)
  })

/**
 * The state for the admin banner and the sidebar line, read on every admin
 * page: the same shape as the page, without the choosers' candidates.
 */
export const getPlanLimitsSummaryFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { permissions } = await requireAuth({ permission: PERMISSIONS.MEMBER_VIEW })
  const { getPlanLimits } = await import('@/lib/server/domains/plan-limits/plan-limits.service')
  const { planLimitsPage } = await import('@/lib/server/domains/plan-limits/plan-limits.page')
  return planLimitsPage(await getPlanLimits(), {}, permissions)
})

/**
 * The banner's state for a teammate without `member.view`, who cannot open
 * the Plan limits page: no member ids, seat counts or links to the team
 * (see `planLimitsNotice`). Any teammate on a dashboard session, never a
 * portal user.
 */
export const getPlanLimitsNoticeFn = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = await requireAuth()
  assertDashboardScope(auth)
  if (!isTeamMember(auth.principal.role)) {
    throw new ForbiddenError('FORBIDDEN', 'Access denied: Not a team member')
  }
  const { getPlanLimits } = await import('@/lib/server/domains/plan-limits/plan-limits.service')
  const { planLimitsNotice } = await import('@/lib/server/domains/plan-limits/plan-limits.notice')
  return planLimitsNotice(await getPlanLimits(), auth.permissions)
})
