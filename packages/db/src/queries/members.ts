import { eq } from 'drizzle-orm'
import { db } from '../client'
import { member } from '../schema/auth'
import type { UserId } from '@quackback/ids'

/**
 * Get a member record by user ID.
 * In single-tenant mode, there's one member record per user.
 *
 * @param userId - The user's ID (TypeID format)
 * @returns The member record if found, undefined otherwise
 */
export async function getMemberByUser(userId: UserId) {
  return db.query.member.findFirst({
    where: eq(member.userId, userId),
  })
}

// Backwards compatibility alias
export const getMemberByUserAndOrg = getMemberByUser
