/**
 * What the boards settings page needs to show: which boards are read-only now
 * and whether a new board would pass the plan's cap. Both stay empty with the
 * plan limits flag off, so the page is unchanged.
 */
import { createServerFn } from '@tanstack/react-start'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { requireAuth } from './auth-helpers'

export interface BoardLimits {
  /** Boards that stay open; null when every board is open. */
  openBoardIds: string[] | null
  /** The most boards the plan allows, when the limits are in force; else null. */
  boardCap: number | null
}

export const getBoardLimitsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<BoardLimits> => {
    await requireAuth({ permission: PERMISSIONS.MEMBER_VIEW })
    const { getPlanLimits, openBoardIds } =
      await import('@/lib/server/domains/plan-limits/plan-limits.service')
    const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
    const limits = await getPlanLimits()
    if (!limits.enabled) return { openBoardIds: null, boardCap: null }
    const [open, tier] = await Promise.all([openBoardIds(), getTierLimits()])
    return { openBoardIds: open, boardCap: tier.maxBoards }
  }
)
