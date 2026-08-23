import { and, db, eq, inArray, invitation, principal, sql } from '@/lib/server/db'

export type SeatUsageCount = {
  members: number
  pendingInvites: number
  used: number
}

/**
 * Human admin/member principals plus pending team invitations. Portal
 * invites and service principals are not seats.
 */
export async function countSeatUsage(): Promise<SeatUsageCount> {
  const [memberRow, inviteRow] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(principal)
      .where(and(inArray(principal.role, ['admin', 'member']), eq(principal.type, 'user'))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(invitation)
      .where(and(eq(invitation.kind, 'team'), eq(invitation.status, 'pending'))),
  ])
  const members = memberRow[0]?.count ?? 0
  const pendingInvites = inviteRow[0]?.count ?? 0
  return { members, pendingInvites, used: members + pendingInvites }
}
