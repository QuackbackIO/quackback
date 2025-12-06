import { eq, and } from 'drizzle-orm'
import { db } from '../tenant-context'
import { member } from '../schema/auth'

/**
 * Get a member record by user ID and organization ID.
 * Used to verify user membership in an organization and retrieve role information.
 *
 * @param userId - The user's ID
 * @param organizationId - The organization's ID
 * @returns The member record if found, undefined otherwise
 */
export async function getMemberByUserAndOrg(userId: string, organizationId: string) {
  return db.query.member.findFirst({
    where: and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
  })
}
