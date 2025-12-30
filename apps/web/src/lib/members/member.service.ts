/**
 * MemberService - Business logic for members
 *
 * Provides member lookup operations.
 */

import { db, eq, sql, member, user } from '@quackback/db'
import type { Member } from '@quackback/db'
import type { MemberId, UserId } from '@quackback/ids'
import { ok, err } from '@/lib/shared'
import type { Result } from '@/lib/shared'

export type MemberError = {
  code: 'MEMBER_NOT_FOUND' | 'DATABASE_ERROR'
  message: string
}

/**
 * Team member info with user details
 */
export interface TeamMember {
  id: UserId
  name: string | null
  email: string
  image: string | null
}

/**
 * Find a member by user ID
 */
export async function getMemberByUser(userId: UserId): Promise<Result<Member | null, MemberError>> {
  try {
    const foundMember = await db.query.member.findFirst({
      where: eq(member.userId, userId),
    })
    return ok(foundMember ?? null)
  } catch (error) {
    console.error('Error looking up member:', error)
    return err({
      code: 'DATABASE_ERROR',
      message: 'Failed to lookup member',
    })
  }
}

/**
 * Find a member by ID
 */
export async function getMemberById(
  memberId: MemberId
): Promise<Result<Member | null, MemberError>> {
  try {
    const foundMember = await db.query.member.findFirst({
      where: eq(member.id, memberId),
    })
    return ok(foundMember ?? null)
  } catch (error) {
    console.error('Error looking up member:', error)
    return err({
      code: 'DATABASE_ERROR',
      message: 'Failed to lookup member',
    })
  }
}

/**
 * List all team members with user details
 *
 * Returns user info (id, name, email, image) for all members.
 * Used for member assignment dropdowns and team lists.
 */
export async function listTeamMembers(): Promise<Result<TeamMember[], MemberError>> {
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

    return ok(teamMembers)
  } catch (error) {
    console.error('Error listing team members:', error)
    return err({
      code: 'DATABASE_ERROR',
      message: 'Failed to list team members',
    })
  }
}

/**
 * Count all members (no auth required)
 *
 * Used by getting-started page.
 */
export async function countMembers(): Promise<Result<number, MemberError>> {
  try {
    const result = await db.select({ count: sql<number>`count(*)`.as('count') }).from(member)

    return ok(Number(result[0]?.count ?? 0))
  } catch (error) {
    console.error('Error counting members:', error)
    return err({
      code: 'DATABASE_ERROR',
      message: 'Failed to count members',
    })
  }
}
