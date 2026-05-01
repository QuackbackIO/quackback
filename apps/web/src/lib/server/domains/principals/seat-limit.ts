import { db, principal, inArray, sql } from '@/lib/server/db'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { enforceCountLimit } from '@/lib/server/domains/settings/tier-enforce'

/**
 * Throws TierLimitError when the workspace has hit its admin+member
 * seat cap. No-op in OSS (maxTeamSeats is null).
 *
 * Counts only 'admin' and 'member' principals — portal 'user' role and
 * 'anonymous' types do not count toward the seat cap.
 */
export async function enforceSeatLimit(): Promise<void> {
  const limits = await getTierLimits()
  await enforceCountLimit({
    limit: limits.maxTeamSeats,
    name: 'maxTeamSeats',
    friendly: 'team seats',
    currentCount: async () => {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(principal)
        .where(inArray(principal.role, ['admin', 'member']))
      return row?.count ?? 0
    },
  })
}
