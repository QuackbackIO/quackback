/**
 * MemberService - Business logic for members
 *
 * Provides member lookup operations.
 */

import { db, eq, sql, member, user } from '@quackback/db'
import type { Member } from '@quackback/db'
import type { MemberId, UserId } from '@quackback/ids'
import { InternalError } from '@/lib/shared/errors'
import type { TeamMember } from './member.types'

// Re-export types for backwards compatibility
export type { TeamMember } from './member.types'

/**
 * Find a member by user ID
 */
export async function getMemberByUser(userId: UserId): Promise<Member | null> {
  try {
    const foundMember = await db.query.member.findFirst({
      where: eq(member.userId, userId),
    })
    return foundMember ?? null
  } catch (error) {
    console.error('Error looking up member:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to lookup member', error)
  }
}

/**
 * Find a member by ID
 */
export async function getMemberById(memberId: MemberId): Promise<Member | null> {
  try {
    const foundMember = await db.query.member.findFirst({
      where: eq(member.id, memberId),
    })
    return foundMember ?? null
  } catch (error) {
    console.error('Error looking up member:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to lookup member', error)
  }
}

/**
 * List all team members with user details
 */
export async function listTeamMembers(): Promise<TeamMember[]> {
  try {
    const teamMembers = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))

    return teamMembers
  } catch (error) {
    console.error('Error listing team members:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to list team members', error)
  }
}

/**
 * Count all members (no auth required)
 */
export async function countMembers(): Promise<number> {
  try {
    const result = await db.select({ count: sql<number>`count(*)`.as('count') }).from(member)

    return Number(result[0]?.count ?? 0)
  } catch (error) {
    console.error('Error counting members:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to count members', error)
  }
}
