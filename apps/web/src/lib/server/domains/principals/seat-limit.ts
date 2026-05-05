import { and, db, eq, principal, inArray, sql } from '@/lib/server/db'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { enforceCountLimit } from '@/lib/server/domains/settings/tier-enforce'

/**
 * Throws TierLimitError when the workspace has hit its admin+member
 * seat cap. No-op in OSS (maxTeamSeats is null).
 *
 * Counts only HUMAN admin/member principals. Service-type principals
 * (created for API keys, integrations, the CP's INTERNAL_API_KEY
 * bootstrap) carry an admin/member role but are not human seats and
 * shouldn't consume a paid slot. Same predicate is reused in the
 * /api/v1/internal/usage report; keep them in sync.
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
        .where(and(inArray(principal.role, ['admin', 'member']), eq(principal.type, 'user')))
      return row?.count ?? 0
    },
  })
}
