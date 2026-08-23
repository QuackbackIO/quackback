import {
  and,
  db,
  eq,
  gt,
  inArray,
  invitation,
  principal,
  sql,
  type Database,
  type Transaction,
} from '@/lib/server/db'

export type SeatExecutor = Database | Transaction

export type SeatUsageCount = {
  members: number
  pendingInvites: number
  used: number
}

/**
 * Human admin/member principals plus pending team invitations. Portal
 * invites and service principals are not seats.
 */
export async function countSeatUsage(executor: SeatExecutor = db): Promise<SeatUsageCount> {
  const [memberRow, inviteRow] = await Promise.all([
    executor
      .select({ count: sql<number>`count(*)::int` })
      .from(principal)
      .where(and(inArray(principal.role, ['admin', 'member']), eq(principal.type, 'user'))),
    executor
      .select({ count: sql<number>`count(*)::int` })
      .from(invitation)
      .where(
        and(
          eq(invitation.kind, 'team'),
          eq(invitation.status, 'pending'),
          // Accept treats expiresAt < now as expired immediately; do not wait
          // for the daily sweep to flip status.
          gt(invitation.expiresAt, sql`now()`)
        )
      ),
  ])
  const members = memberRow[0]?.count ?? 0
  const pendingInvites = inviteRow[0]?.count ?? 0
  return { members, pendingInvites, used: members + pendingInvites }
}
